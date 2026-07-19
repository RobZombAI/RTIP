#!/usr/bin/env python3
"""
RTIP — ReadingTextImgPdf
Unified macOS app: OCR + LLM Reading + PDF Processing
Intelligent model lifecycle: only one model loaded at a time
"""
import sys, os, json, time, subprocess, threading, signal, atexit, shutil, base64, urllib.request
from pathlib import Path
from datetime import datetime, timedelta

os.environ['TOKENIZERS_PARALLELISM'] = 'false'

import webview

# ── Paths ──
APP_DIR = Path(__file__).parent.resolve()
RESOURCES = APP_DIR / 'resources'
if not RESOURCES.exists():
    RESOURCES = APP_DIR.parent / 'Resources'
HOME = Path.home()

OCR_MODEL = HOME / 'unlimited-ocr' / 'gguf' / 'Unlimited-OCR-Q8_0.gguf'
OCR_MMPROJ = HOME / 'unlimited-ocr' / 'gguf' / 'mmproj-Unlimited-OCR-F16.gguf'
LLM_MODEL = HOME / 'Downloads' / 'Agents-A1-Q8_0.gguf'

OUTPUT_DIR = HOME / 'rtip-app' / 'output'
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

LLAMA_SERVER = shutil.which('llama-server') or '/opt/homebrew/bin/llama-server'
OCR_PORT = 18080
LLM_PORT = 8081
OCR_URL = f'http://127.0.0.1:{OCR_PORT}'
LLM_URL = f'http://127.0.0.1:{LLM_PORT}'

ocr_process = None
llm_process = None

# ── Intelligent Model Lifecycle ──
# Track which tab is active and when each model was last used
current_tab = 'ocr'
model_last_used = {'ocr': None, 'llm': None}
model_status = {'ocr': False, 'llm': False}
IDLE_TIMEOUT = 300  # 5 min before auto-unload
ocr_locks = threading.Lock()
llm_locks = threading.Lock()


def is_server_alive(port):
    try:
        urllib.request.urlopen(f'http://127.0.0.1:{port}/health', timeout=2)
        return True
    except Exception:
        return False


def start_server(model, port, mmproj=None):
    """Start a llama-server and wait for it to be ready. Returns subprocess or None."""
    port = int(port)
    if is_server_alive(port):
        return True  # already running

    cmd = [str(LLAMA_SERVER), '--model', str(model), '--host', '127.0.0.1',
           '--port', str(port), '--temp', '0', '--ctx-size', '24576',
           '-ngl', '99', '--parallel', '1', '--cont-batching', '--mlock']
    if mmproj:
        cmd += ['--mmproj', str(mmproj)]
    proc = subprocess.Popen(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    for _ in range(90):
        time.sleep(1)
        if is_server_alive(port):
            return proc
    return None


def stop_server(proc, port):
    """Kill server process and optionally free the port."""
    if proc and hasattr(proc, 'poll'):
        proc.terminate()
        try:
            proc.wait(timeout=8)
        except subprocess.TimeoutExpired:
            proc.kill()
            proc.wait(timeout=3)
    # Also kill anything on that port
    try:
        import subprocess
        subprocess.run(['lsof', '-ti', f':{port}'], capture_output=True, text=True)
    except:
        pass


def stop_all():
    global ocr_process, llm_process
    with ocr_locks:
        if ocr_process:
            stop_server(ocr_process, OCR_PORT)
            ocr_process = None
    with llm_locks:
        if llm_process:
            stop_server(llm_process, LLM_PORT)
            llm_process = None


def ensure_ocr_ready():
    """Load OCR model if not running. Returns True on success."""
    global ocr_process
    with ocr_locks:
        if is_server_alive(OCR_PORT):
            model_status['ocr'] = True
            return True
        if not OCR_MODEL.exists():
            return False
        result = start_server(OCR_MODEL, OCR_PORT, mmproj=OCR_MMPROJ)
        if result:
            ocr_process = result if result is not True else None
            model_status['ocr'] = True
            return True
        model_status['ocr'] = False
        return False


def ensure_llm_ready():
    """Load LLM model if not running. Returns True on success."""
    global llm_process
    with llm_locks:
        if is_server_alive(LLM_PORT):
            model_status['llm'] = True
            return True
        if not LLM_MODEL.exists():
            return False
        result = start_server(LLM_MODEL, LLM_PORT)
        if result:
            llm_process = result if result is not True else None
            model_status['llm'] = True
            return True
        model_status['llm'] = False
        return False


def unload_ocr():
    """Kill OCR server, freeing ~3.9GB."""
    global ocr_process
    with ocr_locks:
        if ocr_process:
            stop_server(ocr_process, OCR_PORT)
            ocr_process = None
        model_status['ocr'] = False


def unload_llm():
    """Kill LLM server, freeing ~34GB."""
    global llm_process
    with llm_locks:
        if llm_process:
            stop_server(llm_process, LLM_PORT)
            llm_process = None
        model_status['llm'] = False


def idle_cleanup():
    """Background thread: unload models not used for IDLE_TIMEOUT seconds."""
    while True:
        time.sleep(60)
        now = datetime.now()
        for m in ['ocr', 'llm']:
            last = model_last_used.get(m)
            if last and (now - last).total_seconds() > IDLE_TIMEOUT:
                # Don't unload the currently active tab's model
                if (m == 'ocr' and current_tab != 'ocr') or \
                   (m == 'llm' and current_tab != 'read'):
                    if m == 'ocr':
                        unload_ocr()
                    else:
                        unload_llm()


# ═══════════════════════════════════════════
#  OCR Logic
# ═══════════════════════════════════════════

def ocr_image(image_path, prompt="document parsing."):
    model_last_used['ocr'] = datetime.now()
    with open(image_path, 'rb') as f:
        b64 = base64.b64encode(f.read()).decode()
    ext = os.path.splitext(image_path)[1].lower()
    mime = 'image/png' if ext == '.png' else 'image/jpeg'
    payload = {
        'messages': [{
            'role': 'user',
            'content': [
                {'type': 'text', 'text': prompt},
                {'type': 'image_url', 'image_url': {'url': f'data:{mime};base64,{b64}'}},
            ]
        }],
        'temperature': 0, 'max_tokens': 4096, 'stream': False,
    }
    req = urllib.request.Request(f'{OCR_URL}/v1/chat/completions',
        data=json.dumps(payload).encode(), headers={'Content-Type': 'application/json'})
    resp = urllib.request.urlopen(req, timeout=180)
    result = json.loads(resp.read())
    return result['choices'][0]['message']['content']


def ocr_pdf(pdf_path, prompt="document parsing.", dpi=200):
    try:
        import fitz
    except ImportError:
        return _ocr_pdf_fallback(pdf_path, prompt, dpi)
    doc = fitz.open(pdf_path)
    pages = []
    for i, page in enumerate(doc):
        mat = fitz.Matrix(dpi / 72, dpi / 72)
        pix = page.get_pixmap(matrix=mat)
        tmp = os.path.join(OUTPUT_DIR, f'_tmp_page_{i}.png')
        pix.save(tmp)
        text = ocr_image(tmp, prompt)
        os.remove(tmp)
        pages.append({'page': i + 1, 'total': len(doc), 'text': text})
    doc.close()
    return pages


def _ocr_pdf_fallback(pdf_path, prompt, dpi=200):
    import tempfile
    tmpdir = tempfile.mkdtemp(prefix='ocr_pdf_')
    subprocess.run(['sips', '-s', 'format', 'png', '--resampleWidth', str(8.5 * dpi),
        pdf_path, '--out', tmpdir], capture_output=True, timeout=60)
    pages = []
    outfiles = sorted(os.listdir(tmpdir))
    for i, fname in enumerate(outfiles):
        if fname.endswith('.png'):
            text = ocr_image(os.path.join(tmpdir, fname), prompt)
            pages.append({'page': i + 1, 'total': len(outfiles), 'text': text})
            os.remove(os.path.join(tmpdir, fname))
    os.rmdir(tmpdir)
    return pages


def detect_file_type(path):
    ext = os.path.splitext(path)[1].lower()
    if ext == '.pdf': return 'pdf'
    if ext in ('.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.tiff', '.tif'): return 'image'
    return 'unknown'


def save_output(path, text):
    ts = datetime.now().strftime('%Y%m%d_%H%M%S')
    save_path = OUTPUT_DIR / f'{ts}_{os.path.splitext(os.path.basename(path))[0]}.txt'
    with open(save_path, 'w', encoding='utf-8') as f:
        f.write(text)
    return str(save_path)


def parse_ocr_text(text):
    lines = []
    for line in text.strip().split('\n'):
        line = line.strip()
        if not line: continue
        if line.startswith('title') or line.startswith('text'):
            parts = line.split(']', 1)
            lines.append({'text': parts[1].strip() if len(parts) == 2 else line})
        elif line.startswith('<|det|>') or line.startswith('<|ref|>'):
            continue
        else:
            lines.append({'text': line})
    return lines


# ═══════════════════════════════════════════
#  LLM Chat
# ═══════════════════════════════════════════

def llm_chat(messages, temperature=0.1, max_tokens=4096):
    model_last_used['llm'] = datetime.now()
    payload = {
        'messages': messages,
        'temperature': temperature,
        'max_tokens': max_tokens,
        'stream': False,
    }
    req = urllib.request.Request(f'{LLM_URL}/v1/chat/completions',
        data=json.dumps(payload).encode(), headers={'Content-Type': 'application/json'})
    resp = urllib.request.urlopen(req, timeout=300)
    result = json.loads(resp.read())
    return result['choices'][0]['message']['content']


# ═══════════════════════════════════════════
#  pywebview API
# ═══════════════════════════════════════════

class Api:
    def __init__(self):
        self.window = None

    def ping(self):
        return 'pong'

    def get_status(self):
        return {'ocr': is_server_alive(OCR_PORT), 'llm': is_server_alive(LLM_PORT)}

    def check_models(self):
        return {
            'ocr_model': str(OCR_MODEL.exists()),
            'ocr_mmproj': str(OCR_MMPROJ.exists()),
            'llm_model': str(LLM_MODEL.exists()),
        }

    def tab_switched(self, tab):
        """Called when user switches tabs. Handles model lifecycle."""
        global current_tab
        current_tab = tab

        def task():
            if tab == 'ocr':
                # Unload LLM (34GB freed), ensure OCR loaded
                threading.Thread(target=unload_llm, daemon=True).start()
                ok = ensure_ocr_ready()
                self.window.evaluate_js(f"tabReady('ocr', {str(ok).lower()})")
            elif tab == 'read' or tab == 'pdf':
                # Unload OCR (3.9GB freed), ensure LLM loaded
                threading.Thread(target=unload_ocr, daemon=True).start()
                ok = ensure_llm_ready()
                self.window.evaluate_js(f"tabReady('{tab}', {str(ok).lower()})")
        threading.Thread(target=task, daemon=True).start()

    def pick_file(self):
        script = '''
        set theFile to choose file with prompt "Select a file" of type {"public.png", "public.jpeg", "com.adobe.pdf"} default location (path to desktop)
        return POSIX path of theFile
        '''
        try:
            path = subprocess.check_output(['osascript', '-e', script]).decode().strip()
            return path if path else None
        except subprocess.CalledProcessError:
            return None

    def read_file_b64(self, path):
        try:
            with open(path, 'rb') as f:
                return base64.b64encode(f.read()).decode()
        except Exception:
            return ''

    def open_folder(self, filepath):
        subprocess.Popen(['open', '-R', filepath])

    def file_info(self, path):
        ext = os.path.splitext(path)[1].lower()
        size = os.path.getsize(path)
        ftype = detect_file_type(path)
        return {
            'type': ftype, 'ext': ext, 'size': size,
            'size_str': f'{size / 1024:.0f} KB' if size < 1024 * 1024 else f'{size / (1024*1024):.1f} MB',
            'name': os.path.basename(path),
        }

    def read_file_text(self, path):
        try:
            with open(path, 'r', encoding='utf-8') as f:
                return f.read()[:100000]
        except Exception:
            return ''

    # ── OCR ──

    def run_ocr(self, image_path, prompt):
        def task():
            try:
                self.window.evaluate_js('showLoading()')
                if not ensure_ocr_ready():
                    self.window.evaluate_js(f'showError({json.dumps("OCR model not available")})')
                    return
                ftype = detect_file_type(image_path)
                raw_text = ""
                pages = []
                if ftype == 'pdf':
                    pd = ocr_pdf(image_path, prompt)
                    for p in pd:
                        pages.append({'page': p['page'], 'total': p['total'],
                            'lines': parse_ocr_text(p['text']), 'raw': p['text']})
                        raw_text += f"\n=== PAGE {p['page']}/{p['total']} ===\n{p['text']}\n"
                else:
                    text = ocr_image(image_path, prompt)
                    pages = [{'page': 1, 'total': 1, 'lines': parse_ocr_text(text), 'raw': text}]
                    raw_text = text
                save_path = save_output(image_path, raw_text)
                self.window.evaluate_js(f'showResult({json.dumps({"type":ftype,"raw":raw_text,"pages":pages,"save_path":save_path,"image":image_path})})')
            except Exception as e:
                import traceback; traceback.print_exc()
                self.window.evaluate_js(f'showError({json.dumps(str(e))})')
        threading.Thread(target=task, daemon=True).start()

    # ── LLM Chat ──

    def llm_send(self, message, history_json):
        def task():
            try:
                if not ensure_llm_ready():
                    self.window.evaluate_js(f'llmError({json.dumps("LLM model not available")})')
                    return
                history = json.loads(history_json) if history_json else []
                messages = [{"role": "system", "content": (
                    "You are RTIP Reading Assistant. Analyze text from images, PDFs, and documents. "
                    "Help the user extract, summarize, and understand content. Be precise and thorough."
                )}]
                messages.extend(history)
                messages.append({"role": "user", "content": message})
                resp = llm_chat(messages)
                self.window.evaluate_js(f'llmResponse({json.dumps(resp)})')
            except Exception as e:
                import traceback; traceback.print_exc()
                self.window.evaluate_js(f'llmError({json.dumps(str(e))})')
        threading.Thread(target=task, daemon=True).start()

    def llm_analyze_text(self, text, instruction):
        def task():
            try:
                if not ensure_llm_ready():
                    self.window.evaluate_js(f'llmError({json.dumps("LLM model not available")})')
                    return
                messages = [
                    {"role": "system", "content": "You are RTIP Reading Assistant. Analyze the provided text thoroughly."},
                    {"role": "user", "content": f"# Instruction\n{instruction}\n\n# Text to analyze\n\n{text[:80000]}"}
                ]
                resp = llm_chat(messages, temperature=0.1)
                self.window.evaluate_js(f'llmResponse({json.dumps(resp)})')
            except Exception as e:
                import traceback; traceback.print_exc()
                self.window.evaluate_js(f'llmError({json.dumps(str(e))})')
        threading.Thread(target=task, daemon=True).start()

    # ── PDF text extraction ──

    def extract_pdf_text(self, pdf_path):
        def task():
            try:
                import fitz
                doc = fitz.open(pdf_path)
                pages = []
                for i, page in enumerate(doc):
                    pages.append({'page': i + 1, 'total': len(doc), 'text': page.get_text()})
                doc.close()
                full = '\n'.join([f"=== PAGE {p['page']}/{p['total']} ===\n{p['text']}" for p in pages])
                save_path = save_output(pdf_path, full)
                self.window.evaluate_js(f'pdfExtracted({json.dumps({"pages":pages,"full_text":full,"save_path":save_path})})')
            except Exception as e:
                self.window.evaluate_js(f'showError({json.dumps(str(e))})')
        threading.Thread(target=task, daemon=True).start()


# ═══════════════════════════════════════════
#  Main
# ═══════════════════════════════════════════

def on_shutdown():
    stop_all()
if __name__ == '__main__':
    print('[RTIP] Starting...', flush=True)
    atexit.register(on_shutdown)
    signal.signal(signal.SIGTERM, lambda *a: (stop_all(), sys.exit(0)))
    signal.signal(signal.SIGINT, lambda *a: (stop_all(), sys.exit(0)))

    api = Api()
    print('[RTIP] API created', flush=True)

    print('[RTIP] Starting idle cleanup...', flush=True)
    threading.Thread(target=idle_cleanup, daemon=True).start()

    print('[RTIP] Starting init_default...', flush=True)
    def init_default():
        if OCR_MODEL.exists():
            print('[RTIP] Ensuring OCR ready...', flush=True)
            ensure_ocr_ready()
        elif LLM_MODEL.exists():
            print('[RTIP] Ensuring LLM ready...', flush=True)
            ensure_llm_ready()
    threading.Thread(target=init_default, daemon=True).start()

    url = os.path.join(str(RESOURCES), 'index.html')
    if not os.path.exists(url):
        url = os.path.join(str(APP_DIR.parent / 'Resources'), 'index.html')
    print(f'[RTIP] URL: {url}', flush=True)

    print('[RTIP] Creating window...', flush=True)
    window = webview.create_window(
        title='RTIP — ReadingTextImgPdf',
        url=url,
        js_api=api,
        width=1060, height=780,
        min_size=(800, 600),
        confirm_close=True, text_select=True,
    )
    api.window = window
    print('[RTIP] Window created, starting webview...', flush=True)

    webview.start(debug=False, http_server=True, private_mode=False)
    stop_all()
    os._exit(0)

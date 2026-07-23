#!/usr/bin/env python3
"""
RTIP — ReadingTextImgPdf v2.0
OCR: LightOnOCR-2-1B (PyTorch/MPS)
LLM: Agents A1 (llama.cpp/Metal)
Intelligent model lifecycle: one model at a time
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

LLM_MODEL = HOME / 'Downloads' / 'Agents-A1-Q8_0.gguf'
OUTPUT_DIR = HOME / 'rtip-app' / 'output'
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

LLAMA_SERVER = shutil.which('llama-server') or '/opt/homebrew/bin/llama-server'
LLM_PORT = 8081
LLM_URL = f'http://127.0.0.1:{LLM_PORT}'

llm_process = None

# ── Intelligent Model Lifecycle ──
current_tab = 'ocr'
model_last_used = {'ocr': None, 'llm': None}
IDLE_TIMEOUT = 300
llm_lock = threading.Lock()

# ── LightOnOCR ──
sys.path.insert(0, str(APP_DIR))
from lighton_ocr import ensure_loaded, unload as ocr_unload, is_loaded, ocr_image, ocr_image_b64

def ensure_ocr_ready():
    return ensure_loaded()

def unload_ocr():
    ocr_unload()

# ── llama-server (LLM) ──

def is_server_alive(port):
    try:
        urllib.request.urlopen(f'http://127.0.0.1:{port}/health', timeout=2)
        return True
    except Exception:
        return False

def start_llm_server():
    global llm_process
    with llm_lock:
        if is_server_alive(LLM_PORT):
            return True
        if not LLM_MODEL.exists():
            return False
        cmd = [str(LLAMA_SERVER), '--model', str(LLM_MODEL), '--host', '127.0.0.1',
               '--port', str(LLM_PORT), '--temp', '0.1', '--ctx-size', '32768',
               '-ngl', '99', '--parallel', '1', '--cont-batching', '--mlock']
        proc = subprocess.Popen(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        for _ in range(90):
            time.sleep(1)
            if is_server_alive(LLM_PORT):
                llm_process = proc
                return True
        return False

def stop_llm_server():
    global llm_process
    with llm_lock:
        if llm_process:
            llm_process.terminate()
            try: llm_process.wait(timeout=8)
            except: llm_process.kill()
            llm_process = None

def unload_llm():
    stop_llm_server()

def ensure_llm_ready():
    return start_llm_server()

def stop_all():
    unload_ocr()
    stop_llm_server()

def idle_cleanup():
    while True:
        time.sleep(60)
        now = datetime.now()
        for m in ['ocr', 'llm']:
            last = model_last_used.get(m)
            if last and (now - last).total_seconds() > IDLE_TIMEOUT:
                if m == 'ocr' and current_tab != 'ocr':
                    unload_ocr()
                elif m == 'llm' and current_tab != 'read':
                    unload_llm()

# ═══════════════════════════════════════════
#  OCR Logic — LightOnOCR
# ═══════════════════════════════════════════

def do_ocr(image_path, prompt="Extract all text from this document."):
    model_last_used['ocr'] = datetime.now()
    return ocr_image(image_path, prompt)

def ocr_pdf(pdf_path, prompt="Extract all text from this document.", dpi=200):
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
        text = do_ocr(tmp, prompt)
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
            text = do_ocr(os.path.join(tmpdir, fname), prompt)
            pages.append({'page': i + 1, 'total': len(outfiles), 'text': text})
            os.remove(os.path.join(tmpdir, fname))
    os.rmdir(tmpdir)
    return pages

def detect_file_type(path):
    ext = os.path.splitext(path)[1].lower()
    if ext == '.pdf': return 'pdf'
    if ext in ('.png','.jpg','.jpeg','.gif','.webp','.bmp','.tiff','.tif'): return 'image'
    return 'unknown'

def save_output(path, text):
    ts = datetime.now().strftime('%Y%m%d_%H%M%S')
    save_path = OUTPUT_DIR / f'{ts}_{os.path.splitext(os.path.basename(path))[0]}.txt'
    with open(save_path, 'w', encoding='utf-8') as f:
        f.write(text)
    return str(save_path)

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
        return {'ocr': is_loaded(), 'llm': is_server_alive(LLM_PORT)}

    def check_models(self):
        from lighton_ocr import is_available
        return {
            'ocr': is_available(),
            'llm': str(LLM_MODEL.exists()),
        }

    def tab_switched(self, tab):
        global current_tab
        current_tab = tab
        def task():
            if tab == 'ocr':
                threading.Thread(target=unload_llm, daemon=True).start()
                ok = ensure_ocr_ready()
                self.window.evaluate_js(f"tabReady('ocr', {str(ok).lower()})")
            elif tab in ('read', 'pdf'):
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

    def read_file_text(self, path):
        try:
            with open(path, 'r', encoding='utf-8') as f:
                return f.read()[:100000]
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
                            'lines': [{'text': l} for l in p['text'].strip().split('\n') if l.strip()],
                            'raw': p['text']})
                        raw_text += f"\n=== PAGE {p['page']}/{p['total']} ===\n{p['text']}\n"
                else:
                    text = do_ocr(image_path, prompt)
                    lines = [{'text': l} for l in text.strip().split('\n') if l.strip()]
                    pages = [{'page': 1, 'total': 1, 'lines': lines, 'raw': text}]
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
                    self.window.evaluate_js(f'llmError({json.dumps("LLM not available")})')
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
                    self.window.evaluate_js(f'llmError({json.dumps("LLM not available")})')
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

    # ── PDF ──
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
    atexit.register(on_shutdown)
    signal.signal(signal.SIGTERM, lambda *a: (stop_all(), sys.exit(0)))
    signal.signal(signal.SIGINT, lambda *a: (stop_all(), sys.exit(0)))

    api = Api()

    threading.Thread(target=idle_cleanup, daemon=True).start()

    def init_default():
        ensure_ocr_ready()
    threading.Thread(target=init_default, daemon=True).start()

    url = os.path.join(str(RESOURCES), 'index.html')
    if not os.path.exists(url):
        url = os.path.join(str(APP_DIR.parent / 'Resources'), 'index.html')

    window = webview.create_window(
        title='RTIP — ReadingTextImgPdf',
        url=url, js_api=api,
        width=1060, height=780,
        min_size=(800, 600),
        confirm_close=True, text_select=True,
    )
    api.window = window

    webview.start(debug=False, http_server=True, private_mode=False)
    stop_all()
    os._exit(0)

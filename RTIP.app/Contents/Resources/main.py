#!/usr/bin/env python3
"""
RTIP — Image OCR (LightOnOCR) + PDF Reader + AI + Session History
"""
import sys, os, json, time, subprocess, threading, signal, atexit, base64, urllib.request, shutil, uuid
from pathlib import Path
from datetime import datetime

os.environ['TOKENIZERS_PARALLELISM'] = 'false'

# ── Auto-install ──
def auto_install():
    missing = []
    for mod, pkg in [(('webview',), 'pywebview pyobjc'),
                     (('torch',), 'torch'),
                     (('transformers',), 'transformers>=5.0.0'),
                     (('PIL',), 'pillow'),
                     (('torchvision',), 'torchvision'),
                     (('fitz',), 'PyMuPDF'),
                     (('psutil',), 'psutil')]:
        try:
            __import__(mod[0])
        except:
            missing.append(pkg)
    if missing and threading.current_thread() is not threading.main_thread():
        subprocess.run([sys.executable, '-m', 'pip', 'install', *missing],
                      capture_output=True, timeout=300)

try:
    import webview
except ImportError:
    subprocess.run([sys.executable, '-m', 'pip', 'install', 'pywebview', 'pyobjc'],
                  capture_output=True, timeout=120)
    import webview

import fitz
from lighton_ocr import ensure_loaded as ocr_ensure, unload as ocr_unload, is_loaded, ocr_image

# ── Paths ──
APP_DIR = Path(__file__).parent.resolve()
RESOURCES = APP_DIR / 'resources'
if not RESOURCES.exists():
    RESOURCES = APP_DIR.parent / 'Resources'
BASE = Path.home() / 'rtip-ocr'
OUTPUT_DIR = BASE / 'output'
SESSIONS_DIR = BASE / 'sessions'
SESSIONS_INDEX = SESSIONS_DIR / 'index.json'
for d in [OUTPUT_DIR, SESSIONS_DIR]:
    d.mkdir(parents=True, exist_ok=True)

ocr_cancel = threading.Event()
LLM_MODEL = Path.home() / 'Downloads' / 'Agents-A1-Q8_0.gguf'
LLAMA_SERVER = shutil.which('llama-server') or '/opt/homebrew/bin/llama-server'
llm_process = None

# ═══════════════════════════════════════════
#  RAM Detection & Model Compatibility
# ═══════════════════════════════════════════

def get_system_ram_gb():
    """Returns total RAM in GB. Defaults to 8 if psutil not available."""
    try:
        import psutil
        return round(psutil.virtual_memory().total / 1073741824)
    except:
        return 8

TOTAL_RAM_GB = get_system_ram_gb()

# Model requirements (estimated peak usage)
MODEL_REQUIREMENTS = {
    'ocr': {'name': 'LightOnOCR-2-1B', 'min_ram_gb': 4, 'file': None, 'size_gb': 2},
    'llm': {'name': 'Agents A1 Q8_0', 'min_ram_gb': 48, 'file': LLM_MODEL, 'size_gb': 34},
}

# Determine which models are compatible
OCR_OK = TOTAL_RAM_GB >= MODEL_REQUIREMENTS['ocr']['min_ram_gb']
LLM_OK = TOTAL_RAM_GB >= MODEL_REQUIREMENTS['llm']['min_ram_gb']
LLM_FILE_EXISTS = LLM_MODEL.exists()
SYSTEM_INFO = {
    'ram_gb': TOTAL_RAM_GB,
    'ocr': OCR_OK,
    'llm': LLM_OK,
    'llm_file': LLM_FILE_EXISTS,
    'llm_model_name': 'Agents A1',
    'llm_file_size': '34 GB',
    'llm_download_url': 'https://huggingface.co/robzombai/Agents-A1-GGUF/resolve/main/Agents-A1-Q8_0.gguf',
    'msg_ocr': '✅ LightOnOCR ready' if OCR_OK else '❌ Need 4GB+ RAM for OCR',
    'msg_llm': f'✅ Agents A1 ready ({TOTAL_RAM_GB}GB RAM)' if LLM_OK and LLM_FILE_EXISTS
               else (f'⚠️ Need {MODEL_REQUIREMENTS["llm"]["min_ram_gb"]}GB+ RAM for Agents A1 (have {TOTAL_RAM_GB}GB)'
                     if not LLM_OK
                     else f'⚠️ Download Agents A1 ({MODEL_REQUIREMENTS["llm"]["size_gb"]}GB) to enable AI features'),
}

# ═══════════════════════════════════════════
#  LLM (Agents A1)
# ═══════════════════════════════════════════

def llm_alive():
    try:
        urllib.request.urlopen('http://127.0.0.1:8081/health', timeout=2)
        return True
    except: return False

def start_llm():
    global llm_process
    if not LLM_OK: return False
    if llm_alive(): return True
    if not LLM_MODEL.exists(): return False
    cmd = [LLAMA_SERVER, '--model', str(LLM_MODEL), '--host', '127.0.0.1', '--port', '8081',
           '--temp', '0.1', '--ctx-size', '32768', '-ngl', '99',
           '--parallel', '1', '--cont-batching', '--mlock']
    llm_process = subprocess.Popen(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    for _ in range(90):
        time.sleep(1)
        if llm_alive(): return True
    return False

def stop_llm():
    global llm_process
    if llm_process:
        llm_process.terminate()
        try: llm_process.wait(timeout=5)
        except: llm_process.kill()
        llm_process = None

def llm_chat(messages):
    payload = {'messages': messages, 'temperature': 0.1, 'max_tokens': 4096, 'stream': False}
    req = urllib.request.Request('http://127.0.0.1:8081/v1/chat/completions',
        data=json.dumps(payload).encode(), headers={'Content-Type': 'application/json'})
    resp = urllib.request.urlopen(req, timeout=300)
    return json.loads(resp.read())['choices'][0]['message']['content']

# ═══════════════════════════════════════════
#  Session Manager
# ═══════════════════════════════════════════

def load_sessions():
    if SESSIONS_INDEX.exists():
        return json.loads(SESSIONS_INDEX.read_text())
    return []

def save_session_index(sessions):
    SESSIONS_INDEX.write_text(json.dumps(sessions, indent=2, ensure_ascii=False))

def create_session(file_name, file_type, raw_text, pages):
    sid = datetime.now().strftime('%Y%m%d_%H%M%S') + '_' + uuid.uuid4().hex[:6]
    entry = {
        'id': sid, 'file': file_name, 'type': file_type, 'pages': len(pages),
        'chars': len(raw_text), 'date': datetime.now().isoformat(),
    }
    data = {**entry, 'raw': raw_text, 'pages': pages, 'chat': []}
    (SESSIONS_DIR / f'{sid}.json').write_text(json.dumps(data, indent=2, ensure_ascii=False))
    # Update index
    sessions = load_sessions()
    sessions.insert(0, entry)
    save_session_index(sessions)
    return sid

def get_session(sid):
    p = SESSIONS_DIR / f'{sid}.json'
    if p.exists():
        return json.loads(p.read_text())
    return None

def delete_session(sid):
    p = SESSIONS_DIR / f'{sid}.json'
    if p.exists(): p.unlink()
    sessions = [s for s in load_sessions() if s['id'] != sid]
    save_session_index(sessions)

# ═══════════════════════════════════════════
#  OCR (images)
# ═══════════════════════════════════════════

def do_ocr(image_path, prompt="Extract all text from this image."):
    if ocr_cancel.is_set(): return '[CANCELLED]'
    r = ocr_image(image_path, prompt)
    if ocr_cancel.is_set(): return '[CANCELLED]'
    return r

def detect_type(path):
    e = os.path.splitext(path)[1].lower()
    if e == '.pdf': return 'pdf'
    if e in ('.png','.jpg','.jpeg','.gif','.webp','.bmp','.tiff','.tif'): return 'image'
    return 'unknown'

def save_txt(path, text):
    ts = datetime.now().strftime('%Y%m%d_%H%M%S')
    n = os.path.splitext(os.path.basename(path))[0]
    p = OUTPUT_DIR / f'{ts}_{n}.txt'
    with open(p, 'w', encoding='utf-8') as f: f.write(text)
    return str(p)

# ═══════════════════════════════════════════
#  API
# ═══════════════════════════════════════════

class Api:
    def __init__(self):
        self.window = None

    def ping(self): return 'pong'

    def get_status(self):
        return {'ocr': is_loaded(), 'llm': llm_alive(), 'llm_model': LLM_FILE_EXISTS}

    def get_system_info(self):
        return json.dumps(SYSTEM_INFO)

    # ── Models ──
    def start_ocr(self):
        def task():
            ok = ocr_ensure()
            if self.window:
                self.window.evaluate_js(f"updateStatus({json.dumps({'ocr': ok})})")
        threading.Thread(target=task, daemon=True).start()
        if self.window:
            self.window.evaluate_js("updateStatus({'ocr': 'loading'})")

    def stop_ocr(self):
        ocr_unload()
        if self.window: self.window.evaluate_js("updateStatus({'ocr': False})")

    def start_llm(self):
        def task():
            ok = start_llm()
            if self.window:
                self.window.evaluate_js(f"updateStatus({json.dumps({'llm': ok})})")
        threading.Thread(target=task, daemon=True).start()

    def stop_llm(self):
        stop_llm()
        if self.window: self.window.evaluate_js("updateStatus({'llm': False})")

    def download_llm(self):
        """Download Agents A1 model in background."""
        def task():
            import urllib.request
            url = 'https://huggingface.co/robzombai/Agents-A1-GGUF/resolve/main/Agents-A1-Q8_0.gguf'
            dest = str(LLM_MODEL)
            try:
                if self.window:
                    self.window.evaluate_js(f"downloadProgress({json.dumps({'pct':0,'msg':'Starting download...'})})")
                urllib.request.urlretrieve(url, dest, reporthook=lambda b, bs, sz: (
                    self.window and self.window.evaluate_js(
                        f"downloadProgress({json.dumps({'pct':round(100*b*bs/sz),'msg':f'{round(b*bs/1048576)}MB / {round(sz/1048576)}MB'})})")
                ) if self.window else None)
                if self.window:
                    self.window.evaluate_js("downloadProgress({'pct':100,'msg':'Download complete!'})")
                    self.window.evaluate_js("llmDownloaded()")
            except Exception as e:
                if self.window:
                    self.window.evaluate_js(f"downloadProgress({json.dumps({'pct':-1,'msg':str(e)})})")
        threading.Thread(target=task, daemon=True).start()
        return 'downloading'

    # ── Sessions ──
    def get_sessions(self):
        return json.dumps(load_sessions())

    def load_session(self, sid):
        s = get_session(sid)
        if s: return json.dumps(s)
        return '{}'

    def delete_session(self, sid):
        delete_session(sid)
        return json.dumps(load_sessions())

    def save_chat(self, sid, chat_json):
        p = SESSIONS_DIR / f'{sid}.json'
        if p.exists():
            data = json.loads(p.read_text())
            data['chat'] = json.loads(chat_json)
            p.write_text(json.dumps(data, indent=2, ensure_ascii=False))
        return 'ok'

    # ── File ──
    def pick_file(self):
        s = '''set f to choose file with prompt "Select image or PDF" of type {"public.png","public.jpeg","com.adobe.pdf"} default location (path to desktop)
return POSIX path of f'''
        try:
            r = subprocess.check_output(['osascript', '-e', s]).decode().strip()
            return r or None
        except: return None

    def read_file_b64(self, path):
        try:
            with open(path, 'rb') as f: return base64.b64encode(f.read()).decode()
        except: return ''

    def open_folder(self, fp):
        subprocess.Popen(['open', '-R', fp])

    def file_info(self, path):
        sz = os.path.getsize(path)
        return {
            'type': detect_type(path),
            'size_str': f'{sz/1024:.0f} KB' if sz < 1048576 else f'{sz/1048576:.1f} MB',
            'name': os.path.basename(path),
        }

    # ── Extract (PDF) ──
    def extract_pdf(self, pdf_path):
        ocr_cancel.clear()
        def task():
            try:
                doc = fitz.open(pdf_path)
                pages = []
                for i, page in enumerate(doc):
                    if ocr_cancel.is_set(): break
                    text = page.get_text()
                    pages.append({'page': i+1, 'total': doc.page_count, 'text': text})
                    if self.window:
                        self.window.evaluate_js(f"streamPage({json.dumps({'page':i+1,'total':doc.page_count,'text':text[:200]})})")
                doc.close()
                if ocr_cancel.is_set():
                    if self.window: self.window.evaluate_js("showError('Cancelled')")
                    return
                raw = '\n'.join([f"=== PAGE {p['page']}/{p['total']} ===\n{p['text']}" for p in pages])
                sp = save_txt(pdf_path, raw)
                sid = create_session(os.path.basename(pdf_path), 'pdf', raw, pages)
                if self.window:
                    self.window.evaluate_js(f"showResult({json.dumps({'raw':raw,'pages':pages,'save_path':sp,'sid':sid,'type':'pdf'})})")
                    self.window.evaluate_js("refreshSessions()")
            except Exception as e:
                import traceback; traceback.print_exc()
                if self.window: self.window.evaluate_js(f"showError({json.dumps(str(e))})")
        threading.Thread(target=task, daemon=True).start()

    # ── OCR (image) ──
    def run_ocr(self, image_path, prompt):
        ocr_cancel.clear()
        def task():
            try:
                if self.window: self.window.evaluate_js('showLoading()')
                if not ocr_ensure():
                    if self.window: self.window.evaluate_js("showError('OCR not available')")
                    return
                text = do_ocr(image_path, prompt)
                if ocr_cancel.is_set():
                    if self.window: self.window.evaluate_js("showError('Cancelled')")
                    return
                pages = [{'page':1,'total':1,'text':text}]
                sp = save_txt(image_path, text)
                sid = create_session(os.path.basename(image_path), 'image', text, pages)
                if self.window:
                    self.window.evaluate_js(f"showResult({json.dumps({'raw':text,'pages':pages,'save_path':sp,'sid':sid,'type':'image'})})")
                    self.window.evaluate_js("refreshSessions()")
            except Exception as e:
                import traceback; traceback.print_exc()
                if self.window: self.window.evaluate_js(f"showError({json.dumps(str(e))})")
        threading.Thread(target=task, daemon=True).start()

    def cancel_ocr(self):
        ocr_cancel.set()
        ocr_unload()

    # ── LLM post-processing ──
    def llm_process(self, text, action, lang='Italian'):
        """Post-process text: translate to LANG, summarize, rewrite, or custom."""
        translate_prompt = f'Translate the following text to {lang}. Preserve formatting:\n\n'
        prompts = {
            'translate': translate_prompt,
            'summarize': 'Summarize the following text in 3-5 key points:\n\n',
            'rewrite': 'Rewrite the following text in a clear, professional style:\n\n',
        }
        prefix = prompts.get(action, '')
        if not prefix:  # custom
            prefix = action + '\n\n'
        def task():
            try:
                if not start_llm():
                    if self.window: self.window.evaluate_js("llmError('LLM not available')")
                    return
                resp = llm_chat([
                    {'role': 'system', 'content': 'You are RTIP Assistant. Process the text as requested. Output only the result.'},
                    {'role': 'user', 'content': prefix + text[:40000]}
                ])
                if self.window: self.window.evaluate_js(f"llmResponse({json.dumps(resp)})")
            except Exception as e:
                import traceback; traceback.print_exc()
                if self.window: self.window.evaluate_js(f"llmError({json.dumps(str(e))})")
        threading.Thread(target=task, daemon=True).start()

    def llm_chat(self, message, history_json):
        """Free-form chat with LLM."""
        def task():
            try:
                if not start_llm():
                    if self.window: self.window.evaluate_js("llmError('LLM not available')")
                    return
                history = json.loads(history_json) if history_json else []
                messages = [{'role': 'system', 'content': 'You are RTIP Assistant. Help the user with their document.'}]
                messages.extend(history)
                messages.append({'role': 'user', 'content': message})
                resp = llm_chat(messages)
                if self.window: self.window.evaluate_js(f"llmResponse({json.dumps(resp)})")
            except Exception as e:
                import traceback; traceback.print_exc()
                if self.window: self.window.evaluate_js(f"llmError({json.dumps(str(e))})")
        threading.Thread(target=task, daemon=True).start()


# ═══════════════════════════════════════════
#  Main
# ═══════════════════════════════════════════

def on_shutdown():
    ocr_unload()
    stop_llm()

if __name__ == '__main__':
    atexit.register(on_shutdown)
    signal.signal(signal.SIGTERM, lambda *a: (on_shutdown(), sys.exit(0)))
    signal.signal(signal.SIGINT, lambda *a: (on_shutdown(), sys.exit(0)))

    threading.Thread(target=auto_install, daemon=True).start()
    api = Api()

    # Start both models in background (only if RAM-compatible)
    def boot():
        if OCR_OK:
            ocr_ensure()
        if LLM_OK:
            start_llm()
    threading.Thread(target=boot, daemon=True).start()

    url = os.path.join(str(RESOURCES), 'index.html')
    if not os.path.exists(url):
        url = os.path.join(str(APP_DIR.parent / 'Resources'), 'index.html')

    window = webview.create_window(
        title='RTIP — ReadingTextImgPdf',
        url=url, js_api=api,
        width=1200, height=800,
        min_size=(900, 600),
        confirm_close=True, text_select=True,
    )
    api.window = window
    webview.start(debug=False, http_server=True, private_mode=False)
    on_shutdown()
    os._exit(0)

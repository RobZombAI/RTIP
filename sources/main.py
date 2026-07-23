#!/usr/bin/env python3
"""
RTIP — Image OCR (LightOnOCR) + PDF Reader (Agents A1)
Images → LightOnOCR-2-1B
PDFs → PyMuPDF text extraction + optional Agents A1 analysis
"""
import sys, os, json, time, subprocess, threading, signal, atexit, base64, urllib.request
from pathlib import Path
from datetime import datetime

os.environ['TOKENIZERS_PARALLELISM'] = 'false'

# ── Auto-install (background only) ──
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

import fitz  # PyMuPDF — always available for PDF text extraction
from lighton_ocr import ensure_loaded, unload as ocr_unload, is_loaded, ocr_image

# ── Paths ──
APP_DIR = Path(__file__).parent.resolve()
RESOURCES = APP_DIR / 'resources'
if not RESOURCES.exists():
    RESOURCES = APP_DIR.parent / 'Resources'
OUTPUT_DIR = Path.home() / 'rtip-ocr' / 'output'
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

ocr_cancel = threading.Event()
LLM_MODEL = Path.home() / 'Downloads' / 'Agents-A1-Q8_0.gguf'
llm_process = None

# ── LLM (Agents A1) ──
def start_llm():
    global llm_process
    if llm_process and llm_process.poll() is None:
        return True
    if not LLM_MODEL.exists():
        return False
    ls = shutil.which('llama-server') or '/opt/homebrew/bin/llama-server'
    cmd = [ls, '--model', str(LLM_MODEL), '--host', '127.0.0.1', '--port', '8081',
           '--temp', '0.1', '--ctx-size', '32768', '-ngl', '99',
           '--parallel', '1', '--cont-batching', '--mlock']
    proc = subprocess.Popen(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    import urllib.request
    for _ in range(90):
        time.sleep(1)
        try:
            urllib.request.urlopen('http://127.0.0.1:8081/health', timeout=2)
            llm_process = proc
            return True
        except: pass
    return False

def stop_llm():
    global llm_process
    if llm_process:
        llm_process.terminate()
        try: llm_process.wait(timeout=5)
        except: llm_process.kill()
        llm_process = None

def llm_ask(system, text, question):
    """Query Agents A1 with text context."""
    payload = {
        'messages': [
            {'role': 'system', 'content': system},
            {'role': 'user', 'content': f'# Document\n{text[:60000]}\n\n# Question\n{question}'}
        ],
        'temperature': 0.1, 'max_tokens': 2048, 'stream': False,
    }
    req = urllib.request.Request('http://127.0.0.1:8081/v1/chat/completions',
        data=json.dumps(payload).encode(), headers={'Content-Type': 'application/json'})
    resp = urllib.request.urlopen(req, timeout=300)
    return json.loads(resp.read())['choices'][0]['message']['content']

# ── OCR (images only) ──
def do_ocr(image_path, prompt="Extract all text from this image."):
    if ocr_cancel.is_set(): return '[CANCELLED]'
    r = ocr_image(image_path, prompt)
    if ocr_cancel.is_set(): return '[CANCELLED]'
    return r

def detect_file_type(path):
    e = os.path.splitext(path)[1].lower()
    if e == '.pdf': return 'pdf'
    if e in ('.png','.jpg','.jpeg','.gif','.webp','.bmp','.tiff','.tif'): return 'image'
    return 'unknown'

def save_output(path, text):
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
        import urllib.request
        llm_alive = False
        try:
            urllib.request.urlopen('http://127.0.0.1:8081/health', timeout=2)
            llm_alive = True
        except: pass
        return {'ocr': is_loaded(), 'llm': llm_alive, 'llm_model': LLM_MODEL.exists()}

    def start_ocr(self):
        def task():
            ok = ensure_loaded()
            if self.window:
                self.window.evaluate_js(f"updateStatus({json.dumps({'ocr': ok})})")
        threading.Thread(target=task, daemon=True).start()
        if self.window:
            self.window.evaluate_js("updateStatus({'ocr': 'loading'})")

    def stop_ocr(self):
        ocr_unload()
        if self.window:
            self.window.evaluate_js("updateStatus({'ocr': False})")

    def start_llm(self):
        def task():
            ok = start_llm()
            if self.window:
                self.window.evaluate_js(f"updateStatus({json.dumps({'llm': ok})})")
        threading.Thread(target=task, daemon=True).start()

    def stop_llm(self):
        stop_llm()
        if self.window:
            self.window.evaluate_js("updateStatus({'llm': False})")

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
            'type': detect_file_type(path),
            'size_str': f'{sz/1024:.0f} KB' if sz < 1048576 else f'{sz/1048576:.1f} MB',
            'name': os.path.basename(path),
        }

    def extract_pdf_text(self, pdf_path):
        """Extract text directly from PDF using PyMuPDF. Fast, no model needed."""
        def task():
            try:
                doc = fitz.open(pdf_path)
                pages = []
                for i, page in enumerate(doc):
                    text = page.get_text()
                    pages.append({'page': i + 1, 'total': doc.page_count, 'text': text})
                    if self.window:
                        try:
                            self.window.evaluate_js(
                                f"streamPage({json.dumps({'page':i+1,'total':doc.page_count,'text':text[:200]})})")
                        except: pass
                doc.close()
                full = '\n'.join([f"=== PAGE {p['page']}/{p['total']} ===\n{p['text']}" for p in pages])
                sp = save_output(pdf_path, full)
                if self.window:
                    self.window.evaluate_js(f"showResult({json.dumps({'raw':full,'pages':pages,'save_path':sp,'type':'pdf'})})")
            except Exception as e:
                import traceback; traceback.print_exc()
                if self.window:
                    self.window.evaluate_js(f"showError({json.dumps(str(e))})")
        threading.Thread(target=task, daemon=True).start()

    def run_ocr(self, image_path, prompt):
        """OCR for images only."""
        global ocr_cancel
        ocr_cancel.clear()
        def task():
            try:
                if self.window: self.window.evaluate_js('showLoading()')
                if not ensure_loaded():
                    if self.window: self.window.evaluate_js("showError('OCR model not available')")
                    return
                text = do_ocr(image_path, prompt)
                if ocr_cancel.is_set():
                    if self.window: self.window.evaluate_js("showError('Cancelled')")
                else:
                    sp = save_output(image_path, text)
                    if self.window:
                        self.window.evaluate_js(f"showResult({json.dumps({'raw':text,'save_path':sp,'type':'image'})})")
            except Exception as e:
                import traceback; traceback.print_exc()
                if self.window: self.window.evaluate_js(f"showError({json.dumps(str(e))})")
        threading.Thread(target=task, daemon=True).start()

    def cancel_ocr(self):
        ocr_cancel.set()
        ocr_unload()

    def llm_analyze(self, text, question):
        """Analyze text with Agents A1."""
        def task():
            try:
                if not start_llm():
                    if self.window: self.window.evaluate_js("llmError('LLM not available')")
                    return
                resp = llm_ask(
                    "You are RTIP Reading Assistant. Analyze the provided document text thoroughly.",
                    text, question
                )
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
    import shutil, urllib
    atexit.register(on_shutdown)
    signal.signal(signal.SIGTERM, lambda *a: (on_shutdown(), sys.exit(0)))
    signal.signal(signal.SIGINT, lambda *a: (on_shutdown(), sys.exit(0)))

    threading.Thread(target=auto_install, daemon=True).start()
    api = Api()

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
    on_shutdown()
    os._exit(0)

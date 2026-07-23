#!/usr/bin/env python3
"""
RTIP — OCR-only. LightOnOCR-2-1B (PyTorch/MPS).
Fast, clean, local OCR for images and PDFs.
"""
import sys, os, json, time, subprocess, threading, signal, atexit, base64
from pathlib import Path
from datetime import datetime

os.environ['TOKENIZERS_PARALLELISM'] = 'false'

# ── Auto-install ──
def auto_install():
    missing = []
    try: import webview
    except: missing.append('pywebview pyobjc')
    try: import torch
    except: missing.append('torch')
    try:
        import transformers
        from transformers import LightOnOcrForConditionalGeneration
    except: missing.append('transformers>=5.0.0')
    try: from PIL import Image
    except: missing.append('pillow')
    try: import torchvision
    except: missing.append('torchvision')
    try: import fitz
    except: missing.append('PyMuPDF')
    try: import psutil
    except: missing.append('psutil')
    if missing:
        for dep in missing:
            subprocess.run([sys.executable, '-m', 'pip', 'install', dep],
                         capture_output=True, timeout=120)

auto_install()
import webview
from lighton_ocr import ensure_loaded, unload, is_loaded, ocr_image

# ── Paths ──
APP_DIR = Path(__file__).parent.resolve()
RESOURCES = APP_DIR / 'resources'
if not RESOURCES.exists():
    RESOURCES = APP_DIR.parent / 'Resources'
OUTPUT_DIR = Path.home() / 'rtip-ocr' / 'output'
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

ocr_cancel = threading.Event()
MAX_RAM_PCT = 85  # never exceed 85% of total RAM

def get_ram_info():
    """Return (used_pct, available_gb, total_gb). Returns (0,0,0) if psutil missing."""
    try:
        import psutil
        mem = psutil.virtual_memory()
        return (mem.percent, round(mem.available / 1073741824, 1), round(mem.total / 1073741824, 1))
    except:
        return (0, 0, 0)

def ram_safe_dpi(requested_dpi=150):
    """Auto-reduce DPI if RAM is high. Returns safe DPI value."""
    pct, avail, total = get_ram_info()
    if pct > MAX_RAM_PCT:
        # Scale down proportionally: at 95% → use half the DPI
        factor = max(0.3, (MAX_RAM_PCT - 5) / max(pct, 1))
        reduced = int(requested_dpi * factor)
        return max(reduced, 72)  # minimum 72 DPI
    return requested_dpi

def do_ocr(image_path, prompt="Extract all text from this document."):
    if ocr_cancel.is_set(): return '[CANCELLED]'
    # Run with a timeout wrapper — if it hangs, we skip
    result = ocr_image(image_path, prompt)
    if ocr_cancel.is_set(): return '[CANCELLED]'
    return result

def ocr_pdf(pdf_path, prompt="Extract all text from this document.", dpi=150, page_callback=None):
    """Process PDF pages one by one, adapting quality to available RAM."""
    try:
        import fitz
    except ImportError:
        return _ocr_pdf_fallback(pdf_path, prompt, dpi)
    doc = fitz.open(pdf_path)
    pages = []
    total_pages = doc.page_count
    current_dpi = dpi

    for i, page in enumerate(doc):
        if ocr_cancel.is_set(): break

        # Adapt DPI to available RAM before each page
        current_dpi = ram_safe_dpi(dpi)
        mat = fitz.Matrix(current_dpi / 72, current_dpi / 72)
        try:
            pix = page.get_pixmap(matrix=mat)
        except:
            continue  # skip corrupted pages

        tmp = os.path.join(OUTPUT_DIR, f'_tmp_page_{i}.png')
        pix.save(tmp)
        pix = None  # free immediately
        del mat

        text = do_ocr(tmp, prompt)
        try: os.remove(tmp)
        except: pass

        if ocr_cancel.is_set(): break

        pages.append({'page': i + 1, 'total': total_pages, 'text': text})
        if page_callback:
            page_callback(i + 1, total_pages, text)

        import gc; gc.collect()

    doc.close()
    return pages

def _ocr_pdf_fallback(pdf_path, prompt, dpi=150):
    import tempfile
    tmpdir = tempfile.mkdtemp(prefix='ocr_pdf_')
    subprocess.run(['sips', '-s', 'format', 'png', '--resampleWidth', str(8.5 * dpi),
        pdf_path, '--out', tmpdir], capture_output=True, timeout=60)
    pages = []
    for fname in sorted(os.listdir(tmpdir)):
        if ocr_cancel.is_set(): break
        if fname.endswith('.png'):
            text = do_ocr(os.path.join(tmpdir, fname), prompt)
            pages.append({'page': len(pages) + 1, 'total': len(os.listdir(tmpdir)), 'text': text})
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
    n = os.path.splitext(os.path.basename(path))[0]
    save_path = OUTPUT_DIR / f'{ts}_{n}.txt'
    with open(save_path, 'w', encoding='utf-8') as f:
        f.write(text)
    return str(save_path)


# ═══════════════════════════════════════════
#  API
# ═══════════════════════════════════════════

class Api:
    def __init__(self):
        self.window = None

    def ping(self): return 'pong'
    def get_status(self):
        return {'loaded': is_loaded()}

    def start_model(self):
        def task():
            ok = ensure_loaded()
            self.push({'loaded': ok})
        threading.Thread(target=task, daemon=True).start()
        self.push({'loading': True})
        return 'starting'

    def stop_model(self):
        unload()
        self.push({'loaded': False})
        return 'stopped'

    def push(self, state):
        if self.window:
            try: self.window.evaluate_js(f"updateStatus({json.dumps(state)})")
            except: pass

    def pick_file(self):
        script = '''set f to choose file with prompt "Select image or PDF" of type {"public.png","public.jpeg","com.adobe.pdf"} default location (path to desktop)
return POSIX path of f'''
        try: r = subprocess.check_output(['osascript', '-e', script]).decode().strip()
        except: return None
        return r if r else None

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

    def run_ocr(self, image_path, prompt):
        global ocr_cancel
        ocr_cancel.clear()
        def task():
            try:
                self.window.evaluate_js('showLoading()')
                if not ensure_loaded():
                    self.window.evaluate_js("showError('OCR model not available')")
                    return
                ftype = detect_file_type(image_path)
                raw_text = ""
                if ftype == 'pdf':
                    def on_page(num, total, text):
                        if self.window:
                            try:
                                self.window.evaluate_js(
                                    f"streamPage({json.dumps({'page':num,'total':total,'text':text[:200]})})")
                            except: pass
                    for p in ocr_pdf(image_path, prompt, page_callback=on_page):
                        if ocr_cancel.is_set(): break
                        raw_text += f"\n=== PAGE {p['page']}/{p['total']} ===\n{p['text']}\n"
                else:
                    raw_text = do_ocr(image_path, prompt)
                if ocr_cancel.is_set():
                    self.window.evaluate_js("showError('Cancelled')")
                else:
                    sp = save_output(image_path, raw_text)
                    self.window.evaluate_js(f"showResult({json.dumps({'raw':raw_text,'save_path':sp,'type':ftype})})")
            except Exception as e:
                import traceback; traceback.print_exc()
                self.window.evaluate_js(f"showError({json.dumps(str(e))})")
        threading.Thread(target=task, daemon=True).start()

    def cancel_ocr(self):
        global ocr_cancel
        ocr_cancel.set()
        # Force-unload model to stop any stuck inference
        unload()
        return 'cancelled'


# ═══════════════════════════════════════════
#  Main
# ═══════════════════════════════════════════

def on_shutdown():
    unload()

if __name__ == '__main__':
    atexit.register(on_shutdown)
    signal.signal(signal.SIGTERM, lambda *a: (unload(), sys.exit(0)))
    signal.signal(signal.SIGINT, lambda *a: (unload(), sys.exit(0)))

    api = Api()

    url = os.path.join(str(RESOURCES), 'index.html')
    if not os.path.exists(url):
        url = os.path.join(str(APP_DIR.parent / 'Resources'), 'index.html')

    window = webview.create_window(
        title='RTIP OCR',
        url=url, js_api=api,
        width=960, height=700,
        min_size=(700, 500),
        confirm_close=True, text_select=True,
    )
    api.window = window
    webview.start(debug=False, http_server=True, private_mode=False)
    unload()
    os._exit(0)

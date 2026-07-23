"""
LightOnOCR-2-1B module — optimized for low RAM on Apple Silicon.
Intelligent memory management: auto-resize, cache cleanup, graceful OOM.
"""
import os, base64, torch, threading, gc, tempfile
from pathlib import Path
from PIL import Image
from io import BytesIO

os.environ['TOKENIZERS_PARALLELISM'] = 'false'

MODEL_ID = 'lightonai/LightOnOCR-2-1B'
CACHE_DIR = Path.home() / '.cache' / 'huggingface' / 'hub'

model = None
processor = None
model_lock = threading.Lock()
model_loaded = False

# Model's native input size (from config: image_size=1540)
MAX_IMAGE_DIM = 1540
MAX_TOKENS = 1024


def _free_memory():
    gc.collect()
    if torch.backends.mps.is_available():
        torch.mps.empty_cache()


def unload():
    global model, processor, model_loaded
    with model_lock:
        for obj in [model, processor]:
            if obj is not None:
                del obj
        model = None
        processor = None
        model_loaded = False
    _free_memory()


def ensure_loaded():
    global model, processor, model_loaded
    with model_lock:
        if model is not None and processor is not None:
            model_loaded = True
            return True
        try:
            from transformers import LightOnOcrForConditionalGeneration, AutoProcessor
            device = 'mps' if torch.backends.mps.is_available() else 'cpu'

            processor = AutoProcessor.from_pretrained(MODEL_ID, trust_remote_code=True)
            model = LightOnOcrForConditionalGeneration.from_pretrained(
                MODEL_ID, dtype=torch.float32, trust_remote_code=True)
            model = model.to(device)
            model.eval()
            model_loaded = True
            _free_memory()
            return True
        except Exception as e:
            import traceback; traceback.print_exc()
            model_loaded = False
            return False


def is_loaded():
    return model_loaded


def is_available():
    return any(Path(CACHE_DIR).glob('models--lightonai--LightOnOCR-2-1B'))


def _resize_if_needed(img):
    """Resize image if larger than model's native resolution to save RAM."""
    w, h = img.size
    if max(w, h) > MAX_IMAGE_DIM:
        ratio = MAX_IMAGE_DIM / max(w, h)
        img = img.resize((int(w * ratio), int(h * ratio)), Image.LANCZOS)
    return img


def ocr_image(image_path, prompt="Extract all text from this image."):
    """
    OCR with memory safety: resizes large images, cleans GPU cache after,
    handles errors without leaking RAM.
    """
    if not ensure_loaded():
        raise RuntimeError("LightOnOCR model not loaded")

    with model_lock:
        device = next(model.parameters()).device

        # Load + resize
        if str(image_path).startswith('http'):
            import requests
            img = Image.open(requests.get(image_path, stream=True).raw)
        else:
            img = Image.open(image_path).convert('RGB')
        img = _resize_if_needed(img)

        # Save to temp for processor
        tmp = tempfile.NamedTemporaryFile(suffix='.png', delete=False)
        tmp_name = tmp.name
        tmp.close()
        img.save(tmp_name, 'PNG')

        output_text = ""
        try:
            conv = [{'role': 'user', 'content': [{'type': 'image', 'url': tmp_name}]}]
            inputs = processor.apply_chat_template(
                conv, add_generation_prompt=True,
                tokenize=True, return_dict=True, return_tensors='pt')
            inputs = {k: v.to(device) if hasattr(v, 'to') else v for k, v in inputs.items()}

            with torch.no_grad():
                ids = model.generate(**inputs, max_new_tokens=MAX_TOKENS, use_cache=True)
            gen = ids[0, inputs['input_ids'].shape[1]:]
            output_text = processor.decode(gen, skip_special_tokens=True)

            # Cleanup immediately
            del ids, gen, inputs, img, conv
            _free_memory()
        except torch.OutOfMemoryError:
            output_text = "[OOM: image too large, try reducing size]"
        except Exception as e:
            output_text = f"[OCR error: {e}]"
        finally:
            try: os.unlink(tmp_name)
            except: pass
            _free_memory()

    return output_text


def ocr_image_b64(b64_data, prompt="Extract all text from this document."):
    img_bytes = base64.b64decode(b64_data)
    with tempfile.NamedTemporaryFile(suffix='.png', delete=False) as f:
        f.write(img_bytes)
        tp = f.name
    try:
        img = Image.open(BytesIO(img_bytes)).convert('RGB')
        img.save(tp, 'PNG')
        return ocr_image(tp, prompt)
    finally:
        try: os.unlink(tp)
        except: pass

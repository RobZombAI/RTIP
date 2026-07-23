"""
LightOnOCR-2-1B — RAM-efficient inference on Apple Silicon.
float16, streaming, aggressive cleanup.
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

MAX_IMAGE_DIM = 1540
MAX_TOKENS = 768  # further reduced — enough for page-sized OCR


def _cleanup():
    """Aggressive release of GPU + CPU memory."""
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
    _cleanup()


def ensure_loaded():
    global model, processor, model_loaded
    with model_lock:
        if model is not None and processor is not None:
            model_loaded = True
            return True
        try:
            from transformers import LightOnOcrForConditionalGeneration, AutoProcessor
            device = 'mps' if torch.backends.mps.is_available() else 'cpu'
            dtype = torch.float16 if device == 'mps' else torch.float32

            processor = AutoProcessor.from_pretrained(MODEL_ID, trust_remote_code=True)
            model = LightOnOcrForConditionalGeneration.from_pretrained(
                MODEL_ID, dtype=dtype, trust_remote_code=True)
            model = model.to(device)
            model.eval()
            model._cleanup = _cleanup
            model_loaded = True
            _cleanup()
            return True
        except Exception as e:
            import traceback; traceback.print_exc()
            model_loaded = False
            return False


def is_loaded():
    return model_loaded


def is_available():
    return any(Path(CACHE_DIR).glob('models--lightonai--LightOnOCR-2-1B'))


def _resize(img):
    w, h = img.size
    if max(w, h) > MAX_IMAGE_DIM:
        r = MAX_IMAGE_DIM / max(w, h)
        img = img.resize((int(w * r), int(h * r)), Image.LANCZOS)
    return img


def ocr_image(image_path, prompt="Extract all text from this image."):
    """OCR a single image. Returns text. Frees memory after."""
    if not ensure_loaded():
        raise RuntimeError("model not loaded")

    with model_lock:
        device = next(model.parameters()).device

        if str(image_path).startswith('http'):
            import requests
            img = Image.open(requests.get(image_path, stream=True).raw)
        else:
            img = Image.open(image_path).convert('RGB')
        img = _resize(img)

        tmp = tempfile.NamedTemporaryFile(suffix='.png', delete=False)
        tn = tmp.name
        tmp.close()
        img.save(tn, 'PNG')

        try:
            conv = [{'role': 'user', 'content': [{'type': 'image', 'url': tn}]}]
            inputs = processor.apply_chat_template(
                conv, add_generation_prompt=True,
                tokenize=True, return_dict=True, return_tensors='pt')
            inputs = {k: v.to(device, dtype=torch.float16) if v.is_floating_point() else v.to(device)
                      for k, v in inputs.items()}

            with torch.no_grad():
                ids = model.generate(**inputs, max_new_tokens=MAX_TOKENS, use_cache=True)
            gen = ids[0, inputs['input_ids'].shape[1]:]
            text = processor.decode(gen, skip_special_tokens=True)

            # Immediately free everything
            del ids, gen, inputs, img, conv
            _cleanup()
        except torch.OutOfMemoryError:
            text = ""
            _cleanup()
        except Exception as e:
            text = f"[error: {e}]"
            _cleanup()
        finally:
            try: os.unlink(tn)
            except: pass

    return text


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

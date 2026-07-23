"""
LightOnOCR-2-1B module for RTIP — direct PyTorch/MPS inference
No llama-server needed. Loads/unloads on demand.
"""
import os, base64, torch, threading, time
from pathlib import Path
from PIL import Image
from io import BytesIO
from datetime import datetime

os.environ['TOKENIZERS_PARALLELISM'] = 'false'

MODEL_ID = 'lightonai/LightOnOCR-2-1B'
CACHE_DIR = Path.home() / '.cache' / 'huggingface' / 'hub'

model = None
processor = None
model_lock = threading.Lock()
model_loaded = False
last_used = None


def unload():
    """Free the model from memory."""
    global model, processor, model_loaded
    with model_lock:
        if model is not None:
            del model
            model = None
        if processor is not None:
            del processor
            processor = None
        model_loaded = False
    if torch.backends.mps.is_available():
        torch.mps.empty_cache()


def ensure_loaded():
    """Load model if not loaded. Thread-safe."""
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
                MODEL_ID, dtype=torch.float32, trust_remote_code=True,
            )
            model = model.to(device)
            model.eval()
            model_loaded = True
            return True
        except Exception as e:
            import traceback
            traceback.print_exc()
            model_loaded = False
            return False


def is_loaded():
    return model_loaded


def is_available():
    """Check if model files exist in cache."""
    return any(Path(CACHE_DIR).glob('models--lightonai--LightOnOCR-2-1B'))


def ocr_image(image_path, prompt="Extract all text from this image."):
    """Run OCR on a single image. Blocks until complete."""
    global last_used
    last_used = datetime.now()

    if not ensure_loaded():
        raise RuntimeError("LightOnOCR model not loaded")

    with model_lock:
        device = next(model.parameters()).device

        # Load image from path or URL
        if str(image_path).startswith('http'):
            import requests
            img = Image.open(requests.get(image_path, stream=True).raw)
        else:
            img = Image.open(image_path).convert('RGB')

        conversation = [{'role': 'user', 'content': [{'type': 'image', 'url': str(image_path)}]}]
        inputs = processor.apply_chat_template(
            conversation,
            add_generation_prompt=True,
            tokenize=True,
            return_dict=True,
            return_tensors='pt',
        )
        inputs = {k: v.to(device) if hasattr(v, 'to') else v for k, v in inputs.items()}

        with torch.no_grad():
            output_ids = model.generate(**inputs, max_new_tokens=2048, use_cache=True)
        generated_ids = output_ids[0, inputs['input_ids'].shape[1]:]
        output_text = processor.decode(generated_ids, skip_special_tokens=True)

    return output_text


def ocr_image_b64(b64_data, prompt="Extract all text from this document."):
    """Run OCR on a base64-encoded image."""
    img_bytes = base64.b64decode(b64_data)
    import tempfile
    with tempfile.NamedTemporaryFile(suffix='.png', delete=False) as f:
        f.write(img_bytes)
        tmp_path = f.name
    try:
        # Save to disk first for URL-based loading
        img = Image.open(BytesIO(img_bytes)).convert('RGB')
        img.save(tmp_path, 'PNG')
        return ocr_image(tmp_path, prompt)
    finally:
        os.unlink(tmp_path)

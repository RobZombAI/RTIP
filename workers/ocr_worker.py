#!/usr/bin/env python3
"""
RTIP OCR Worker — LightOnOCR-2-1B inference server.
HTTP API: POST / with {"image_path": "...", "prompt": "..."}
         -> {"text": "...", "error": "..."}
"""
import sys, os, json, argparse
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse

os.environ['TOKENIZERS_PARALLELISM'] = 'false'

MODEL_ID = 'lightonai/LightOnOCR-2-1B'
model = None
processor = None


def load_model():
    global model, processor
    if model is not None:
        return True
    try:
        import torch
        from transformers import LightOnOcrForConditionalGeneration, AutoProcessor
        print("[OCR] Loading model...", file=sys.stderr)
        model = LightOnOcrForConditionalGeneration.from_pretrained(MODEL_ID, torch_dtype=torch.float16)
        if torch.backends.mps.is_available():
            model = model.to("mps")
        processor = AutoProcessor.from_pretrained(MODEL_ID)
        print("[OCR] Model loaded", file=sys.stderr)
        return True
    except Exception as e:
        print(f"[OCR] Load error: {e}", file=sys.stderr)
        model = processor = None
        return False


def ocr_image(image_path, prompt="Extract all text from this image."):
    import torch
    from PIL import Image
    
    image = Image.open(image_path).convert("RGB")
    w, h = image.size
    max_dim = 1540
    if w > max_dim or h > max_dim:
        scale = max_dim / max(w, h)
        image = image.resize((int(w * scale), int(h * scale)))
    
    inputs = processor(text=[prompt], images=[image], return_tensors="pt")
    if torch.backends.mps.is_available():
        inputs = {k: v.to("mps") if hasattr(v, 'to') else v for k, v in inputs.items()}
    
    generated_ids = model.generate(
        **inputs,
        max_new_tokens=768,
        do_sample=False,
        num_beams=1,
    )
    generated_ids = generated_ids[:, inputs['input_ids'].shape[1]:]
    result = processor.batch_decode(generated_ids, skip_special_tokens=True)[0]
    
    import gc
    gc.collect()
    if torch.backends.mps.is_available():
        torch.mps.empty_cache()
    
    return result.strip()


class OCRHandler(BaseHTTPRequestHandler):
    def do_POST(self):
        length = int(self.headers.get('Content-Length', 0))
        body = self.rfile.read(length).decode('utf-8')
        
        try:
            data = json.loads(body)
            path = data.get('image_path', '')
            prompt = data.get('prompt', 'Extract all text from this image.')
            
            result = {'text': '', 'error': ''}
            if not load_model():
                result['error'] = 'Model not loaded'
            elif not os.path.exists(path):
                result['error'] = f'File not found: {path}'
            else:
                result['text'] = ocr_image(path, prompt)
        except Exception as e:
            result = {'text': '', 'error': str(e)}
        
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.end_headers()
        self.wfile.write(json.dumps(result).encode('utf-8'))
    
    def do_GET(self):
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.end_headers()
        self.wfile.write(json.dumps({'status': 'running'}).encode('utf-8'))
    
    def log_message(self, format, *args):
        pass  # silent


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--port', type=int, default=9101)
    args = parser.parse_args()
    
    server = HTTPServer(('127.0.0.1', args.port), OCRHandler)
    print(f"[OCR] Worker ready on :{args.port}", file=sys.stderr)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        server.shutdown()


if __name__ == '__main__':
    main()

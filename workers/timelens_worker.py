#!/usr/bin/env python3
"""
RTIP TimeLens Worker — TimeLens2-8B video temporal grounding.
HTTP API: POST / with {"video_path": "...", "query": "..."}
         -> {"intervals": [[s,e],...], "raw": "...", "error": "..."}
"""
import sys, os, json, argparse, gc, torch
from http.server import HTTPServer, BaseHTTPRequestHandler
from pathlib import Path

os.environ['TOKENIZERS_PARALLELISM'] = 'false'

MODEL_ID = 'MCG-NJU/TimeLens2-8B'
model = None
processor = None


def load_model():
    global model, processor
    if model is not None:
        return True
    try:
        from qwen_vl_utils import process_vision_info
        from transformers import AutoProcessor
        from transformers.models.qwen3_vl import Qwen3VLForConditionalGeneration
        
        print("[TimeLens] Loading model...", file=sys.stderr)
        dtype = torch.bfloat16 if torch.backends.mps.is_available() else torch.float16
        
        model = Qwen3VLForConditionalGeneration.from_pretrained(
            MODEL_ID, torch_dtype=dtype,
            attn_implementation="eager", low_cpu_mem_usage=True,
        )
        model = model.to("mps" if torch.backends.mps.is_available() else "cpu")
        model.eval()
        processor = AutoProcessor.from_pretrained(MODEL_ID)
        print("[TimeLens] Model loaded", file=sys.stderr)
        return True
    except Exception as e:
        print(f"[TimeLens] Load error: {e}", file=sys.stderr)
        import traceback; traceback.print_exc()
        model = processor = None
        return False


def process_video(video_path, query):
    from qwen_vl_utils import process_vision_info
    
    prompt = (
        f'Given the query: "{query}", return ALL time spans (in seconds) where the query is relevant.\n'
        "Output format MUST be a JSON array of [start, end] pairs.\n"
    )
    messages = [{
        "role": "user",
        "content": [
            {"type": "video", "video": Path(video_path).resolve().as_uri(),
             "fps": 2.0, "min_pixels": 32*32, "max_pixels": 480*480,
             "total_pixels": 128000 * 32 * 32},
            {"type": "text", "text": prompt},
        ],
    }]
    
    with torch.no_grad():
        text = processor.apply_chat_template(messages, tokenize=False, add_generation_prompt=True)
        images, videos, video_kwargs = process_vision_info(
            messages, image_patch_size=16,
            return_video_kwargs=True, return_video_metadata=True,
        )
        if videos is not None:
            videos, video_metadatas = zip(*videos)
            videos, video_metadatas = list(videos), list(video_metadatas)
        else:
            video_metadatas = None
        
        inputs = processor(text=text, images=images, videos=videos,
                          video_metadata=video_metadatas, do_resize=False,
                          return_tensors="pt", **video_kwargs).to(model.device)
        
        output_ids = model.generate(**inputs, max_new_tokens=4096,
            temperature=0.01, top_p=0.001, top_k=1, repetition_penalty=1.0)
        output_ids = [out[len(inputs.input_ids):] for out in output_ids]
        response = processor.batch_decode(output_ids, skip_special_tokens=True,
                                         clean_up_tokenization_spaces=False)[0]
        
        gc.collect()
        if torch.backends.mps.is_available():
            torch.mps.empty_cache()
        
        # Parse intervals from response
        intervals = []
        try:
            parsed = json.loads(response)
            if isinstance(parsed, list):
                intervals = parsed
        except:
            pass
        
        return intervals, response


class TimeLensHandler(BaseHTTPRequestHandler):
    def do_POST(self):
        length = int(self.headers.get('Content-Length', 0))
        body = self.rfile.read(length).decode('utf-8')
        
        try:
            data = json.loads(body)
            video_path = data.get('video_path', '')
            query = data.get('query', '')
            
            result = {'intervals': [], 'raw': '', 'error': ''}
            if not load_model():
                result['error'] = 'Model not loaded'
            elif not os.path.exists(video_path):
                result['error'] = f'File not found: {video_path}'
            elif not query.strip():
                result['error'] = 'Empty query'
            else:
                intervals, raw = process_video(video_path, query)
                result['intervals'] = intervals
                result['raw'] = raw
        except Exception as e:
            result = {'intervals': [], 'raw': '', 'error': str(e)}
        
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
        pass


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--port', type=int, default=9102)
    args = parser.parse_args()
    
    server = HTTPServer(('127.0.0.1', args.port), TimeLensHandler)
    print(f"[TimeLens] Worker ready on :{args.port}", file=sys.stderr)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        server.shutdown()


if __name__ == '__main__':
    main()

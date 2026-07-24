#!/usr/bin/env python3
"""
RTIP TimeLens Worker — TimeLens2-8B video temporal grounding.
HTTP API: POST / with {"video_path": "...", "query": "..."}
         -> {"intervals": [[s,e],...], "raw": "...", "error": "..."}

Model is loaded on startup (blocks until ready or failed).
On failure, returns {"status": "error", "message": "..."} for all requests.
"""
import sys, os, json, argparse, gc, torch, threading
from http.server import HTTPServer, BaseHTTPRequestHandler
from pathlib import Path

os.environ['TOKENIZERS_PARALLELISM'] = 'false'

MODEL_ID = 'MCG-NJU/TimeLens2-8B'
model = None
processor = None
load_status = 'loading'  # 'loading' | 'ready' | 'error'
load_error = ''


def _cleanup():
    gc.collect()
    if torch.backends.mps.is_available():
        torch.mps.empty_cache()


def load_model():
    global model, processor, load_status, load_error
    # Auto-install torchcodec if missing
    try:
        import torchcodec
    except ImportError:
        import subprocess as _subprocess, sys as _sys
        print("[TimeLens] Installing torchcodec for video reading...", file=_sys.stderr)
        _subprocess.run([_sys.executable, '-m', 'pip', 'install', 'torchcodec', '-q'],
                      capture_output=True, timeout=120)
    try:
        from qwen_vl_utils import process_vision_info  # verify importable
        from transformers import AutoProcessor
        from transformers.models.qwen3_vl import Qwen3VLForConditionalGeneration

        print("[TimeLens] Loading model... (this may take a while for first download)", file=sys.stderr)
        dtype = torch.bfloat16 if torch.backends.mps.is_available() else torch.float16

        model = Qwen3VLForConditionalGeneration.from_pretrained(
            MODEL_ID, torch_dtype=dtype,
            attn_implementation="eager", low_cpu_mem_usage=True,
        )
        model = model.to("mps" if torch.backends.mps.is_available() else "cpu")
        model.eval()
        processor = AutoProcessor.from_pretrained(MODEL_ID)
        load_status = 'ready'
        print("[TimeLens] Model loaded successfully", file=sys.stderr)
    except Exception as e:
        print(f"[TimeLens] Load error: {e}", file=sys.stderr)
        load_status = 'error'
        load_error = str(e)
        model = processor = None


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
             "fps": 0.5, "min_pixels": 16*16, "max_pixels": 224*224,
             "total_pixels": 16000 * 16 * 16},
            {"type": "text", "text": prompt},
        ],
    }]

    # Clean MPS cache before processing
    _cleanup()

    try:
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

            output_ids = model.generate(**inputs, max_new_tokens=1024,
                temperature=0.01, top_p=0.001, top_k=1, repetition_penalty=1.0)
            output_ids = [out[len(inputs.input_ids):] for out in output_ids]
            response = processor.batch_decode(output_ids, skip_special_tokens=True,
                                             clean_up_tokenization_spaces=False)[0]

            _cleanup()

            intervals = []
            try:
                # Cerca l'ultimo array JSON nella risposta
                import re
                matches = re.findall(r'\[[\d.,\s\[\]]+\]', response)
                for m in reversed(matches):
                    parsed = json.loads(m)
                    if isinstance(parsed, list) and len(parsed) > 0 and isinstance(parsed[0], (list, tuple)):
                        intervals = parsed
                        break
            except:
                pass

            return intervals, response
    except RuntimeError as e:
        # MPS crash — force cleanup and return error
        print(f"[TimeLens] MPS error: {e}", file=sys.stderr)
        _cleanup()
        return [], str(e)


class TimeLensHandler(BaseHTTPRequestHandler):
    def do_POST(self):
        # If model not ready, return error immediately
        if load_status != 'ready':
            err_msg = load_error if load_status == 'error' else 'Model still loading, please wait'
            result = {'intervals': [], 'raw': '', 'error': err_msg}
            self._json_response(result)
            return

        length = int(self.headers.get('Content-Length', 0))
        body = self.rfile.read(length).decode('utf-8')

        try:
            data = json.loads(body)
            video_path = data.get('video_path', '')
            query = data.get('query', '')

            result = {'intervals': [], 'raw': '', 'error': ''}
            if not os.path.exists(video_path):
                result['error'] = f'File not found: {video_path}'
            elif not query.strip():
                result['error'] = 'Empty query'
            else:
                print(f"[TimeLens] Processing: {video_path} | query: {query}", file=sys.stderr)
                intervals, raw = process_video(video_path, query)
                result['intervals'] = intervals
                result['raw'] = raw
                print(f"[TimeLens] Done: {len(intervals)} intervals", file=sys.stderr)
        except Exception as e:
            result = {'intervals': [], 'raw': '', 'error': str(e)}
            print(f"[TimeLens] Error: {e}", file=sys.stderr)

        self._json_response(result)

    def do_GET(self):
        self._json_response({'status': load_status, 'message': load_error})

    def _json_response(self, data):
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.end_headers()
        self.wfile.write(json.dumps(data).encode('utf-8'))

    def log_message(self, format, *args):
        pass


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--port', type=int, default=9102)
    args = parser.parse_args()

    # Start model loading in background thread
    loader = threading.Thread(target=load_model, daemon=True)
    loader.start()

    # Start HTTP server immediately (model loads in background)
    server = HTTPServer(('127.0.0.1', args.port), TimeLensHandler)
    print(f"[TimeLens] Worker ready on :{args.port} (model loading in background)", file=sys.stderr)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        server.shutdown()


if __name__ == '__main__':
    main()

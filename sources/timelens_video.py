"""
TimeLens2-8B — Video temporal grounding on Apple Silicon.
Given a video and text query, returns time intervals [start, end] in seconds.
"""
import os, sys, json, torch, gc, threading, time
from pathlib import Path

os.environ['TOKENIZERS_PARALLELISM'] = 'false'

MODEL_ID = 'MCG-NJU/TimeLens2-8B'

model = None
processor = None
model_lock = threading.Lock()
model_loaded = False
loading = False


def _cleanup():
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
    global model, processor, model_loaded, loading
    with model_lock:
        if model is not None and processor is not None:
            model_loaded = True
            return True
        if loading:
            return False  # already loading in another thread
        loading = True

    try:
        from qwen_vl_utils import process_vision_info  # noqa: ensure it's importable
        from transformers import AutoProcessor
        from transformers.models.qwen3_vl import Qwen3VLForConditionalGeneration

        if torch.backends.mps.is_available():
            dtype = torch.bfloat16
            device = "mps"
        else:
            dtype = torch.float16
            device = "cpu"

        print(f"[TimeLens2] Loading {MODEL_ID} ({dtype}) on {device}...", file=sys.stderr)

        model = Qwen3VLForConditionalGeneration.from_pretrained(
            MODEL_ID,
            torch_dtype=dtype,
            attn_implementation="eager",
            low_cpu_mem_usage=True,
        )
        model = model.to(device)
        model.eval()

        processor = AutoProcessor.from_pretrained(MODEL_ID)

        with model_lock:
            model_loaded = True
            loading = False
        print(f"[TimeLens2] Loaded successfully", file=sys.stderr)
        return True
    except Exception as e:
        print(f"[TimeLens2] Load error: {e}", file=sys.stderr)
        import traceback
        traceback.print_exc()
        with model_lock:
            model = None
            processor = None
            model_loaded = False
            loading = False
        return False


def is_loaded():
    return model is not None and processor is not None


def process_video(video_path, query, cancel_event=None):
    """Process a video with TimeLens2 and return time intervals as JSON string."""
    from qwen_vl_utils import process_vision_info

    if model is None or processor is None:
        return json.dumps({"error": "TimeLens2 model not loaded"})

    if cancel_event and cancel_event.is_set():
        return json.dumps({"cancelled": True})

    prompt = (
        f'Given the query: "{query}", return ALL time spans (in seconds) where the query is relevant.\n'
        "Output format MUST be a JSON array of [start, end] pairs.\n"
    )
    messages = [
        {
            "role": "user",
            "content": [
                {
                    "type": "video",
                    "video": Path(video_path).resolve().as_uri(),
                    "fps": 2.0,
                    "min_pixels": 32 * 32,
                    "max_pixels": 480 * 480,
                    "total_pixels": 128000 * 32 * 32,
                },
                {"type": "text", "text": prompt},
            ],
        }
    ]

    if cancel_event and cancel_event.is_set():
        return json.dumps({"cancelled": True})

    with torch.no_grad():
        text = processor.apply_chat_template(
            messages,
            tokenize=False,
            add_generation_prompt=True,
        )
        images, videos, video_kwargs = process_vision_info(
            messages,
            image_patch_size=16,
            return_video_kwargs=True,
            return_video_metadata=True,
        )

        if cancel_event and cancel_event.is_set():
            return json.dumps({"cancelled": True})

        if videos is not None:
            videos, video_metadatas = zip(*videos)
            videos, video_metadatas = list(videos), list(video_metadatas)
        else:
            video_metadatas = None

        inputs = processor(
            text=text,
            images=images,
            videos=videos,
            video_metadata=video_metadatas,
            do_resize=False,
            return_tensors="pt",
            **video_kwargs,
        ).to(model.device)

        if cancel_event and cancel_event.is_set():
            return json.dumps({"cancelled": True})

        output_ids = model.generate(
            **inputs,
            max_new_tokens=4096,
            temperature=0.01,
            top_p=0.001,
            top_k=1,
            repetition_penalty=1.0,
        )
        output_ids = [
            output[len(input_ids):]
            for input_ids, output in zip(inputs.input_ids, output_ids)
        ]
        response = processor.batch_decode(
            output_ids,
            skip_special_tokens=True,
            clean_up_tokenization_spaces=False,
        )

        _cleanup()
        return response[0]

import os
# Must be set BEFORE importing torch so MPS uses CPU fallback for unsupported ops.
os.environ.setdefault("PYTORCH_ENABLE_MPS_FALLBACK", "1")

import base64
import io
import time
import threading
from pathlib import Path

import soundfile as sf
from flask import Flask, jsonify, request, send_file, render_template
from PIL import Image

from tiny_tts import TinyTTS

app = Flask(__name__)
app.config["TEMPLATES_AUTO_RELOAD"] = True
app.jinja_env.auto_reload = True
app.config["SEND_FILE_MAX_AGE_DEFAULT"] = 0

# ---------- Lazy model singletons ----------
_tts = None
_tts_lock = threading.Lock()

_moondream = None
_moondream_lock = threading.Lock()

_translator = None
_translator_lock = threading.Lock()

_silero = None
_silero_lock = threading.Lock()


def get_tts():
    global _tts
    if _tts is None:
        with _tts_lock:
            if _tts is None:
                print("[tinytts] loading...")
                _tts = TinyTTS(device="cpu")
                print("[tinytts] ready.")
    return _tts


def get_moondream():
    """Load Moondream2 onto MPS (Apple Silicon GPU) in fp16. Falls back to CPU.

    Returns (model, tokenizer, device_str).
    """
    global _moondream
    if _moondream is None:
        with _moondream_lock:
            if _moondream is None:
                import torch
                from transformers import AutoModelForCausalLM, AutoTokenizer

                revision = "2025-01-09"
                if torch.backends.mps.is_available():
                    device = torch.device("mps")
                    dtype = torch.float16
                    dev_str = "mps/fp16"
                else:
                    device = torch.device("cpu")
                    dtype = torch.float32
                    dev_str = "cpu/fp32"

                print(f"[moondream] loading {revision} on {dev_str}...")
                mdl = AutoModelForCausalLM.from_pretrained(
                    "vikhyatk/moondream2",
                    revision=revision,
                    trust_remote_code=True,
                    torch_dtype=dtype,
                )
                mdl = mdl.to(device).eval()
                tok = AutoTokenizer.from_pretrained(
                    "vikhyatk/moondream2", revision=revision
                )
                _moondream = (mdl, tok, dev_str)
                print(f"[moondream] ready ({dev_str}).")
    return _moondream


def get_translator():
    global _translator
    if _translator is None:
        with _translator_lock:
            if _translator is None:
                from transformers import AutoTokenizer, AutoModelForSeq2SeqLM

                print("[translator] loading Helsinki-NLP/opus-mt-en-ru...")
                tok = AutoTokenizer.from_pretrained("Helsinki-NLP/opus-mt-en-ru")
                mdl = AutoModelForSeq2SeqLM.from_pretrained(
                    "Helsinki-NLP/opus-mt-en-ru"
                )
                mdl.eval()
                _translator = (tok, mdl)
                print("[translator] ready.")
    return _translator


def get_silero():
    global _silero
    if _silero is None:
        with _silero_lock:
            if _silero is None:
                import torch

                print("[silero] loading v4_ru...")
                mdl, _ex = torch.hub.load(
                    repo_or_dir="snakers4/silero-models:master",
                    model="silero_tts",
                    language="ru",
                    speaker="v4_ru",
                    trust_repo=True,
                    skip_validation=True,
                )
                _silero = mdl
                print("[silero] ready.")
    return _silero


OUTPUT_DIR = Path(__file__).parent / "outputs"
OUTPUT_DIR.mkdir(exist_ok=True)


# ---------- Routes ----------
@app.route("/")
def index():
    return render_template("index.html")


@app.route("/synthesize", methods=["POST"])
def synthesize():
    data = request.get_json(silent=True) or {}
    text = (data.get("text") or "").strip()
    try:
        speed = float(data.get("speed", 1.0))
    except (TypeError, ValueError):
        speed = 1.0
    speed = max(0.5, min(2.0, speed))

    if not text:
        return jsonify({"error": "Empty text"}), 400
    if len(text) > 2000:
        return jsonify({"error": "Text too long (max 2000 chars)"}), 400

    tts = get_tts()

    filename = f"out_{int(time.time() * 1000)}.wav"
    out_path = OUTPUT_DIR / filename

    t0 = time.time()
    with _tts_lock:
        tts.speak(text, output_path=str(out_path), speed=speed)
    elapsed = time.time() - t0

    return jsonify({
        "url": f"/audio/{filename}",
        "elapsed_ms": int(elapsed * 1000),
        "filename": filename,
    })


def _polish_ru(text: str) -> str:
    t = (text or "").strip()
    if not t:
        return t
    if t[-1] not in ".!?…":
        t += "."
    return t[0].upper() + t[1:]


@app.route("/describe", methods=["POST"])
def describe():
    data = request.get_json(silent=True) or {}
    image_b64 = data.get("image", "")
    voice = data.get("voice", "baya")

    if not image_b64:
        return jsonify({"error": "No image"}), 400

    # Strip data URL prefix if present
    if "," in image_b64:
        image_b64 = image_b64.split(",", 1)[1]

    try:
        image_bytes = base64.b64decode(image_b64)
        image = Image.open(io.BytesIO(image_bytes)).convert("RGB")
    except Exception as e:
        return jsonify({"error": f"Bad image: {e}"}), 400

    # Down-scale very large frames to keep BLIP fast
    max_side = 512
    if max(image.size) > max_side:
        image.thumbnail((max_side, max_side))

    timings = {}

    # 1) Moondream2 captioning (MPS on Apple Silicon, CPU fallback)
    t0 = time.time()
    md_model, _md_tok, _dev = get_moondream()
    with _moondream_lock:
        result = md_model.query(
            image,
            "Describe what you see in one short sentence. "
            "Mention key visible objects, people if any, colors, and the setting.",
        )
        en_caption = (result.get("answer") or "").strip()
    timings["vision_ms"] = int((time.time() - t0) * 1000)

    # 2) EN -> RU translation
    t0 = time.time()
    tr_tok, tr_mdl = get_translator()
    with _translator_lock:
        tr_inputs = tr_tok(en_caption, return_tensors="pt", truncation=True)
        tr_out = tr_mdl.generate(**tr_inputs, max_new_tokens=80, num_beams=3)
        ru_caption = tr_tok.decode(tr_out[0], skip_special_tokens=True).strip()
    ru_caption = _polish_ru(ru_caption)
    timings["translate_ms"] = int((time.time() - t0) * 1000)

    # 3) Silero TTS
    t0 = time.time()
    silero = get_silero()
    valid_voices = {"aidar", "baya", "kseniya", "xenia", "eugene", "random"}
    if voice not in valid_voices:
        voice = "baya"
    with _silero_lock:
        audio = silero.apply_tts(text=ru_caption, speaker=voice, sample_rate=48000)
    timings["silero_ms"] = int((time.time() - t0) * 1000)

    filename = f"cam_{int(time.time() * 1000)}.wav"
    out_path = OUTPUT_DIR / filename
    sf.write(str(out_path), audio.numpy(), 48000)

    return jsonify({
        "url": f"/audio/{filename}",
        "filename": filename,
        "en": en_caption,
        "ru": ru_caption,
        "timings": timings,
        "total_ms": sum(timings.values()),
    })


@app.route("/audio/<name>")
def audio(name):
    safe = Path(name).name
    path = OUTPUT_DIR / safe
    if not path.exists():
        return jsonify({"error": "Not found"}), 404
    return send_file(path, mimetype="audio/wav", as_attachment=False, download_name=safe)


@app.route("/health")
def health():
    return jsonify({
        "tinytts": _tts is not None,
        "moondream": _moondream is not None,
        "translator": _translator is not None,
        "silero": _silero is not None,
    })


def _bg_warmup():
    # Pre-load tinytts immediately; the camera-stack models wait until first use
    try:
        get_tts()
    except Exception as e:
        print(f"[warmup] tinytts failed: {e}")


if __name__ == "__main__":
    threading.Thread(target=_bg_warmup, daemon=True).start()
    app.run(host="127.0.0.1", port=8000, debug=False)

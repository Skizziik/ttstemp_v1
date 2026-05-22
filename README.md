# tinytts playground

Local web UI for [tiny-tts](https://github.com/tronghieuit/tiny-tts) (1.62M-param English TTS) plus a live camera narration mode that captions webcam frames in Russian.

## Stack

- **TinyTTS** (1.62M params, ~3.4 MB ONNX) — English TTS synthesis
- **Moondream2** (~1.9 GB, revision 2025-01-09) — vision-language model for the camera mode, runs on MPS (Apple Silicon GPU) in fp16
- **Helsinki opus-mt-en-ru** (~300 MB) — EN→RU translation
- **Silero v4_ru** (~60 MB) — Russian TTS (5 voices)
- Flask backend, vanilla JS/CSS frontend

## Setup

```bash
# macOS — libvips is required by Moondream2 (revision 2025-01-09)
brew install vips

python3.13 -m venv venv
source venv/bin/activate
pip install -r requirements.txt

python app.py
# open http://127.0.0.1:8000/
```

First run downloads model checkpoints (~2.3 GB total: Moondream ~1.9 GB + opus-mt ~300 MB + Silero ~60 MB + tinytts ~3 MB).
NLTK resources are also needed once:

```python
import nltk
for pkg in ["averaged_perceptron_tagger_eng", "cmudict", "punkt", "punkt_tab"]:
    nltk.download(pkg)
```

## Features

### English TTS panel
- Textarea, speed slider (0.5×–2.0×), Generate / Download WAV
- Cmd/Ctrl+Enter to generate
- Text library with ~30 sample texts across categories: greetings, conversation, tech, news, narrative, tricky, quotes, long-form, expressive
- Two design themes: `studio` (monochrome, Linear/Vercel-style) and `classic` (purple-accent)

### Live narration panel
Click **Start camera** → it captures a webcam frame, runs `Moondream2 (MPS) → opus-mt → Silero baya`, plays the Russian description, waits 5 s, captures the next frame. Loops until **Stop**.

Voices: baya (female, default), kseniya, xenia, aidar (male), eugene (male).

Warm-cycle timings on M-series MacBook (MPS, fp16):
- Moondream2 vision: ~5.6 s
- Translation: ~500 ms
- Silero: ~700 ms
- Total per cycle: ~6.8 s + audio length + 5 s wait

## Endpoints

| Route | Method | Purpose |
|---|---|---|
| `/` | GET | UI |
| `/synthesize` | POST `{text, speed}` | English TTS via tiny-tts |
| `/describe` | POST `{image, voice}` | Frame → caption → translate → Russian TTS |
| `/audio/<name>` | GET | Serve generated WAV |
| `/health` | GET | Which models are warm |

## Layout

```
templates/index.html      # UI markup
static/style.css          # studio theme
static/style-classic.css  # original purple theme (toggle in header)
static/app.js             # UI logic + camera loop
static/library.js         # text library data
app.py                    # Flask server
```

## Known issues

- Moondream2 is loaded onto MPS via `transformers` + a `trust_remote_code` custom module that hasn't been updated for `transformers>=5`. The project pins `transformers<5` (4.55 line) in `requirements.txt` for that reason.
- Moondream's vision encoder uses ops that don't have native MPS kernels in some torch builds; the app sets `PYTORCH_ENABLE_MPS_FALLBACK=1` at process start so unsupported ops fall back to CPU transparently.
- opus-mt-en-ru sometimes leaves English nouns untranslated (e.g. `"Volkswagen Beetle"`) — that's expected and usually fine for speech.
- Port 5000 conflicts with macOS AirPlay Receiver — that's why the server binds to 8000.

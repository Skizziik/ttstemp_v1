# tinytts playground

Local web UI for [tiny-tts](https://github.com/tronghieuit/tiny-tts) (1.62M-param English TTS) plus a live camera narration mode that captions webcam frames in Russian.

## Stack

- **TinyTTS** (1.62M params, ~3.4 MB ONNX) — English TTS synthesis
- **BLIP base** (~400 MB) — image captioning (English) for the camera mode
- **Helsinki opus-mt-en-ru** (~300 MB) — EN→RU translation
- **Silero v4_ru** (~60 MB) — Russian TTS (5 voices)
- Flask backend, vanilla JS/CSS frontend

## Setup

```bash
python3.13 -m venv venv
source venv/bin/activate
pip install -r requirements.txt

# On macOS: libvips is needed if you ever swap BLIP for Moondream2's newer revision
# brew install vips

python app.py
# open http://127.0.0.1:8000/
```

First run downloads model checkpoints (~800 MB across BLIP + opus-mt + Silero, plus a few MB for TinyTTS).
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
Click **Start camera** → it captures a webcam frame, runs `BLIP → opus-mt → Silero baya`, plays the Russian description, waits 5 s, captures the next frame. Loops until **Stop**.

Voices: baya (female, default), kseniya, xenia, aidar (male), eugene (male).

Warm-cycle timings on a 2024 MacBook Air CPU:
- BLIP: ~600 ms
- Translation: ~200 ms
- Silero: ~600 ms
- Total per cycle: ~1.4 s + audio length + 5 s wait

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

- BLIP captions are short and generic (`"an old car parked in front of a building"`). Moondream2 gives far richer descriptions but is slow on CPU; an MPS path on Apple Silicon is the next thing to try.
- Port 5000 conflicts with macOS AirPlay Receiver — that's why the server binds to 8000.

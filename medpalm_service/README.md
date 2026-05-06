# MedPalm service scaffold

This service gives the existing `NurseChat` flow an OpenAI-compatible chat endpoint that the Supabase `ai-chat` function can forward to.

## What it does

- Exposes `POST /v1/chat/completions`
- Exposes `POST /v1/audio/keyword-detect` for Whisper-based emergency keyword transcription
- Exposes `POST /v1/audio/fall-detect` for the deployed custom fall model from `models/fall`
- Exposes `POST /v1/audio/cough-detect` for the deployed custom cough model from `models/coug`
- Exposes `POST /v1/audio/classify-events` to run both custom audio models in one request
- Supports streaming Server-Sent Events with `data: ...` chunks and `[DONE]`
- Tries to load `torch` and `medpalm.model.MedPalm`
- Tries to load `faster-whisper` for voice keyword detection
- Tries to load TensorFlow for the deployed fall and cough models
- Falls back to a clear placeholder response if the MedPalm package or weights are not installed yet

## Run locally

```bash
cd medpalm_service
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

## Point Nurse Chat at it

Set these in the environment where your Supabase Edge Function runs:

```env
MEDPALM_API_URL=http://host.docker.internal:8000/v1/chat/completions
MEDPALM_API_KEY=
MEDPALM_MODEL_NAME=medpalm
```

For local non-Docker testing, `http://127.0.0.1:8000/v1/chat/completions` is fine.

For the frontend Whisper keyword detector, set:

```env
VITE_MEDPALM_SERVICE_URL=http://127.0.0.1:8000
```

The same service URL is used by:

- Whisper keyword detection
- deployed fall detection
- deployed cough detection

To print Whisper transcripts in the Python terminal while testing, keep this enabled:

```env
WHISPER_DEBUG=true
```

## Current limitation

The sample `MedPalm()` usage produces tensors, not decoded natural-language responses. This scaffold keeps the chat pipeline working, but you will still need model-specific decoding logic once you have the actual MedPalm package, tokenizer, weights, and expected output format.

## Deployed custom audio models

- `models/fall/saved_model.keras` or `models/fall/cnn_fall_detector.h5` is treated as the deployed fall model
- `models/coug/network.h5` with `models/coug/network.json` is treated as the deployed cough model
- Whisper remains a separate speech-to-text component
- Nurse Ada / MedPalm remains a separate chat component

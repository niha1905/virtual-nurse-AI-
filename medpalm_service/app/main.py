import asyncio
import json
import logging
import os
import sys
import tempfile
from pathlib import Path
from typing import Any

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel, Field

if __package__ in {None, ""}:
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
    from audio_models import CoughAudioRuntime, FallAudioRuntime
    from risk_classifier import get_risk_classifier
else:
    from .audio_models import CoughAudioRuntime, FallAudioRuntime
    from .risk_classifier import get_risk_classifier

logger = logging.getLogger("medpalm-service")
logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO"))


class ChatMessage(BaseModel):
    role: str
    content: str


class RiskAnalysisRequest(BaseModel):
    """Request model for risk analysis endpoint"""
    heart_rate: float | None = Field(default=None, description="Heart rate in bpm")
    systolic_bp: float | None = Field(default=None, description="Systolic blood pressure")
    diastolic_bp: float | None = Field(default=None, description="Diastolic blood pressure")
    spo2: float | None = Field(default=None, description="Blood oxygen saturation %")
    temperature_c: float | None = Field(default=None, description="Body temperature in Celsius")
    steps_24h: float | None = Field(default=None, description="Steps in last 24 hours")
    active_minutes_24h: float | None = Field(default=None, description="Active minutes in last 24 hours")
    fall_alerts_24h: float | None = Field(default=None, description="Fall alerts in 24 hours")
    cough_alerts_24h: float | None = Field(default=None, description="Cough alerts in 24 hours")
    help_alerts_24h: float | None = Field(default=None, description="Help requests in 24 hours")
    manual_sos_alerts_7d: float | None = Field(default=None, description="Manual SOS alerts in 7 days")
    high_risk_alerts_7d: float | None = Field(default=None, description="High risk alerts in 7 days")
    pulse_pressure: float | None = Field(default=None, description="Pulse pressure (systolic - diastolic)")
    map_estimate: float | None = Field(default=None, description="Mean arterial pressure")
    shock_index: float | None = Field(default=None, description="Shock index (HR/systolic_bp)")
    spo2_deficit: float | None = Field(default=None, description="Deficit from normal SpO2")
    fever_flag: float | None = Field(default=None, description="Fever flag (1 if temp > 38°C)")
    hypoxia_flag: float | None = Field(default=None, description="Hypoxia flag (1 if SpO2 < 94%)")
    severe_hypoxia_flag: float | None = Field(default=None, description="Severe hypoxia flag (1 if SpO2 < 90%)")
    tachycardia_flag: float | None = Field(default=None, description="Tachycardia flag (1 if HR > 100)")
    hypotension_flag: float | None = Field(default=None, description="Hypotension flag (1 if systolic_bp < 90)")
    low_steps_flag: float | None = Field(default=None, description="Low steps flag")
    low_activity_minutes_flag: float | None = Field(default=None, description="Low activity flag")
    history_condition_count: float | None = Field(default=None, description="Count of medical conditions")
    note_issue_count: float | None = Field(default=None, description="Count of issues in notes")
    event_burden_24h: float | None = Field(default=None, description="Event burden in 24 hours")
    event_burden_7d: float | None = Field(default=None, description="Event burden in 7 days")
    weighted_event_burden: float | None = Field(default=None, description="Weighted event burden")
    cough_hypoxia_interaction: float | None = Field(default=None, description="Cough-hypoxia interaction")
    cough_fever_interaction: float | None = Field(default=None, description="Cough-fever interaction")
    fall_hypotension_interaction: float | None = Field(default=None, description="Fall-hypotension interaction")
    fall_low_mobility_interaction: float | None = Field(default=None, description="Fall-low mobility interaction")
    help_recurrence_interaction: float | None = Field(default=None, description="Help recurrence interaction")
    sos_fall_interaction: float | None = Field(default=None, description="SOS-fall interaction")
    instability_index: float | None = Field(default=None, description="Overall instability index")
    activity_level: str | None = Field(default="moderate", description="Activity level (low, moderate, active, bed_bound)")


class RiskAnalysisResponse(BaseModel):
    """Response model for risk analysis endpoint"""
    risk_level: str | None = Field(description="Risk level: LOW, MEDIUM, or HIGH")
    confidence: float = Field(description="Confidence score (0-1)")
    probabilities: dict[str, float] = Field(description="Probability for each risk class")
    explanation: str = Field(description="Human-readable explanation")
    features_used: list[str] | None = Field(default=None, description="Features used in prediction")
    error: str | None = Field(default=None, description="Error message if prediction failed")


class ChatCompletionRequest(BaseModel):
    model: str = "medpalm"
    messages: list[ChatMessage] = Field(default_factory=list)
    stream: bool = True


class WhisperRuntime:
    def __init__(self) -> None:
        self.model_size = os.getenv("WHISPER_MODEL_SIZE", "small")
        self.device = os.getenv("WHISPER_DEVICE", "cpu")
        self.compute_type = os.getenv("WHISPER_COMPUTE_TYPE", "int8")
        self.beam_size = int(os.getenv("WHISPER_BEAM_SIZE", "1"))
        self.language = os.getenv("WHISPER_LANGUAGE") or None
        self.debug = os.getenv("WHISPER_DEBUG", "true").lower() == "true"
        self._model: Any | None = None
        self._import_error: Exception | None = None
        self._load_attempted = False

    def _load(self) -> None:
        if self._load_attempted:
            return

        self._load_attempted = True

        try:
            from faster_whisper import WhisperModel  # type: ignore

            self._model = WhisperModel(
                self.model_size,
                device=self.device,
                compute_type=self.compute_type,
            )
            logger.info(
                "Whisper model initialized: size=%s device=%s compute_type=%s",
                self.model_size,
                self.device,
                self.compute_type,
            )
        except Exception as exc:  # pragma: no cover - depends on local model install
            self._import_error = exc
            logger.warning("Whisper model unavailable: %s", exc)

    @property
    def ready(self) -> bool:
        self._load()
        return self._model is not None

    def transcribe(self, audio_path: str, language: str | None = None) -> dict[str, Any]:
        if not self.ready or self._model is None:
            raise RuntimeError(
                "Whisper model is not available. Install faster-whisper and model dependencies first."
            )

        segments, info = self._model.transcribe(
            audio_path,
            beam_size=self.beam_size,
            language=language or self.language,
            vad_filter=True,
        )
        transcript = " ".join(segment.text.strip() for segment in segments).strip()
        detected_language = getattr(info, "language", language or self.language or "unknown")
        language_probability = getattr(info, "language_probability", None)
        duration = getattr(info, "duration", None)

        if self.debug:
            logger.info(
                "Whisper transcript | language=%s prob=%s duration=%s text=%r",
                detected_language,
                f"{language_probability:.3f}" if isinstance(language_probability, (int, float)) else "n/a",
                f"{duration:.2f}s" if isinstance(duration, (int, float)) else "n/a",
                transcript,
            )

        return {
            "transcript": transcript,
            "language": detected_language,
            "duration": duration,
            "language_probability": language_probability,
        }


class MedPalmRuntime:
    def __init__(self) -> None:
        self.device = os.getenv("MEDPALM_DEVICE", "cpu")
        self.max_text_tokens = int(os.getenv("MEDPALM_MAX_TEXT_TOKENS", "4096"))
        self.image_size = int(os.getenv("MEDPALM_IMAGE_SIZE", "256"))
        self._model: Any | None = None
        self._torch: Any | None = None
        self._import_error: Exception | None = None
        self._load_attempted = False

    def _load(self) -> None:
        if self._load_attempted:
            return

        self._load_attempted = True

        try:
            import torch  # type: ignore
            from medpalm.model import MedPalm  # type: ignore

            self._torch = torch
            self._model = MedPalm()
            self._model.eval()

            if self.device != "cpu" and hasattr(self._model, "to"):
                self._model = self._model.to(self.device)

            logger.info("MedPalm model initialized on %s", self.device)
        except Exception as exc:  # pragma: no cover - depends on local model install
            self._import_error = exc
            logger.warning("MedPalm model unavailable, using fallback mode: %s", exc)

    @property
    def ready(self) -> bool:
        self._load()
        return self._model is not None and self._torch is not None

    def _build_prompt(self, messages: list[ChatMessage]) -> str:
        return "\n".join(f"{message.role.upper()}: {message.content.strip()}" for message in messages)

    def _tokenize_text(self, prompt: str) -> Any:
        if not self._torch:
            raise RuntimeError("Torch is not loaded.")

        # Placeholder tokenization so the scaffold matches the MedPalm example shape.
        encoded = [ord(char) % 20000 for char in prompt][: self.max_text_tokens]
        if not encoded:
            encoded = [0]
        if len(encoded) < self.max_text_tokens:
            encoded.extend([0] * (self.max_text_tokens - len(encoded)))

        return self._torch.tensor([encoded], dtype=self._torch.long)

    def _dummy_image(self) -> Any:
        if not self._torch:
            raise RuntimeError("Torch is not loaded.")

        return self._torch.randn(1, 3, self.image_size, self.image_size)

    def generate_text(self, messages: list[ChatMessage]) -> str:
        prompt = self._build_prompt(messages)

        if not prompt.strip():
            return "Please tell me what symptoms or health concern you want help with."

        if not self.ready:
            details = (
                "The MedPalm service scaffold is running, but the `medpalm` package or model weights "
                "are not installed on this machine yet."
            )
            return (
                "Nurse Ada is connected to the MedPalm service scaffold, but the real model is not loaded yet. "
                f"{details} Latest message summary: {messages[-1].content}"
            )

        try:
            text_tensor = self._tokenize_text(prompt)
            image_tensor = self._dummy_image()

            if self.device != "cpu":
                image_tensor = image_tensor.to(self.device)
                text_tensor = text_tensor.to(self.device)

            with self._torch.no_grad():
                output = self._model(image_tensor, text_tensor)

            shape = tuple(output.shape) if hasattr(output, "shape") else "unknown"

            return (
                "MedPalm inference ran successfully for the nurse chat scaffold. "
                f"Output tensor shape: {shape}. "
                "You still need task-specific decoding logic to turn model outputs into natural language replies."
            )
        except Exception as exc:  # pragma: no cover - runtime-specific
            logger.exception("MedPalm inference failed")
            raise RuntimeError(f"MedPalm inference failed: {exc}") from exc


runtime = MedPalmRuntime()
whisper_runtime = WhisperRuntime()
fall_audio_runtime = FallAudioRuntime()
cough_audio_runtime = CoughAudioRuntime()

app = FastAPI(title="MedPalm Nurse Chat Service", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
async def health() -> dict[str, Any]:
    return {
        "ok": True,
        "medpalm_ready": runtime.ready,
        "whisper_ready": whisper_runtime.ready,
        "fall_model_ready": fall_audio_runtime.ready,
        "cough_model_ready": cough_audio_runtime.ready,
        "device": runtime.device,
        "import_error": str(runtime._import_error) if runtime._import_error else None,
        "whisper_import_error": (
            str(whisper_runtime._import_error) if whisper_runtime._import_error else None
        ),
    }


def _sse_line(payload: dict[str, Any]) -> str:
    return f"data: {json.dumps(payload)}\n\n"


async def _stream_chat_response(content: str, model: str):
    words = content.split()
    if not words:
        words = [content]

    for index, word in enumerate(words):
        chunk = f"{word} " if index < len(words) - 1 else word
        payload = {
            "id": "chatcmpl-medpalm",
            "object": "chat.completion.chunk",
            "model": model,
            "choices": [
                {
                    "index": 0,
                    "delta": {"content": chunk},
                    "finish_reason": None,
                }
            ],
        }
        yield _sse_line(payload)
        await asyncio.sleep(0.01)

    yield "data: [DONE]\n\n"


@app.post("/v1/chat/completions")
async def chat_completions(request: ChatCompletionRequest):
    if not request.messages:
      raise HTTPException(status_code=400, detail="messages must not be empty")

    try:
        content = runtime.generate_text(request.messages)
    except RuntimeError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    if request.stream:
        return StreamingResponse(
            _stream_chat_response(content, request.model),
            media_type="text/event-stream",
        )

    return JSONResponse(
        {
            "id": "chatcmpl-medpalm",
            "object": "chat.completion",
            "model": request.model,
            "choices": [
                {
                    "index": 0,
                    "message": {"role": "assistant", "content": content},
                    "finish_reason": "stop",
                }
            ],
        }
    )


@app.post("/v1/audio/keyword-detect")
async def keyword_detect(
    file: UploadFile = File(...),
    language: str | None = Form(default=None),
):
    suffix = os.path.splitext(file.filename or "audio.webm")[1] or ".webm"

    try:
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as temp_file:
            temp_file.write(await file.read())
            temp_path = temp_file.name

        result = whisper_runtime.transcribe(temp_path, language=language)
        return JSONResponse(result)
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except Exception as exc:  # pragma: no cover - runtime-specific
        logger.exception("Whisper keyword detection failed")
        raise HTTPException(status_code=500, detail=f"Keyword detection failed: {exc}") from exc
    finally:
        try:
            if "temp_path" in locals():
                os.remove(temp_path)
        except OSError:
            logger.warning("Failed to remove temp audio file", exc_info=True)


@app.post("/v1/audio/fall-detect")
async def fall_detect(file: UploadFile = File(...)):
    try:
        audio_bytes = await file.read()
        result = fall_audio_runtime.predict(audio_bytes)
        return JSONResponse(result)
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except Exception as exc:  # pragma: no cover - runtime-specific
        logger.exception("Fall audio detection failed")
        raise HTTPException(status_code=500, detail=f"Fall detection failed: {exc}") from exc


@app.post("/v1/audio/cough-detect")
async def cough_detect(file: UploadFile = File(...)):
    try:
        audio_bytes = await file.read()
        result = cough_audio_runtime.predict(audio_bytes)
        return JSONResponse(result)
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except Exception as exc:  # pragma: no cover - runtime-specific
        logger.exception("Cough audio detection failed")
        raise HTTPException(status_code=500, detail=f"Cough detection failed: {exc}") from exc


@app.post("/v1/audio/classify-events")
async def classify_events(file: UploadFile = File(...)):
    try:
        audio_bytes = await file.read()
        fall_result = fall_audio_runtime.predict(audio_bytes)
        cough_result = cough_audio_runtime.predict(audio_bytes)
        return JSONResponse({"fall": fall_result, "cough": cough_result})
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except Exception as exc:  # pragma: no cover - runtime-specific
        logger.exception("Combined audio event classification failed")
        raise HTTPException(status_code=500, detail=f"Audio classification failed: {exc}") from exc


@app.post("/v1/risk/analyze", response_model=RiskAnalysisResponse)
async def analyze_risk(request: RiskAnalysisRequest):
    """
    Analyze patient risk level based on multimodal health data.

    Uses the trained multimodal risk classifier to predict if a patient is at
    LOW, MEDIUM, or HIGH risk based on vital signs, activity levels, and alert history.

    Returns:
        - risk_level: Classification result (LOW, MEDIUM, HIGH)
        - confidence: Confidence score for the prediction
        - probabilities: Breakdown of probability for each class
        - explanation: Human-readable summary of risk factors
    """
    try:
        risk_classifier = get_risk_classifier()

        # Convert request to dict, filtering out None values
        patient_data = {k: v for k, v in request.model_dump().items() if v is not None}

        # Get prediction from risk classifier
        result = risk_classifier.predict_risk(patient_data)

        return RiskAnalysisResponse(**result)

    except Exception as exc:  # pragma: no cover - runtime-specific
        logger.exception("Risk analysis failed")
        raise HTTPException(status_code=500, detail=f"Risk analysis failed: {exc}") from exc


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "app.main:app",
        host=os.getenv("MEDPALM_HOST", "0.0.0.0"),
        port=int(os.getenv("MEDPALM_PORT", "8000")),
        reload=os.getenv("MEDPALM_RELOAD", "false").lower() == "true",
    )

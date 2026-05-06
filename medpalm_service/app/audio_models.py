import io
import json
import logging
import wave
from pathlib import Path
from typing import Any

import numpy as np

logger = logging.getLogger("medpalm-service.audio-models")

ROOT_DIR = Path(__file__).resolve().parents[2]
FALL_MODEL_CANDIDATES = [
    ROOT_DIR / "models" / "fall" / "saved_model.keras",
    ROOT_DIR / "models" / "fall" / "cnn_fall_detector.h5",
]
COUGH_MODEL_H5 = ROOT_DIR / "models" / "coug" / "network.h5"
COUGH_MODEL_JSON = ROOT_DIR / "models" / "coug" / "network.json"


def decode_wav_bytes(audio_bytes: bytes) -> tuple[np.ndarray, int]:
    with wave.open(io.BytesIO(audio_bytes), "rb") as wav_file:
        channels = wav_file.getnchannels()
        sample_width = wav_file.getsampwidth()
        sample_rate = wav_file.getframerate()
        frame_count = wav_file.getnframes()
        frames = wav_file.readframes(frame_count)

    if sample_width == 1:
        samples = (np.frombuffer(frames, dtype=np.uint8).astype(np.float32) - 128.0) / 128.0
    elif sample_width == 2:
        samples = np.frombuffer(frames, dtype=np.int16).astype(np.float32) / 32768.0
    elif sample_width == 4:
        samples = np.frombuffer(frames, dtype=np.int32).astype(np.float32) / 2147483648.0
    else:
        raise RuntimeError(f"Unsupported WAV sample width: {sample_width}")

    if channels > 1:
        samples = samples.reshape(-1, channels).mean(axis=1)

    return samples.astype(np.float32), sample_rate


def linear_resample(samples: np.ndarray, from_rate: int, to_rate: int) -> np.ndarray:
    if from_rate == to_rate:
        return samples.astype(np.float32, copy=True)

    duration = len(samples) / float(from_rate)
    target_length = max(1, int(round(duration * to_rate)))
    source_positions = np.arange(len(samples), dtype=np.float32)
    target_positions = np.linspace(0, len(samples) - 1, target_length, dtype=np.float32)
    return np.interp(target_positions, source_positions, samples).astype(np.float32)


def pad_or_trim(samples: np.ndarray, target_length: int) -> np.ndarray:
    if len(samples) > target_length:
        return samples[:target_length].astype(np.float32)

    if len(samples) < target_length:
        padded = np.zeros(target_length, dtype=np.float32)
        padded[: len(samples)] = samples
        return padded

    return samples.astype(np.float32, copy=True)


class TensorFlowRuntime:
    def __init__(self) -> None:
        self._tf: Any | None = None
        self._import_error: Exception | None = None
        self._load_attempted = False

    def _ensure_tf(self) -> Any:
        if self._tf is not None:
            return self._tf

        if not self._load_attempted:
            self._load_attempted = True
            try:
                import tensorflow as tf  # type: ignore

                self._tf = tf
            except Exception as exc:  # pragma: no cover - depends on local install
                self._import_error = exc
                logger.warning("TensorFlow unavailable: %s", exc)

        if self._tf is None:
            raise RuntimeError(
                "TensorFlow is not available. Install tensorflow to use the deployed fall and cough models."
            )

        return self._tf


class FallAudioRuntime(TensorFlowRuntime):
    labels = ("fall", "nofall")
    sample_rate = 22050
    duration_seconds = 3
    n_fft = 2048
    hop_length = 512
    n_mels = 64
    target_frames = 130
    threshold = 0.6

    def __init__(self) -> None:
        super().__init__()
        self._model: Any | None = None
        self._model_path: Path | None = None

    def _load_model(self) -> None:
        if self._model is not None:
            return

        tf = self._ensure_tf()
        for candidate in FALL_MODEL_CANDIDATES:
            if candidate.exists():
                self._model = tf.keras.models.load_model(candidate)
                self._model_path = candidate
                logger.info("Loaded deployed fall model from %s", candidate)
                return

        raise RuntimeError("No fall model artifact found in models/fall.")

    @property
    def ready(self) -> bool:
        try:
            self._load_model()
            return self._model is not None
        except Exception:
            return False

    @property
    def model_path(self) -> str | None:
        return str(self._model_path) if self._model_path else None

    def _build_input_tensor(self, audio_bytes: bytes) -> np.ndarray:
        tf = self._ensure_tf()
        samples, source_rate = decode_wav_bytes(audio_bytes)
        samples = linear_resample(samples, source_rate, self.sample_rate)
        samples = pad_or_trim(samples, self.sample_rate * self.duration_seconds)
        samples = np.pad(samples, (self.n_fft // 2, self.n_fft // 2), mode="constant")

        audio_tensor = tf.convert_to_tensor(samples[np.newaxis, :], dtype=tf.float32)
        stft = tf.signal.stft(
            audio_tensor,
            frame_length=self.n_fft,
            frame_step=self.hop_length,
            fft_length=self.n_fft,
            window_fn=tf.signal.hann_window,
        )
        power = tf.math.square(tf.abs(stft))
        mel_matrix = tf.signal.linear_to_mel_weight_matrix(
            num_mel_bins=self.n_mels,
            num_spectrogram_bins=self.n_fft // 2 + 1,
            sample_rate=self.sample_rate,
            lower_edge_hertz=0.0,
            upper_edge_hertz=float(self.sample_rate // 2),
        )
        mel = tf.tensordot(power, mel_matrix, axes=1)
        mel = tf.transpose(mel, perm=[0, 2, 1])
        log_mel = 10.0 * (
            tf.math.log(tf.maximum(mel, 1e-8)) / tf.math.log(tf.constant(10.0, dtype=tf.float32))
        )

        log_mel_np = log_mel.numpy()[0]
        frame_count = log_mel_np.shape[1]
        if frame_count >= self.target_frames:
            log_mel_np = log_mel_np[:, : self.target_frames]
        else:
            padded = np.zeros((self.n_mels, self.target_frames), dtype=np.float32)
            padded[:, :frame_count] = log_mel_np
            log_mel_np = padded

        mean = float(log_mel_np.mean())
        std = float(log_mel_np.std()) or 1.0
        normalized = (log_mel_np - mean) / std
        return normalized[np.newaxis, :, :, np.newaxis].astype(np.float32)

    def predict(self, audio_bytes: bytes) -> dict[str, Any]:
        self._load_model()
        assert self._model is not None

        model_input = self._build_input_tensor(audio_bytes)
        raw_output = np.asarray(self._model.predict(model_input, verbose=0)).squeeze()
        if raw_output.ndim == 0 or raw_output.size == 1:
            fall_probability = float(raw_output.reshape(-1)[0])
            if not 0.0 <= fall_probability <= 1.0:
                fall_probability = 1.0 / (1.0 + np.exp(-fall_probability))
            nofall_probability = 1.0 - fall_probability
        else:
            logits = raw_output.astype(np.float32).reshape(-1)
            logits = logits - np.max(logits)
            probs = np.exp(logits) / np.sum(np.exp(logits))
            fall_probability = float(probs[0])
            nofall_probability = float(probs[1] if probs.size > 1 else 1.0 - probs[0])

        detected = fall_probability >= self.threshold
        return {
            "model": "fall_audio_model",
            "source_model_path": self.model_path,
            "label": "FALL" if detected else "NOFALL",
            "detected": detected,
            "confidence": fall_probability if detected else nofall_probability,
            "probabilities": {
                self.labels[0]: fall_probability,
                self.labels[1]: nofall_probability,
            },
            "threshold": self.threshold,
        }


class CoughAudioRuntime(TensorFlowRuntime):
    labels = ("cough", "no_cough")
    sample_rate = 22050
    duration_seconds = 4
    n_fft = 1024
    hop_length = 256
    n_mels = 128
    threshold = 0.6

    def __init__(self) -> None:
        super().__init__()
        self._model: Any | None = None
        self._model_path: str | None = None

    def _load_model(self) -> None:
        if self._model is not None:
            return

        tf = self._ensure_tf()
        if COUGH_MODEL_H5.exists():
            try:
                self._model = tf.keras.models.load_model(COUGH_MODEL_H5)
                self._model_path = str(COUGH_MODEL_H5)
                logger.info("Loaded deployed cough model from %s", COUGH_MODEL_H5)
                return
            except Exception as load_error:
                logger.warning("Direct cough model load failed, trying JSON+weights fallback: %s", load_error)

        if COUGH_MODEL_JSON.exists() and COUGH_MODEL_H5.exists():
            architecture = json.loads(COUGH_MODEL_JSON.read_text(encoding="utf-8"))
            self._model = tf.keras.models.model_from_json(json.dumps(architecture))
            self._model.load_weights(COUGH_MODEL_H5)
            self._model_path = f"{COUGH_MODEL_JSON} + weights:{COUGH_MODEL_H5}"
            logger.info("Loaded deployed cough model from JSON architecture and H5 weights")
            return

        raise RuntimeError("No cough model artifact found in models/coug.")

    @property
    def ready(self) -> bool:
        try:
            self._load_model()
            return self._model is not None
        except Exception:
            return False

    @property
    def model_path(self) -> str | None:
        return self._model_path

    def _build_input_tensor(self, audio_bytes: bytes) -> np.ndarray:
        tf = self._ensure_tf()
        samples, source_rate = decode_wav_bytes(audio_bytes)
        samples = linear_resample(samples, source_rate, self.sample_rate)
        samples = pad_or_trim(samples, self.sample_rate * self.duration_seconds)

        audio_tensor = tf.convert_to_tensor(samples[np.newaxis, :], dtype=tf.float32)
        stft = tf.signal.stft(
            audio_tensor,
            frame_length=self.n_fft,
            frame_step=self.hop_length,
            fft_length=self.n_fft,
            window_fn=tf.signal.hann_window,
        )
        power = tf.math.square(tf.abs(stft))
        mel_matrix = tf.signal.linear_to_mel_weight_matrix(
            num_mel_bins=self.n_mels,
            num_spectrogram_bins=self.n_fft // 2 + 1,
            sample_rate=self.sample_rate,
            lower_edge_hertz=0.0,
            upper_edge_hertz=float(self.sample_rate // 2),
        )
        mel = tf.tensordot(power, mel_matrix, axes=1)
        mel = tf.transpose(mel, perm=[0, 2, 1])
        log_mel = tf.math.log(tf.maximum(mel, 1e-6))
        log_mel = log_mel[..., tf.newaxis]

        min_val = tf.reduce_min(log_mel)
        max_val = tf.reduce_max(log_mel)
        normalized = (log_mel - min_val) / tf.maximum(max_val - min_val, 1e-6)
        resized = tf.image.resize(normalized, [224, 224])
        rgb = tf.repeat(resized, repeats=3, axis=-1)
        return rgb.numpy().astype(np.float32)

    def predict(self, audio_bytes: bytes) -> dict[str, Any]:
        self._load_model()
        assert self._model is not None

        model_input = self._build_input_tensor(audio_bytes)
        raw_output = np.asarray(self._model.predict(model_input, verbose=0)).squeeze()
        if raw_output.ndim == 0 or raw_output.size == 1:
            cough_probability = float(raw_output.reshape(-1)[0])
            if not 0.0 <= cough_probability <= 1.0:
                cough_probability = 1.0 / (1.0 + np.exp(-cough_probability))
            no_cough_probability = 1.0 - cough_probability
        else:
            logits = raw_output.astype(np.float32).reshape(-1)
            logits = logits - np.max(logits)
            probs = np.exp(logits) / np.sum(np.exp(logits))
            cough_probability = float(probs[0])
            no_cough_probability = float(probs[1] if probs.size > 1 else 1.0 - probs[0])

        detected = cough_probability >= self.threshold
        return {
            "model": "cough_audio_model",
            "source_model_path": self.model_path,
            "label": "COUGH" if detected else "NO_COUGH",
            "detected": detected,
            "confidence": cough_probability if detected else no_cough_probability,
            "probabilities": {
                self.labels[0]: cough_probability,
                self.labels[1]: no_cough_probability,
            },
            "threshold": self.threshold,
        }

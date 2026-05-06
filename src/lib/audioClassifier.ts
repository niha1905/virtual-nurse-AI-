import { predictFallFromAudio } from "@/lib/fallAudioModel";

// Lightweight heuristic audio event classifier.
// Records a short PCM clip via MediaRecorder + AudioContext, then computes:
//   - RMS energy (loudness)
//   - Peak amplitude
//   - Zero-crossing rate (ZCR ~ noisiness/voicedness)
//   - Spectral centroid (brightness)
//   - Short-burst ratio (energy concentration in time)
// and maps these features to: FALL | COUGH | SPEECH | SILENCE.

export type AudioEventClass = "FALL" | "COUGH" | "SPEECH" | "SILENCE";

export interface AudioFeatures {
  durationMs: number;
  rms: number;
  peak: number;
  zcr: number;
  spectralCentroid: number;
  burstRatio: number; // fraction of frames whose RMS > 2x mean RMS
  burstCount: number;
}

export interface ClassificationResult {
  label: AudioEventClass;
  confidence: number; // 0..1
  features: AudioFeatures;
  explanation: string;
  source?: "heuristic" | "fall_cnn_model" | "backend_fall_model" | "backend_cough_model";
}

const FRAME_SIZE = 1024;

type BackendModelPrediction = {
  label: string;
  detected: boolean;
  confidence: number;
  probabilities: Record<string, number>;
  threshold: number;
};

type BackendAudioEventResponse = {
  fall?: BackendModelPrediction;
  cough?: BackendModelPrediction;
};

function computeFrameRMS(samples: Float32Array): number[] {
  const out: number[] = [];
  for (let i = 0; i + FRAME_SIZE <= samples.length; i += FRAME_SIZE) {
    let s = 0;
    for (let j = 0; j < FRAME_SIZE; j++) {
      const v = samples[i + j];
      s += v * v;
    }
    out.push(Math.sqrt(s / FRAME_SIZE));
  }
  return out;
}

function computeZCR(samples: Float32Array): number {
  let crossings = 0;
  for (let i = 1; i < samples.length; i++) {
    if ((samples[i - 1] >= 0 && samples[i] < 0) || (samples[i - 1] < 0 && samples[i] >= 0)) {
      crossings++;
    }
  }
  return crossings / samples.length;
}

// Naive spectral centroid via DFT magnitude on a Hann-windowed slice.
function computeSpectralCentroid(samples: Float32Array, sampleRate: number): number {
  const N = Math.min(2048, samples.length);
  if (N < 64) return 0;
  const start = Math.floor((samples.length - N) / 2);
  const win = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1));
    win[i] = samples[start + i] * w;
  }
  // Compute magnitude spectrum (real DFT, O(N^2) — fine for N=2048 occasional call)
  let weighted = 0;
  let total = 0;
  const halfN = N / 2;
  for (let k = 1; k < halfN; k++) {
    let re = 0;
    let im = 0;
    const c = (2 * Math.PI * k) / N;
    for (let n = 0; n < N; n++) {
      re += win[n] * Math.cos(c * n);
      im -= win[n] * Math.sin(c * n);
    }
    const mag = Math.sqrt(re * re + im * im);
    const freq = (k * sampleRate) / N;
    weighted += freq * mag;
    total += mag;
  }
  return total > 0 ? weighted / total : 0;
}

export function extractFeatures(samples: Float32Array, sampleRate: number): AudioFeatures {
  const frames = computeFrameRMS(samples);
  const meanRms = frames.length ? frames.reduce((a, b) => a + b, 0) / frames.length : 0;
  const burstThreshold = meanRms * 2;
  let burstCount = 0;
  for (const f of frames) if (f > burstThreshold && f > 0.05) burstCount++;
  const burstRatio = frames.length ? burstCount / frames.length : 0;

  let peak = 0;
  for (let i = 0; i < samples.length; i++) {
    const v = Math.abs(samples[i]);
    if (v > peak) peak = v;
  }

  const rms = meanRms;
  const zcr = computeZCR(samples);
  const spectralCentroid = computeSpectralCentroid(samples, sampleRate);

  return {
    durationMs: (samples.length / sampleRate) * 1000,
    rms,
    peak,
    zcr,
    spectralCentroid,
    burstRatio,
    burstCount,
  };
}

export function classify(features: AudioFeatures): ClassificationResult {
  const { rms, peak, zcr, spectralCentroid, burstCount, burstRatio } = features;

  // Silence: very low RMS and peak.
  if (rms < 0.01 && peak < 0.05) {
    return {
      label: "SILENCE",
      confidence: 0.9,
      features,
      explanation: "Audio is essentially silent (very low energy).",
    };
  }

  // FALL: a sudden, loud, broadband impact — high peak, low/medium ZCR,
  // brief energy concentration (1-2 bursts), low spectral centroid (thuddy).
  const fallScore =
    (peak > 0.55 ? 1 : 0) +
    (rms > 0.08 ? 0.6 : 0) +
    (burstCount >= 1 && burstCount <= 3 ? 0.8 : 0) +
    (burstRatio < 0.25 ? 0.5 : 0) +
    (spectralCentroid > 0 && spectralCentroid < 1500 ? 0.7 : 0) +
    (zcr < 0.12 ? 0.4 : 0);

  // COUGH: short, sharp, high-energy bursts with high spectral centroid
  // and elevated ZCR (turbulent/noisy).
  const coughScore =
    (peak > 0.4 ? 0.8 : 0) +
    (rms > 0.06 ? 0.5 : 0) +
    (zcr > 0.12 ? 1 : 0) +
    (spectralCentroid > 1500 ? 0.9 : 0) +
    (burstCount >= 1 && burstCount <= 5 ? 0.7 : 0) +
    (burstRatio < 0.4 ? 0.4 : 0);

  // SPEECH: sustained moderate energy, medium ZCR, medium centroid,
  // many small bursts (syllables) over time.
  const speechScore =
    (rms > 0.02 && rms < 0.2 ? 0.8 : 0) +
    (zcr > 0.04 && zcr < 0.18 ? 0.8 : 0) +
    (spectralCentroid > 800 && spectralCentroid < 3500 ? 0.6 : 0) +
    (burstRatio > 0.2 ? 0.7 : 0) +
    (peak < 0.7 ? 0.3 : 0);

  const scores: Record<AudioEventClass, number> = {
    FALL: fallScore,
    COUGH: coughScore,
    SPEECH: speechScore,
    SILENCE: 0,
  };

  let best: AudioEventClass = "SPEECH";
  let bestScore = -Infinity;
  (Object.keys(scores) as AudioEventClass[]).forEach((k) => {
    if (scores[k] > bestScore) {
      bestScore = scores[k];
      best = k;
    }
  });

  // Normalize to a soft confidence vs runner-up
  const sorted = Object.values(scores).sort((a, b) => b - a);
  const margin = Math.max(0, sorted[0] - sorted[1]);
  const confidence = Math.min(0.99, 0.4 + margin * 0.25);

  const explanations: Record<AudioEventClass, string> = {
    FALL: `Loud impact-like sound (peak ${peak.toFixed(2)}, low brightness ${Math.round(spectralCentroid)} Hz) with concentrated energy.`,
    COUGH: `Sharp high-frequency burst (ZCR ${zcr.toFixed(2)}, brightness ${Math.round(spectralCentroid)} Hz) consistent with a cough.`,
    SPEECH: `Sustained voiced energy with moderate ZCR (${zcr.toFixed(2)}) — sounds like speech.`,
    SILENCE: "No significant audio detected.",
  };

  return { label: best, confidence, features, explanation: explanations[best], source: "heuristic" };
}

export async function classifyAudioEvent(
  samples: Float32Array,
  sampleRate: number,
  backendServiceUrl?: string,
): Promise<ClassificationResult> {
  const features = extractFeatures(samples, sampleRate);
  const heuristic = classify(features);

  if (backendServiceUrl) {
    try {
      const backend = await classifyWithBackend(samples, sampleRate, backendServiceUrl);
      const fallProbability = backend.fall?.probabilities?.fall ?? 0;
      const coughProbability = backend.cough?.probabilities?.cough ?? 0;

      if (fallProbability >= Math.max(backend.fall?.threshold ?? 0.6, 0.6)) {
        return {
          label: "FALL",
          confidence: fallProbability,
          features,
          explanation: `Deployed fall model detected a fall-like impact pattern (${Math.round(
            fallProbability * 100,
          )}% fall probability).`,
          source: "backend_fall_model",
        };
      }

      if (coughProbability >= Math.max(backend.cough?.threshold ?? 0.6, 0.6)) {
        return {
          label: "COUGH",
          confidence: coughProbability,
          features,
          explanation: `Deployed cough model detected a cough pattern (${Math.round(
            coughProbability * 100,
          )}% cough probability).`,
          source: "backend_cough_model",
        };
      }
    } catch (error) {
      console.error("Backend audio model inference failed; falling back to local classifier.", error);
    }
  }

  const shouldRunFallModel =
    heuristic.label === "FALL" ||
    features.peak > 0.3 ||
    (features.rms > 0.04 && features.burstCount >= 1);

  if (!shouldRunFallModel) return heuristic;

  try {
    const prediction = await predictFallFromAudio(samples, sampleRate);
    const fallConfidence = prediction.fallProbability;

    if (fallConfidence >= 0.6) {
      return {
        label: "FALL",
        confidence: Math.max(
          fallConfidence,
          heuristic.label === "FALL" ? heuristic.confidence : 0,
        ),
        features,
        explanation: `Fall CNN model detected an impact-like spectrogram pattern (${Math.round(
          fallConfidence * 100,
        )}% fall probability).`,
        source: "fall_cnn_model",
      };
    }

    if (heuristic.label === "FALL" && fallConfidence < 0.35) {
      return {
        ...heuristic,
        confidence: Math.min(heuristic.confidence, 0.55),
        explanation: `${heuristic.explanation} Fall CNN cross-check was low (${Math.round(
          fallConfidence * 100,
        )}% fall probability).`,
      };
    }
  } catch (error) {
    console.error("Fall model inference failed; falling back to heuristic classifier.", error);
  }

  return heuristic;
}

async function classifyWithBackend(
  samples: Float32Array,
  sampleRate: number,
  backendServiceUrl: string,
): Promise<BackendAudioEventResponse> {
  const wavBlob = encodeWav(samples, sampleRate);
  const formData = new FormData();
  formData.append("file", wavBlob, "audio-event.wav");

  const response = await fetch(`${backendServiceUrl}/v1/audio/classify-events`, {
    method: "POST",
    body: formData,
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || "Backend audio model request failed");
  }

  return (await response.json()) as BackendAudioEventResponse;
}

export interface RecordingResult {
  blob: Blob;
  samples: Float32Array;
  sampleRate: number;
}

type AudioContextCtor = typeof AudioContext & {
  new (): AudioContext;
};

const floatTo16BitPcm = (samples: Float32Array) => {
  const output = new Int16Array(samples.length);
  for (let index = 0; index < samples.length; index++) {
    const clamped = Math.max(-1, Math.min(1, samples[index]));
    output[index] = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
  }
  return output;
};

export const encodeWav = (samples: Float32Array, sampleRate: number) => {
  const pcm = floatTo16BitPcm(samples);
  const buffer = new ArrayBuffer(44 + pcm.byteLength);
  const view = new DataView(buffer);

  const writeString = (offset: number, value: string) => {
    for (let index = 0; index < value.length; index++) {
      view.setUint8(offset + index, value.charCodeAt(index));
    }
  };

  writeString(0, "RIFF");
  view.setUint32(4, 36 + pcm.byteLength, true);
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeString(36, "data");
  view.setUint32(40, pcm.byteLength, true);

  let offset = 44;
  for (let index = 0; index < pcm.length; index++, offset += 2) {
    view.setInt16(offset, pcm[index], true);
  }

  return new Blob([buffer], { type: "audio/wav" });
};

export async function decodeAudioBlob(
  blob: Blob,
): Promise<{ samples: Float32Array; sampleRate: number }> {
  const arrayBuffer = await blob.arrayBuffer();
  const browserWindow = window as Window &
    typeof globalThis & {
      webkitAudioContext?: AudioContextCtor;
    };
  const AudioContextClass = browserWindow.AudioContext ?? browserWindow.webkitAudioContext;
  if (!AudioContextClass) {
    throw new Error("Audio decoding is not supported in this browser.");
  }
  const ctx = new AudioContextClass();
  const decoded = await ctx.decodeAudioData(arrayBuffer.slice(0));
  const ch0 = decoded.getChannelData(0);
  let mono: Float32Array;

  if (decoded.numberOfChannels > 1) {
    const ch1 = decoded.getChannelData(1);
    mono = new Float32Array(ch0.length);
    for (let i = 0; i < ch0.length; i++) mono[i] = (ch0[i] + ch1[i]) * 0.5;
  } else {
    mono = new Float32Array(ch0);
  }

  await ctx.close();
  return { samples: mono, sampleRate: decoded.sampleRate };
}

export async function recordClip(
  durationMs = 4000,
  audioConstraints: MediaTrackConstraints = {},
): Promise<RecordingResult> {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error("Microphone access is not supported in this browser.");
  }
  const stream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints });
  const recorder = new MediaRecorder(stream);
  const chunks: BlobPart[] = [];
  recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);

  const stopped = new Promise<void>((resolve) => {
    recorder.onstop = () => resolve();
  });

  recorder.start();
  await new Promise((r) => setTimeout(r, durationMs));
  recorder.stop();
  await stopped;

  stream.getTracks().forEach((t) => t.stop());

  const blob = new Blob(chunks, { type: chunks[0] ? (chunks[0] as Blob).type : "audio/webm" });
  const { samples: mono, sampleRate } = await decodeAudioBlob(blob);

  return { blob, samples: mono, sampleRate };
}

import { useCallback, useEffect, useRef, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Activity, Loader2, Mic, Square, Upload, Waves } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import { useAuth } from "@/contexts/AuthContext";
import { findHelpKeywordMatch } from "@/lib/helpKeywords";
import {
  classifyAudioEvent,
  decodeAudioBlob,
  encodeWav,
  recordClip,
  type ClassificationResult,
} from "@/lib/audioClassifier";

const CLIP_MS = 4000;
const HELP_ALERT_COOLDOWN_MS = 30 * 1000;
const AUDIO_MODEL_SERVICE_URL = import.meta.env.VITE_MEDPALM_SERVICE_URL ?? "http://127.0.0.1:8000";
const WHISPER_SERVICE_URL = AUDIO_MODEL_SERVICE_URL;
const WHISPER_AUDIO_CONSTRAINTS: MediaTrackConstraints = {
  channelCount: 1,
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
};

type AudioContextCtor = typeof AudioContext & {
  new (): AudioContext;
};

const getErrorMessage = (error: unknown, fallback: string) =>
  error instanceof Error ? error.message : fallback;

const getAudioContextClass = (): AudioContextCtor => {
  const browserWindow = window as Window &
    typeof globalThis & {
      webkitAudioContext?: AudioContextCtor;
    };
  const AudioContextClass = browserWindow.AudioContext ?? browserWindow.webkitAudioContext;
  if (!AudioContextClass) {
    throw new Error("Web Audio is not supported in this browser.");
  }
  return AudioContextClass;
};

export const AudioEventDetector = () => {
  const { session } = useAuth();
  const [recording, setRecording] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<ClassificationResult | null>(null);
  const [waveform, setWaveform] = useState<number[]>([]);
  const [streamLevel, setStreamLevel] = useState<number[]>(Array(40).fill(0));
  const [continuous, setContinuous] = useState(false);
  const [speechRecognitionActive, setSpeechRecognitionActive] = useState(false);
  const continuousRef = useRef(false);
  const liveStreamRef = useRef<MediaStream | null>(null);
  const liveCtxRef = useRef<AudioContext | null>(null);
  const liveRafRef = useRef<number | null>(null);
  const speechRecognitionRef = useRef(false);
  const whisperStreamRef = useRef<MediaStream | null>(null);
  const whisperRecorderRef = useRef<MediaRecorder | null>(null);
  const whisperProcessingRef = useRef(false);
  const lastHelpAlertAtRef = useRef(0);

  const drawWaveform = (samples: Float32Array) => {
    const buckets = 60;
    const step = Math.max(1, Math.floor(samples.length / buckets));
    const out: number[] = [];

    for (let bucket = 0; bucket < buckets; bucket++) {
      let max = 0;
      for (let index = 0; index < step; index++) {
        const value = Math.abs(samples[bucket * step + index] || 0);
        if (value > max) max = value;
      }
      out.push(max);
    }

    setWaveform(out);
  };

  const persistAlert = async (
    label: "FALL" | "COUGH",
    message: string,
    metadata: Record<string, unknown>,
  ) => {
    if (!session) return;

    const autoEscalateAt = new Date(Date.now() + 40_000).toISOString();
    const { error } = await supabase.from("alerts").insert({
      patient_id: session.user.id,
      type: label,
      message,
      metadata: metadata as Json,
      auto_escalate_at: autoEscalateAt,
    });

    if (error) {
      console.error("alert insert error", error);
      return;
    }

    toast.success(`${label} detected - alarm armed for 40s.`);
  };

  const simulateDetection = async (type: "FALL" | "COUGH" | "HELP") => {
    if (type === "HELP") {
      await triggerHelpAlert("help me this is an emergency", "help me", "english");
      return;
    }

    const mockResult: ClassificationResult =
      type === "FALL"
        ? {
            label: "FALL",
            confidence: 0.92,
            explanation:
              "Simulated fall event with impact-like burst and strong confirmation for emergency testing.",
            source: "heuristic",
            features: {
              durationMs: CLIP_MS,
              rms: 0.18,
              peak: 0.91,
              zcr: 0.08,
              spectralCentroid: 920,
              burstRatio: 0.12,
              burstCount: 2,
            },
          }
        : {
            label: "COUGH",
            confidence: 0.9,
            explanation:
              "Simulated continuous coughing over the full 4-second window for emergency testing.",
            source: "heuristic",
            features: {
              durationMs: CLIP_MS,
              rms: 0.11,
              peak: 0.72,
              zcr: 0.17,
              spectralCentroid: 2350,
              burstRatio: 0.28,
              burstCount: 4,
            },
          };

    setResult(mockResult);
    setWaveform(
      Array.from({ length: 60 }, (_, index) =>
        type === "FALL"
          ? index === 18 || index === 19 || index === 20
            ? 0.95
            : 0.08
          : index % 8 < 4
            ? 0.72
            : 0.18,
      ),
    );

    await persistAlert(
      type,
      type === "FALL"
        ? `Simulated fall detected (${Math.round(mockResult.confidence * 100)}% confidence). ${mockResult.explanation}`
        : `Simulated continuous coughing detected over ${CLIP_MS / 1000} seconds (${Math.round(
            mockResult.confidence * 100,
          )}% confidence). ${mockResult.explanation}`,
      {
        source: "simulation",
        confidence: mockResult.confidence,
        simulated: true,
        features: mockResult.features,
      },
    );
  };

  const runOnce = async () => {
    setRecording(true);
    setResult(null);
    setProgress(0);

    const startedAt = Date.now();
    const tick = window.setInterval(() => {
      const nextProgress = Math.min(100, ((Date.now() - startedAt) / CLIP_MS) * 100);
      setProgress(nextProgress);
    }, 80);

    try {
      const { samples, sampleRate } = await recordClip(CLIP_MS);
      window.clearInterval(tick);
      setProgress(100);
      setRecording(false);
      setAnalyzing(true);

      drawWaveform(samples);
      await new Promise((resolve) => setTimeout(resolve, 30));

      const classification = await classifyAudioEvent(samples, sampleRate, AUDIO_MODEL_SERVICE_URL);
      setResult(classification);

      if (classification.label === "FALL" && classification.confidence >= 0.55) {
        await persistAlert(
          classification.label,
          `${classification.label} detected from audio (${Math.round(
            classification.confidence * 100,
          )}% confidence). ${classification.explanation}`,
          {
            source: "audio_event_detector",
            confidence: classification.confidence,
            classifier_source: classification.source || "heuristic",
            features: {
              rms: Number(classification.features.rms.toFixed(4)),
              peak: Number(classification.features.peak.toFixed(4)),
              zcr: Number(classification.features.zcr.toFixed(4)),
              spectralCentroid: Math.round(classification.features.spectralCentroid),
              burstCount: classification.features.burstCount,
              burstRatio: Number(classification.features.burstRatio.toFixed(3)),
              durationMs: Math.round(classification.features.durationMs),
            },
          },
        );
      } else if (classification.label === "COUGH" && classification.confidence >= 0.55) {
        await persistAlert(
          classification.label,
          `Continuous coughing detected in a ${Math.round(
            classification.features.durationMs / 1000,
          )}-second clip (${Math.round(classification.confidence * 100)}% confidence). ${
            classification.explanation
          }`,
          {
            source: "audio_event_detector",
            confidence: classification.confidence,
            classifier_source: classification.source || "heuristic",
            continuous_cough_window_ms: CLIP_MS,
            features: {
              rms: Number(classification.features.rms.toFixed(4)),
              peak: Number(classification.features.peak.toFixed(4)),
              zcr: Number(classification.features.zcr.toFixed(4)),
              spectralCentroid: Math.round(classification.features.spectralCentroid),
              burstCount: classification.features.burstCount,
              burstRatio: Number(classification.features.burstRatio.toFixed(3)),
              durationMs: Math.round(classification.features.durationMs),
            },
          },
        );
      }
    } catch (error: unknown) {
      console.error(error);
      toast.error(getErrorMessage(error, "Recording failed"));
    } finally {
      window.clearInterval(tick);
      setAnalyzing(false);
      setRecording(false);
      setProgress(0);
    }
  };

  const startContinuous = async () => {
    setContinuous(true);
    continuousRef.current = true;
    await startLiveMeter();

    while (continuousRef.current) {
      await runOnce();
      if (!continuousRef.current) break;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    stopLiveMeter();
  };

  const stopContinuous = () => {
    continuousRef.current = false;
    setContinuous(false);
    stopLiveMeter();
  };

  const startLiveMeter = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      liveStreamRef.current = stream;

      const AudioContextClass = getAudioContextClass();
      const context = new AudioContextClass();
      liveCtxRef.current = context;

      const source = context.createMediaStreamSource(stream);
      const analyser = context.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);

      const data = new Uint8Array(analyser.frequencyBinCount);
      const tick = () => {
        analyser.getByteTimeDomainData(data);
        let sum = 0;
        for (let index = 0; index < data.length; index++) {
          const value = (data[index] - 128) / 128;
          sum += value * value;
        }

        const rms = Math.sqrt(sum / data.length);
        setStreamLevel((previous) => [...previous.slice(1), Math.min(1, rms * 3)]);
        liveRafRef.current = requestAnimationFrame(tick);
      };

      tick();
    } catch (error) {
      console.error("live meter error", error);
    }
  };

  const stopLiveMeter = () => {
    if (liveRafRef.current) cancelAnimationFrame(liveRafRef.current);
    liveRafRef.current = null;
    liveStreamRef.current?.getTracks().forEach((track) => track.stop());
    liveStreamRef.current = null;
    liveCtxRef.current?.close();
    liveCtxRef.current = null;
    setStreamLevel(Array(40).fill(0));
  };

  const stopWhisperRecorder = () => {
    const recorder = whisperRecorderRef.current;
    whisperRecorderRef.current = null;

    if (recorder && recorder.state !== "inactive") {
      recorder.stop();
    }

    whisperStreamRef.current?.getTracks().forEach((track) => track.stop());
    whisperStreamRef.current = null;
    whisperProcessingRef.current = false;
  };

  const triggerHelpAlert = async (
    transcript: string,
    matchedKeyword: string,
    language: string,
  ) => {
    if (!session?.user?.id) return;
    if (Date.now() - lastHelpAlertAtRef.current < HELP_ALERT_COOLDOWN_MS) return;

    try {
      const autoEscalateAt = new Date(Date.now() + 40_000).toISOString();
      const { error } = await supabase.from("alerts").insert({
        patient_id: session.user.id,
        type: "HELP",
        message: `Voice keyword detected: "${transcript}". Patient may need assistance immediately.`,
        metadata: {
          source: "whisper_keyword_detection",
          transcript,
          matched_keyword: matchedKeyword,
          detected_language: language,
        },
        auto_escalate_at: autoEscalateAt,
      });

      if (error) throw error;
      lastHelpAlertAtRef.current = Date.now();
      toast.error(`HELP alert triggered from ${language} keyword "${matchedKeyword}".`);
    } catch (error: unknown) {
      console.error("Failed to trigger help alert:", error);
      toast.error("Failed to send help alert");
    }
  };

  const transcribeKeywordClip = async (audioBlob: Blob) => {
    const formData = new FormData();
    formData.append("file", audioBlob, "keyword-detect.wav");

    const response = await fetch(`${WHISPER_SERVICE_URL}/v1/audio/keyword-detect`, {
      method: "POST",
      body: formData,
    });

    if (!response.ok) {
      const message = await response.text();
      throw new Error(message || "Whisper keyword detection failed");
    }

    const payload = (await response.json()) as { transcript?: string; language?: string };
    return {
      transcript: String(payload.transcript || "").trim(),
      language: String(payload.language || "unknown"),
    };
  };

  const startSpeechRecognition = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: WHISPER_AUDIO_CONSTRAINTS,
      });
      const recorder = new MediaRecorder(stream);

      speechRecognitionRef.current = true;
      whisperStreamRef.current = stream;
      whisperRecorderRef.current = recorder;
      setSpeechRecognitionActive(true);

      recorder.ondataavailable = async (event: BlobEvent) => {
        if (!speechRecognitionRef.current || !event.data || event.data.size === 0) return;
        if (whisperProcessingRef.current) return;

        whisperProcessingRef.current = true;

        try {
          const { samples, sampleRate } = await decodeAudioBlob(event.data);
          const wavBlob = encodeWav(samples, sampleRate);
          const { transcript, language } = await transcribeKeywordClip(wavBlob);
          if (!transcript) return;

          const match = findHelpKeywordMatch(transcript);
          if (match) {
            await triggerHelpAlert(transcript, match.keyword, match.language);
          }
        } catch (error: unknown) {
          console.error("Whisper keyword detection error:", error);
          toast.error(getErrorMessage(error, "Whisper keyword detection failed"));
          speechRecognitionRef.current = false;
          setSpeechRecognitionActive(false);
          stopWhisperRecorder();
        } finally {
          whisperProcessingRef.current = false;
        }
      };

      recorder.onerror = (event: Event) => {
        console.error("Whisper recorder error:", event);
        toast.error("Whisper recorder failed");
        speechRecognitionRef.current = false;
        setSpeechRecognitionActive(false);
        stopWhisperRecorder();
      };

      recorder.start(CLIP_MS);
      toast.success("Whisper voice keyword detection started");
    } catch (error: unknown) {
      console.error("Failed to start Whisper keyword detection:", error);
      toast.error(getErrorMessage(error, "Could not start Whisper voice keyword detection"));
      speechRecognitionRef.current = false;
      setSpeechRecognitionActive(false);
      stopWhisperRecorder();
    }
  };

  const stopSpeechRecognition = useCallback((showToast = true) => {
    speechRecognitionRef.current = false;
    setSpeechRecognitionActive(false);
    stopWhisperRecorder();
    if (showToast) {
      toast.success("Whisper voice keyword detection stopped");
    }
  }, []);

  useEffect(() => {
    return () => {
      stopSpeechRecognition(false);
      stopLiveMeter();
    };
  }, [stopSpeechRecognition]);

  const onUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setAnalyzing(true);
    setResult(null);

    try {
      const buffer = await file.arrayBuffer();
      const AudioContextClass = getAudioContextClass();
      const context = new AudioContextClass();
      const decoded = await context.decodeAudioData(buffer.slice(0));
      const channel = decoded.getChannelData(0);
      const mono = new Float32Array(channel);
      await context.close();

      drawWaveform(mono);
      const classification = await classifyAudioEvent(
        mono,
        decoded.sampleRate,
        AUDIO_MODEL_SERVICE_URL,
      );
      setResult(classification);

      if (classification.label === "FALL" && classification.confidence >= 0.55) {
        await persistAlert(
          classification.label,
          `${classification.label} detected from uploaded audio (${Math.round(
            classification.confidence * 100,
          )}% confidence). ${classification.explanation}`,
          {
            source: "audio_upload",
            confidence: classification.confidence,
            classifier_source: classification.source || "heuristic",
            filename: file.name,
          },
        );
      } else if (classification.label === "COUGH" && classification.confidence >= 0.55) {
        await persistAlert(
          classification.label,
          `Continuous coughing detected in uploaded audio over ${Math.round(
            classification.features.durationMs / 1000,
          )} seconds. ${classification.explanation}`,
          {
            source: "audio_upload",
            confidence: classification.confidence,
            filename: file.name,
            continuous_cough_window_ms: CLIP_MS,
          },
        );
      }
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, "Could not process audio"));
    } finally {
      setAnalyzing(false);
      event.target.value = "";
    }
  };

  const labelColor = (label?: string) =>
    label === "FALL" || label === "COUGH"
      ? "bg-destructive text-destructive-foreground"
      : label === "SPEECH"
        ? "bg-primary text-primary-foreground"
        : "bg-muted text-muted-foreground";

  return (
    <Card className="gradient-card p-6 shadow-soft">
      <div className="mb-4 flex items-center gap-2">
        <Waves className="h-5 w-5 text-primary" />
        <h3 className="text-lg font-semibold">Audio event detection</h3>
      </div>

      <p className="mb-4 text-sm text-muted-foreground">
        Records audio clips to detect falls or coughs and also uses Whisper to listen for help words
        in English plus major Indian regional languages such as Hindi, Tamil,
        Telugu, Bengali, Marathi, Gujarati, Kannada, Malayalam, Punjabi, and
        Odia.
      </p>

      <div className="mb-4 flex h-16 items-end gap-0.5 rounded-lg border border-border/60 bg-background/60 p-2">
        {streamLevel.map((value, index) => (
          <div
            key={index}
            className="flex-1 rounded-sm bg-primary/70 transition-all"
            style={{ height: `${Math.max(4, value * 100)}%` }}
          />
        ))}
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        <Button
          onClick={runOnce}
          disabled={recording || analyzing || continuous}
          className="gradient-primary text-primary-foreground"
        >
          {recording ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" /> Recording...
            </>
          ) : analyzing ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" /> Analyzing...
            </>
          ) : (
            <>
              <Mic className="h-4 w-4" /> Record {CLIP_MS / 1000}s clip
            </>
          )}
        </Button>

        {continuous ? (
          <Button variant="destructive" onClick={stopContinuous}>
            <Square className="h-4 w-4" /> Stop monitoring
          </Button>
        ) : (
          <Button variant="outline" onClick={startContinuous} disabled={recording || analyzing}>
            <Activity className="h-4 w-4" /> Start continuous monitoring
          </Button>
        )}

        {speechRecognitionActive ? (
          <Button variant="destructive" onClick={stopSpeechRecognition}>
            <Square className="h-4 w-4" /> Stop voice detection
          </Button>
        ) : (
          <Button variant="outline" onClick={startSpeechRecognition}>
            <Mic className="h-4 w-4" /> Start voice keyword detection
          </Button>
        )}

        <label className="inline-flex">
          <input type="file" accept="audio/*" className="hidden" onChange={onUpload} />
          <span>
            <Button asChild variant="outline" disabled={analyzing}>
              <span className="cursor-pointer">
                <Upload className="h-4 w-4" /> Upload audio
              </span>
            </Button>
          </span>
        </label>
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        <Button
          variant="secondary"
          onClick={() => simulateDetection("COUGH")}
          disabled={recording || analyzing}
        >
          Simulate cough
        </Button>
        <Button
          variant="secondary"
          onClick={() => simulateDetection("FALL")}
          disabled={recording || analyzing}
        >
          Simulate fall
        </Button>
        <Button
          variant="secondary"
          onClick={() => simulateDetection("HELP")}
          disabled={recording || analyzing}
        >
          Simulate help keyword
        </Button>
      </div>

      {(recording || analyzing) && <Progress value={progress} className="mb-4" />}

      {waveform.length > 0 && (
        <div className="mb-4 flex h-20 items-center gap-0.5 rounded-lg border border-border/60 bg-background/60 p-2">
          {waveform.map((value, index) => (
            <div
              key={index}
              className="flex-1 rounded-sm bg-accent"
              style={{ height: `${Math.max(2, Math.min(100, value * 200))}%` }}
            />
          ))}
        </div>
      )}

      {result && (
        <div className="animate-fade-in-up rounded-xl border border-border/60 bg-background p-4">
          <div className="flex flex-wrap items-center gap-3">
            <Badge className={labelColor(result.label)}>{result.label}</Badge>
            <span className="text-sm text-muted-foreground">
              Confidence {Math.round(result.confidence * 100)}%
            </span>
          </div>

          <p className="mt-2 text-sm leading-relaxed">{result.explanation}</p>

          <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-muted-foreground sm:grid-cols-4">
            <Feature label="RMS" value={result.features.rms.toFixed(3)} />
            <Feature label="Peak" value={result.features.peak.toFixed(3)} />
            <Feature label="ZCR" value={result.features.zcr.toFixed(3)} />
            <Feature label="Centroid" value={`${Math.round(result.features.spectralCentroid)} Hz`} />
            <Feature label="Bursts" value={String(result.features.burstCount)} />
            <Feature label="Burst ratio" value={result.features.burstRatio.toFixed(2)} />
            <Feature label="Duration" value={`${Math.round(result.features.durationMs)} ms`} />
          </div>
        </div>
      )}
    </Card>
  );
};

const Feature = ({ label, value }: { label: string; value: string }) => (
  <div className="rounded-md bg-muted/40 px-2 py-1.5">
    <div className="text-[10px] uppercase tracking-wide">{label}</div>
    <div className="text-sm font-medium text-foreground">{value}</div>
  </div>
);

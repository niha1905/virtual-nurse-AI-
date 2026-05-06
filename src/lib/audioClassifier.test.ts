import { describe, expect, it } from "vitest";

import { classify, extractFeatures } from "@/lib/audioClassifier";

describe("audioClassifier", () => {
  it("classifies silent audio as SILENCE", () => {
    const silent = new Float32Array(4096);
    const features = extractFeatures(silent, 16000);
    const result = classify(features);

    expect(result.label).toBe("SILENCE");
    expect(result.confidence).toBeGreaterThan(0.8);
  });

  it("extracts stable features for a simple waveform", () => {
    const sampleRate = 16000;
    const samples = new Float32Array(sampleRate);

    for (let index = 0; index < samples.length; index++) {
      samples[index] = Math.sin((2 * Math.PI * 440 * index) / sampleRate) * 0.35;
    }

    const features = extractFeatures(samples, sampleRate);

    expect(features.durationMs).toBeCloseTo(1000, 0);
    expect(features.rms).toBeGreaterThan(0.2);
    expect(features.peak).toBeGreaterThan(0.3);
    expect(features.zcr).toBeGreaterThan(0);
    expect(features.spectralCentroid).toBeGreaterThan(0);
  });
});

type DenseLayerWeights = {
  kernelShape: [number, number];
  kernel: number[];
  bias: number[];
};

type ConvLayerWeights = {
  kernelShape: [number, number, number, number];
  kernel: number[];
  bias: number[];
};

type FallModelWeights = {
  labels: ["fall", "nofall"];
  inputShape: [64, 130, 1];
  layers: {
    conv2d: ConvLayerWeights;
    conv2d_1: ConvLayerWeights;
    conv2d_2: ConvLayerWeights;
    dense: DenseLayerWeights;
    dense_1: DenseLayerWeights;
  };
};

export type FallModelPrediction = {
  fallProbability: number;
  noFallProbability: number;
};

export const FALL_MODEL_METADATA = {
  id: "fall_cnn_audio_v1",
  displayName: "Fall Audio CNN",
  task: "Binary audio classification for fall-vs-non-fall detection",
  inputShape: [64, 130, 1] as const,
  labels: ["fall", "nofall"] as const,
  sampleRate: 22050,
  clipDurationSeconds: 3,
  weightsPath: "/models/fall-cnn-weights.json",
} as const;

const MODEL_URL = "/models/fall-cnn-weights.json";
const TARGET_SAMPLE_RATE = 22050;
const TARGET_DURATION_SECONDS = 3;
const TARGET_SAMPLE_COUNT = TARGET_SAMPLE_RATE * TARGET_DURATION_SECONDS;
const N_FFT = 2048;
const HOP_LENGTH = 512;
const N_MELS = 64;
const TARGET_FRAMES = 130;
const EPSILON = 1e-8;

let modelPromise: Promise<FallModelWeights> | null = null;
let hannWindowCache: Float32Array | null = null;
let melFilterBankCache: Float32Array[] | null = null;

const hzToMel = (hz: number) => 2595 * Math.log10(1 + hz / 700);
const melToHz = (mel: number) => 700 * (10 ** (mel / 2595) - 1);

const softmax = (values: number[]) => {
  const maxValue = Math.max(...values);
  const expValues = values.map((value) => Math.exp(value - maxValue));
  const total = expValues.reduce((sum, value) => sum + value, 0);
  return expValues.map((value) => value / total);
};

const assertFinitePositive = (value: number, label: string) => {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${label} must be a positive finite number.`);
  }
};

const assertNonEmptySamples = (samples: Float32Array) => {
  if (samples.length === 0) {
    throw new Error("Audio samples must not be empty.");
  }
};

const expectedConvKernelLength = (shape: ConvLayerWeights["kernelShape"]) =>
  shape[0] * shape[1] * shape[2] * shape[3];

const expectedDenseKernelLength = (shape: DenseLayerWeights["kernelShape"]) =>
  shape[0] * shape[1];

const validateConvLayer = (name: string, layer: ConvLayerWeights) => {
  if (layer.kernel.length !== expectedConvKernelLength(layer.kernelShape)) {
    throw new Error(`Fall model layer "${name}" has invalid kernel length.`);
  }

  if (layer.bias.length !== layer.kernelShape[3]) {
    throw new Error(`Fall model layer "${name}" has invalid bias length.`);
  }
};

const validateDenseLayer = (name: string, layer: DenseLayerWeights) => {
  if (layer.kernel.length !== expectedDenseKernelLength(layer.kernelShape)) {
    throw new Error(`Fall model layer "${name}" has invalid kernel length.`);
  }

  if (layer.bias.length !== layer.kernelShape[1]) {
    throw new Error(`Fall model layer "${name}" has invalid bias length.`);
  }
};

const validateModel = (model: FallModelWeights) => {
  const expectedLabels = FALL_MODEL_METADATA.labels.join(",");
  if (model.labels.join(",") !== expectedLabels) {
    throw new Error("Fall model labels do not match the expected runtime labels.");
  }

  if (model.inputShape.join(",") !== FALL_MODEL_METADATA.inputShape.join(",")) {
    throw new Error("Fall model input shape does not match the runtime expectation.");
  }

  validateConvLayer("conv2d", model.layers.conv2d);
  validateConvLayer("conv2d_1", model.layers.conv2d_1);
  validateConvLayer("conv2d_2", model.layers.conv2d_2);
  validateDenseLayer("dense", model.layers.dense);
  validateDenseLayer("dense_1", model.layers.dense_1);
};

const getHannWindow = () => {
  if (hannWindowCache) return hannWindowCache;

  const window = new Float32Array(N_FFT);
  for (let index = 0; index < N_FFT; index++) {
    window[index] = 0.5 - 0.5 * Math.cos((2 * Math.PI * index) / (N_FFT - 1));
  }
  hannWindowCache = window;
  return window;
};

const getMelFilterBank = () => {
  if (melFilterBankCache) return melFilterBankCache;

  const fftBins = N_FFT / 2 + 1;
  const melMin = hzToMel(0);
  const melMax = hzToMel(TARGET_SAMPLE_RATE / 2);
  const melPoints = Array.from({ length: N_MELS + 2 }, (_, index) =>
    melMin + ((melMax - melMin) * index) / (N_MELS + 1),
  );
  const hzPoints = melPoints.map(melToHz);
  const binPoints = hzPoints.map((hz) => Math.floor(((N_FFT + 1) * hz) / TARGET_SAMPLE_RATE));

  melFilterBankCache = Array.from({ length: N_MELS }, (_, melIndex) => {
    const filter = new Float32Array(fftBins);
    const left = binPoints[melIndex];
    const center = binPoints[melIndex + 1];
    const right = binPoints[melIndex + 2];

    for (let bin = left; bin < center; bin++) {
      filter[bin] = (bin - left) / Math.max(1, center - left);
    }
    for (let bin = center; bin < right; bin++) {
      filter[bin] = (right - bin) / Math.max(1, right - center);
    }

    return filter;
  });

  return melFilterBankCache;
};

const fft = (real: Float32Array, imag: Float32Array) => {
  const length = real.length;
  let swapIndex = 0;

  for (let index = 1; index < length; index++) {
    let bit = length >> 1;
    while (swapIndex & bit) {
      swapIndex ^= bit;
      bit >>= 1;
    }
    swapIndex ^= bit;

    if (index < swapIndex) {
      [real[index], real[swapIndex]] = [real[swapIndex], real[index]];
      [imag[index], imag[swapIndex]] = [imag[swapIndex], imag[index]];
    }
  }

  for (let size = 2; size <= length; size <<= 1) {
    const halfSize = size >> 1;
    const angleStep = (-2 * Math.PI) / size;

    for (let start = 0; start < length; start += size) {
      for (let offset = 0; offset < halfSize; offset++) {
        const evenIndex = start + offset;
        const oddIndex = evenIndex + halfSize;
        const angle = angleStep * offset;
        const cosine = Math.cos(angle);
        const sine = Math.sin(angle);

        const twiddleReal = real[oddIndex] * cosine - imag[oddIndex] * sine;
        const twiddleImag = real[oddIndex] * sine + imag[oddIndex] * cosine;

        real[oddIndex] = real[evenIndex] - twiddleReal;
        imag[oddIndex] = imag[evenIndex] - twiddleImag;
        real[evenIndex] += twiddleReal;
        imag[evenIndex] += twiddleImag;
      }
    }
  }
};

const resampleLinear = (samples: Float32Array, fromRate: number, toRate: number) => {
  if (fromRate === toRate) return new Float32Array(samples);

  const outputLength = Math.max(1, Math.round((samples.length * toRate) / fromRate));
  const output = new Float32Array(outputLength);
  const ratio = fromRate / toRate;

  for (let index = 0; index < outputLength; index++) {
    const sourceIndex = index * ratio;
    const left = Math.floor(sourceIndex);
    const right = Math.min(samples.length - 1, left + 1);
    const fraction = sourceIndex - left;
    output[index] = samples[left] * (1 - fraction) + samples[right] * fraction;
  }

  return output;
};

const normalizeLength = (samples: Float32Array) => {
  if (samples.length === TARGET_SAMPLE_COUNT) return samples;
  if (samples.length > TARGET_SAMPLE_COUNT) return samples.slice(0, TARGET_SAMPLE_COUNT);

  const output = new Float32Array(TARGET_SAMPLE_COUNT);
  output.set(samples);
  return output;
};

const buildMelSpectrogram = (samples: Float32Array) => {
  const padded = new Float32Array(samples.length + N_FFT);
  padded.set(samples, N_FFT / 2);

  const window = getHannWindow();
  const melFilters = getMelFilterBank();
  const fftBins = N_FFT / 2 + 1;
  const frames: Float32Array[] = [];

  for (let start = 0; start + N_FFT <= padded.length; start += HOP_LENGTH) {
    const real = new Float32Array(N_FFT);
    const imag = new Float32Array(N_FFT);

    for (let index = 0; index < N_FFT; index++) {
      real[index] = padded[start + index] * window[index];
    }

    fft(real, imag);

    const powerSpectrum = new Float32Array(fftBins);
    for (let bin = 0; bin < fftBins; bin++) {
      powerSpectrum[bin] = real[bin] * real[bin] + imag[bin] * imag[bin];
    }

    const melFrame = new Float32Array(N_MELS);
    for (let melIndex = 0; melIndex < N_MELS; melIndex++) {
      let sum = 0;
      const filter = melFilters[melIndex];
      for (let bin = 0; bin < fftBins; bin++) {
        sum += filter[bin] * powerSpectrum[bin];
      }
      melFrame[melIndex] = 10 * Math.log10(Math.max(EPSILON, sum));
    }

    frames.push(melFrame);
  }

  const melMatrix = Array.from({ length: N_MELS }, () => new Float32Array(TARGET_FRAMES));
  for (let frameIndex = 0; frameIndex < TARGET_FRAMES; frameIndex++) {
    const frame = frames[frameIndex];
    if (!frame) continue;
    for (let melIndex = 0; melIndex < N_MELS; melIndex++) {
      melMatrix[melIndex][frameIndex] = frame[melIndex];
    }
  }

  let sum = 0;
  let count = 0;
  for (const row of melMatrix) {
    for (const value of row) {
      sum += value;
      count++;
    }
  }
  const mean = count ? sum / count : 0;

  let variance = 0;
  for (const row of melMatrix) {
    for (const value of row) {
      const centered = value - mean;
      variance += centered * centered;
    }
  }
  const std = Math.sqrt(variance / Math.max(1, count)) || 1;

  const output = new Float32Array(N_MELS * TARGET_FRAMES);
  for (let melIndex = 0; melIndex < N_MELS; melIndex++) {
    for (let frameIndex = 0; frameIndex < TARGET_FRAMES; frameIndex++) {
      output[melIndex * TARGET_FRAMES + frameIndex] =
        (melMatrix[melIndex][frameIndex] - mean) / std;
    }
  }

  return {
    data: output,
    height: N_MELS,
    width: TARGET_FRAMES,
    channels: 1,
  };
};

const conv2dValidRelu = (
  input: Float32Array,
  inputHeight: number,
  inputWidth: number,
  inputChannels: number,
  layer: ConvLayerWeights,
) => {
  const [kernelHeight, kernelWidth, kernelChannels, outputChannels] = layer.kernelShape;
  if (kernelChannels !== inputChannels) {
    throw new Error("Fall model channel count mismatch.");
  }

  const outputHeight = inputHeight - kernelHeight + 1;
  const outputWidth = inputWidth - kernelWidth + 1;
  const output = new Float32Array(outputHeight * outputWidth * outputChannels);

  for (let outY = 0; outY < outputHeight; outY++) {
    for (let outX = 0; outX < outputWidth; outX++) {
      for (let outChannel = 0; outChannel < outputChannels; outChannel++) {
        let sum = layer.bias[outChannel] || 0;

        for (let kernelY = 0; kernelY < kernelHeight; kernelY++) {
          for (let kernelX = 0; kernelX < kernelWidth; kernelX++) {
            for (let inChannel = 0; inChannel < inputChannels; inChannel++) {
              const inputIndex =
                ((outY + kernelY) * inputWidth + (outX + kernelX)) * inputChannels + inChannel;
              const kernelIndex =
                (((kernelY * kernelWidth + kernelX) * inputChannels + inChannel) * outputChannels) +
                outChannel;
              sum += input[inputIndex] * layer.kernel[kernelIndex];
            }
          }
        }

        output[(outY * outputWidth + outX) * outputChannels + outChannel] = Math.max(0, sum);
      }
    }
  }

  return {
    data: output,
    height: outputHeight,
    width: outputWidth,
    channels: outputChannels,
  };
};

const maxPool2d = (
  input: Float32Array,
  inputHeight: number,
  inputWidth: number,
  inputChannels: number,
) => {
  const outputHeight = Math.floor(inputHeight / 2);
  const outputWidth = Math.floor(inputWidth / 2);
  const output = new Float32Array(outputHeight * outputWidth * inputChannels);

  for (let outY = 0; outY < outputHeight; outY++) {
    for (let outX = 0; outX < outputWidth; outX++) {
      for (let channel = 0; channel < inputChannels; channel++) {
        let maxValue = -Infinity;
        for (let offsetY = 0; offsetY < 2; offsetY++) {
          for (let offsetX = 0; offsetX < 2; offsetX++) {
            const inputIndex =
              (((outY * 2 + offsetY) * inputWidth + (outX * 2 + offsetX)) * inputChannels) +
              channel;
            maxValue = Math.max(maxValue, input[inputIndex]);
          }
        }
        output[(outY * outputWidth + outX) * inputChannels + channel] = maxValue;
      }
    }
  }

  return { data: output, height: outputHeight, width: outputWidth, channels: inputChannels };
};

const globalAveragePool = (
  input: Float32Array,
  inputHeight: number,
  inputWidth: number,
  inputChannels: number,
) => {
  const output = new Float32Array(inputChannels);
  const area = inputHeight * inputWidth;

  for (let channel = 0; channel < inputChannels; channel++) {
    let sum = 0;
    for (let y = 0; y < inputHeight; y++) {
      for (let x = 0; x < inputWidth; x++) {
        sum += input[(y * inputWidth + x) * inputChannels + channel];
      }
    }
    output[channel] = sum / Math.max(1, area);
  }

  return output;
};

const dense = (input: Float32Array, layer: DenseLayerWeights, applyRelu = false) => {
  const [inputUnits, outputUnits] = layer.kernelShape;
  if (input.length !== inputUnits) {
    throw new Error("Fall model dense layer input mismatch.");
  }

  const output = new Float32Array(outputUnits);
  for (let outputIndex = 0; outputIndex < outputUnits; outputIndex++) {
    let sum = layer.bias[outputIndex] || 0;
    for (let inputIndex = 0; inputIndex < inputUnits; inputIndex++) {
      sum += input[inputIndex] * layer.kernel[inputIndex * outputUnits + outputIndex];
    }
    output[outputIndex] = applyRelu ? Math.max(0, sum) : sum;
  }

  return output;
};

const loadModel = async () => {
  if (!modelPromise) {
    modelPromise = fetch(MODEL_URL).then(async (response) => {
      if (!response.ok) {
        throw new Error(`Failed to load fall model weights (${response.status}).`);
      }

      const model = (await response.json()) as FallModelWeights;
      validateModel(model);
      return model;
    });
  }

  return modelPromise;
};

export const predictFallFromAudio = async (
  samples: Float32Array,
  sampleRate: number,
): Promise<FallModelPrediction> => {
  assertNonEmptySamples(samples);
  assertFinitePositive(sampleRate, "Sample rate");

  const model = await loadModel();
  const resampled = resampleLinear(samples, sampleRate, TARGET_SAMPLE_RATE);
  const normalized = normalizeLength(resampled);

  let tensor = buildMelSpectrogram(normalized);
  tensor = conv2dValidRelu(
    tensor.data,
    tensor.height,
    tensor.width,
    tensor.channels,
    model.layers.conv2d,
  );
  tensor = maxPool2d(tensor.data, tensor.height, tensor.width, tensor.channels);
  tensor = conv2dValidRelu(
    tensor.data,
    tensor.height,
    tensor.width,
    tensor.channels,
    model.layers.conv2d_1,
  );
  tensor = maxPool2d(tensor.data, tensor.height, tensor.width, tensor.channels);
  tensor = conv2dValidRelu(
    tensor.data,
    tensor.height,
    tensor.width,
    tensor.channels,
    model.layers.conv2d_2,
  );

  const pooled = globalAveragePool(tensor.data, tensor.height, tensor.width, tensor.channels);
  const hidden = dense(pooled, model.layers.dense, true);
  const logits = Array.from(dense(hidden, model.layers.dense_1));
  const [fallProbability, noFallProbability] = softmax(logits);

  return { fallProbability, noFallProbability };
};

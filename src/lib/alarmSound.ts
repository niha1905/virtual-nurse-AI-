// Synthesises a loud, attention-grabbing emergency siren via WebAudio.
// No external assets required.
let ctx: AudioContext | null = null;
let masterGain: GainNode | null = null;
let oscA: OscillatorNode | null = null;
let oscB: OscillatorNode | null = null;
let lfoTimer: number | null = null;
let playing = false;
let medicationGain: GainNode | null = null;
let medicationOsc: OscillatorNode | null = null;
let medicationPulseTimer: number | null = null;
let medicationPlaying = false;

type AudioContextCtor = typeof AudioContext & {
  new (): AudioContext;
};

const ensureCtx = () => {
  if (!ctx) {
    const browserWindow = window as Window &
      typeof globalThis & {
        webkitAudioContext?: AudioContextCtor;
      };
    const AudioContextClass = browserWindow.AudioContext ?? browserWindow.webkitAudioContext;
    if (!AudioContextClass) {
      throw new Error("Web Audio is not supported in this browser.");
    }
    ctx = new AudioContextClass();
  }
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
};

export const startAlarm = () => {
  if (playing) return;
  const c = ensureCtx();
  masterGain = c.createGain();
  masterGain.gain.value = 0.0001;
  masterGain.connect(c.destination);

  oscA = c.createOscillator();
  oscB = c.createOscillator();
  oscA.type = "sawtooth";
  oscB.type = "square";
  oscA.frequency.value = 880;
  oscB.frequency.value = 660;
  oscA.connect(masterGain);
  oscB.connect(masterGain);

  // Fade in
  masterGain.gain.exponentialRampToValueAtTime(0.35, c.currentTime + 0.15);

  oscA.start();
  oscB.start();

  // Two-tone siren — alternate frequencies every 350ms
  let high = true;
  lfoTimer = window.setInterval(() => {
    if (!ctx || !oscA || !oscB) return;
    const t = ctx.currentTime;
    if (high) {
      oscA.frequency.setValueAtTime(1180, t);
      oscB.frequency.setValueAtTime(880, t);
    } else {
      oscA.frequency.setValueAtTime(720, t);
      oscB.frequency.setValueAtTime(540, t);
    }
    high = !high;
  }, 350);

  playing = true;
};

export const stopAlarm = () => {
  if (!playing) return;
  if (lfoTimer) window.clearInterval(lfoTimer);
  lfoTimer = null;
  if (masterGain && ctx) {
    const t = ctx.currentTime;
    masterGain.gain.cancelScheduledValues(t);
    masterGain.gain.setValueAtTime(masterGain.gain.value, t);
    masterGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.1);
  }
  setTimeout(() => {
    try {
      oscA?.stop();
      oscB?.stop();
    } catch {
      /* noop */
    }
    oscA?.disconnect();
    oscB?.disconnect();
    masterGain?.disconnect();
    oscA = null;
    oscB = null;
    masterGain = null;
  }, 150);
  playing = false;
};

export const isAlarmPlaying = () => playing;

export const startMedicationAlarm = () => {
  if (medicationPlaying) return;
  const c = ensureCtx();
  medicationGain = c.createGain();
  medicationGain.gain.value = 0.0001;
  medicationGain.connect(c.destination);

  medicationOsc = c.createOscillator();
  medicationOsc.type = "triangle";
  medicationOsc.frequency.value = 988;
  medicationOsc.connect(medicationGain);
  medicationOsc.start();

  let loud = false;
  medicationPulseTimer = window.setInterval(() => {
    if (!ctx || !medicationGain || !medicationOsc) return;
    const t = ctx.currentTime;
    medicationGain.gain.cancelScheduledValues(t);
    medicationGain.gain.setValueAtTime(Math.max(medicationGain.gain.value, 0.0001), t);
    medicationGain.gain.exponentialRampToValueAtTime(loud ? 0.0001 : 0.18, t + 0.08);
    medicationOsc.frequency.setValueAtTime(loud ? 784 : 988, t);
    loud = !loud;
  }, 700);

  medicationPlaying = true;
};

export const stopMedicationAlarm = () => {
  if (!medicationPlaying) return;
  if (medicationPulseTimer) window.clearInterval(medicationPulseTimer);
  medicationPulseTimer = null;

  if (medicationGain && ctx) {
    const t = ctx.currentTime;
    medicationGain.gain.cancelScheduledValues(t);
    medicationGain.gain.setValueAtTime(Math.max(medicationGain.gain.value, 0.0001), t);
    medicationGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.1);
  }

  window.setTimeout(() => {
    try {
      medicationOsc?.stop();
    } catch {
      /* noop */
    }
    medicationOsc?.disconnect();
    medicationGain?.disconnect();
    medicationOsc = null;
    medicationGain = null;
  }, 150);

  medicationPlaying = false;
};

export const isMedicationAlarmPlaying = () => medicationPlaying;

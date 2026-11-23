export const SOUND_MUTED_STORAGE_KEY = 'belote-web:sound-muted:v1';

type AudioContextCtor = typeof AudioContext;

interface WindowWithWebkitAudio extends Window {
  webkitAudioContext?: AudioContextCtor;
}

let audioCtx: AudioContext | null = null;
let masterGain: GainNode | null = null;
let masterGainCtx: AudioContext | null = null;
let cachedNoiseBuffer: AudioBuffer | null = null;
let cachedNoiseCtx: AudioContext | null = null;
let mutedState: boolean | null = null;
const mutedListeners = new Set<() => void>();

function getDefaultStorage(): Storage | null {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      return window.localStorage;
    }
    if (typeof globalThis !== 'undefined' && 'localStorage' in globalThis && globalThis.localStorage) {
      return globalThis.localStorage;
    }
  } catch {
    // Storage access can throw in restricted browser contexts.
  }
  return null;
}

export function loadMutedPreference(storage: Storage | null = getDefaultStorage()): boolean {
  if (!storage) return false;
  try {
    return storage.getItem(SOUND_MUTED_STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

export function isMuted(): boolean {
  if (mutedState === null) {
    mutedState = loadMutedPreference();
  }
  return mutedState;
}

export function setMuted(muted: boolean, storage: Storage | null = getDefaultStorage()): void {
  const prev = isMuted();
  mutedState = muted;
  if (masterGain && audioCtx && audioCtx.state !== 'closed') {
    try {
      masterGain.gain.setValueAtTime(muted ? 0 : 1, audioCtx.currentTime);
    } catch {
      // Ignore Web Audio parameter errors.
    }
  }
  if (storage) {
    try {
      storage.setItem(SOUND_MUTED_STORAGE_KEY, muted ? 'true' : 'false');
    } catch {
      // Ignore quota / privacy mode storage errors.
    }
  }
  if (prev !== muted) {
    for (const listener of mutedListeners) {
      listener();
    }
  }
}

export function toggleMuted(storage: Storage | null = getDefaultStorage()): boolean {
  const next = !isMuted();
  setMuted(next, storage);
  return next;
}

export function subscribeMuted(listener: () => void): () => void {
  mutedListeners.add(listener);
  return () => {
    mutedListeners.delete(listener);
  };
}

function getAudioContextCtor(): AudioContextCtor | null {
  if (typeof globalThis === 'undefined') return null;
  if (typeof globalThis.AudioContext === 'function') {
    return globalThis.AudioContext;
  }
  if (typeof window !== 'undefined') {
    const webkitCtor = (window as WindowWithWebkitAudio).webkitAudioContext;
    if (typeof webkitCtor === 'function') {
      return webkitCtor;
    }
  }
  return null;
}

function getReadyAudioContext(): AudioContext | null {
  if (isMuted()) return null;

  const Ctor = getAudioContextCtor();
  if (!Ctor) return null;

  try {
    if (!audioCtx || audioCtx.state === 'closed') {
      audioCtx = new Ctor();
    }
    if (audioCtx.state === 'suspended') {
      if (typeof audioCtx.resume === 'function') {
        audioCtx.resume().catch(() => {});
      }
      return null;
    }
    return audioCtx;
  } catch {
    return null;
  }
}

function getOutputNode(ctx: AudioContext): AudioNode {
  if (masterGain && masterGainCtx === ctx) {
    return masterGain;
  }
  const node = ctx.createGain();
  node.gain.setValueAtTime(isMuted() ? 0 : 1, ctx.currentTime);
  node.connect(ctx.destination);
  masterGain = node;
  masterGainCtx = ctx;
  return node;
}

function getNoiseBuffer(ctx: AudioContext): AudioBuffer | null {
  if (typeof ctx.createBuffer !== 'function') return null;
  if (cachedNoiseBuffer && cachedNoiseCtx === ctx) {
    return cachedNoiseBuffer;
  }
  try {
    const length = Math.max(1, Math.floor(ctx.sampleRate * 0.12));
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) {
      // Slightly shaped white noise for a warmer paper-on-felt snap.
      data[i] = (Math.random() * 2 - 1) * (1 - i / length);
    }
    cachedNoiseBuffer = buffer;
    cachedNoiseCtx = ctx;
    return buffer;
  } catch {
    return null;
  }
}

function scheduleNoiseTick(
  ctx: AudioContext,
  startTime: number,
  duration: number,
  filterFreq: number,
  peakGain: number,
): void {
  const buffer = getNoiseBuffer(ctx);
  if (buffer && typeof ctx.createBufferSource === 'function' && typeof ctx.createBiquadFilter === 'function') {
    const src = ctx.createBufferSource();
    src.buffer = buffer;

    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(filterFreq, startTime);
    filter.Q.setValueAtTime(1.5, startTime);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, startTime);
    gain.gain.exponentialRampToValueAtTime(peakGain, startTime + 0.004);
    gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);

    src.connect(filter);
    filter.connect(gain);
    gain.connect(getOutputNode(ctx));

    src.start(startTime);
    src.stop(startTime + duration + 0.005);
    return;
  }

  // Fallback short percussive tick if buffer creation is unavailable.
  scheduleTone(ctx, startTime, duration, 'triangle', 220, peakGain * 0.8, 110);
}

function scheduleTone(
  ctx: AudioContext,
  startTime: number,
  duration: number,
  type: OscillatorType,
  freqStart: number,
  peakGain: number,
  freqEnd?: number,
  lowpassFreq?: number,
): void {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();

  osc.type = type;
  osc.frequency.setValueAtTime(freqStart, startTime);
  if (freqEnd !== undefined && freqEnd !== freqStart) {
    osc.frequency.exponentialRampToValueAtTime(freqEnd, startTime + duration);
  }

  const attack = Math.min(0.012, duration * 0.2);
  gain.gain.setValueAtTime(0.0001, startTime);
  gain.gain.exponentialRampToValueAtTime(peakGain, startTime + attack);
  gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);

  if (lowpassFreq && typeof ctx.createBiquadFilter === 'function') {
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(lowpassFreq, startTime);
    osc.connect(filter);
    filter.connect(gain);
  } else {
    osc.connect(gain);
  }

  gain.connect(getOutputNode(ctx));
  osc.start(startTime);
  osc.stop(startTime + duration + 0.01);
}

/** Soft crisp percussive snap when a card hits the baize. */
export function playCardSnap(): void {
  const ctx = getReadyAudioContext();
  if (!ctx) return;

  try {
    const now = ctx.currentTime;
    scheduleNoiseTick(ctx, now, 0.038, 1850, 0.09);
    scheduleTone(ctx, now, 0.032, 'triangle', 175, 0.045, 85);
  } catch {
    // Ignore audio errors.
  }
}

/** Quick soft 3-tick deal riffle when a round starts or cards are dealt. */
export function playDealSound(): void {
  const ctx = getReadyAudioContext();
  if (!ctx) return;

  try {
    const now = ctx.currentTime;
    const offsets = [0, 0.055, 0.11];
    const freqs = [1450, 1700, 1950];
    for (let i = 0; i < offsets.length; i++) {
      scheduleNoiseTick(ctx, now + offsets[i], 0.03, freqs[i], 0.065);
    }
  } catch {
    // Ignore audio errors.
  }
}

/** Warm 2-note chime for winning a trick, softer muted tone for losing. */
export function playTrickWin(wonByLocal: boolean): void {
  const ctx = getReadyAudioContext();
  if (!ctx) return;

  try {
    const now = ctx.currentTime;
    if (wonByLocal) {
      // Warm ascending C5 -> G5 chime
      scheduleTone(ctx, now, 0.18, 'sine', 523.25, 0.065);
      scheduleTone(ctx, now + 0.085, 0.26, 'sine', 783.99, 0.07);
      scheduleTone(ctx, now + 0.085, 0.22, 'triangle', 1567.98, 0.014, undefined, 2200);
    } else {
      // Soft muted descending E4 -> C4 tone
      scheduleTone(ctx, now, 0.15, 'sine', 329.63, 0.04, undefined, 900);
      scheduleTone(ctx, now + 0.08, 0.2, 'sine', 261.63, 0.042, undefined, 800);
    }
  } catch {
    // Ignore audio errors.
  }
}

/** Brief warm brassy triad when Belote or Rebelote is declared. */
export function playBeloteFanfare(): void {
  const ctx = getReadyAudioContext();
  if (!ctx) return;

  try {
    const now = ctx.currentTime;
    // Warm D major triad (D4, F#4, A4) with soft brassy low-pass filtering
    const notes = [
      { freq: 293.66, offset: 0, duration: 0.36 },
      { freq: 369.99, offset: 0.065, duration: 0.34 },
      { freq: 440.0, offset: 0.13, duration: 0.38 },
    ];
    for (const note of notes) {
      scheduleTone(ctx, now + note.offset, note.duration, 'sawtooth', note.freq, 0.032, undefined, 1350);
      scheduleTone(ctx, now + note.offset, note.duration, 'triangle', note.freq * 2, 0.018, undefined, 1600);
    }
  } catch {
    // Ignore audio errors.
  }
}

/** Gentle bell ping when it becomes the local player's turn. */
export function playTurnPing(): void {
  const ctx = getReadyAudioContext();
  if (!ctx) return;

  try {
    const now = ctx.currentTime;
    scheduleTone(ctx, now, 0.24, 'sine', 880, 0.048);
    scheduleTone(ctx, now, 0.16, 'sine', 1760, 0.012);
  } catch {
    // Ignore audio errors.
  }
}

/** Internal test helper to reset module-level audio caches between unit tests. */
export function resetAudioStateForTests(): void {
  audioCtx = null;
  masterGain = null;
  masterGainCtx = null;
  cachedNoiseBuffer = null;
  cachedNoiseCtx = null;
  mutedState = null;
  mutedListeners.clear();
}

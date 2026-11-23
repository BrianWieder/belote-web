import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  SOUND_MUTED_STORAGE_KEY,
  isMuted,
  loadMutedPreference,
  playBeloteFanfare,
  playCardSnap,
  playDealSound,
  playTrickWin,
  playTurnPing,
  resetAudioStateForTests,
  setMuted,
  subscribeMuted,
  toggleMuted,
} from '../sounds';

function createMemoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear() {
      map.clear();
    },
    getItem(key: string) {
      return map.get(key) ?? null;
    },
    key(index: number) {
      return Array.from(map.keys())[index] ?? null;
    },
    removeItem(key: string) {
      map.delete(key);
    },
    setItem(key: string, value: string) {
      map.set(key, value);
    },
  };
}

function createMockAudioContext(state: AudioContextState = 'running') {
  const createdOscillators: Array<{ start: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn> }> = [];
  const createdBufferSources: Array<{ start: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn> }> = [];
  const resume = vi.fn(() => Promise.resolve());

  const makeParam = () => ({
    setValueAtTime: vi.fn(),
    exponentialRampToValueAtTime: vi.fn(),
  });

  const instance = {
    state,
    currentTime: 1.5,
    sampleRate: 44100,
    destination: {},
    resume,
    createBuffer: vi.fn((_channels: number, length: number) => ({
      getChannelData: () => new Float32Array(length),
    })),
    createBufferSource: vi.fn(() => {
      const node = {
        buffer: null as unknown,
        connect: vi.fn(),
        start: vi.fn(),
        stop: vi.fn(),
      };
      createdBufferSources.push(node);
      return node;
    }),
    createBiquadFilter: vi.fn(() => ({
      type: 'bandpass',
      frequency: makeParam(),
      Q: makeParam(),
      connect: vi.fn(),
    })),
    createGain: vi.fn(() => ({
      gain: makeParam(),
      connect: vi.fn(),
    })),
    createOscillator: vi.fn(() => {
      const node = {
        type: 'sine',
        frequency: makeParam(),
        connect: vi.fn(),
        start: vi.fn(),
        stop: vi.fn(),
      };
      createdOscillators.push(node);
      return node;
    }),
  };

  return { instance, createdOscillators, createdBufferSources, resume };
}

describe('audio/sounds', () => {
  const originalAudioContext = globalThis.AudioContext;

  beforeEach(() => {
    resetAudioStateForTests();
  });

  afterEach(() => {
    resetAudioStateForTests();
    if (originalAudioContext === undefined) {
      delete (globalThis as { AudioContext?: typeof AudioContext }).AudioContext;
    } else {
      globalThis.AudioContext = originalAudioContext;
    }
  });

  it('defaults to unmuted and persists mute preference to storage', () => {
    const storage = createMemoryStorage();
    expect(loadMutedPreference(storage)).toBe(false);
    expect(isMuted()).toBe(false);

    setMuted(true, storage);
    expect(isMuted()).toBe(true);
    expect(storage.getItem(SOUND_MUTED_STORAGE_KEY)).toBe('true');
    expect(loadMutedPreference(storage)).toBe(true);

    const afterToggle = toggleMuted(storage);
    expect(afterToggle).toBe(false);
    expect(isMuted()).toBe(false);
    expect(storage.getItem(SOUND_MUTED_STORAGE_KEY)).toBe('false');
  });

  it('handles storage errors gracefully without throwing', () => {
    const failingStorage: Storage = {
      ...createMemoryStorage(),
      getItem() {
        throw new Error('SecurityError');
      },
      setItem() {
        throw new Error('QuotaExceededError');
      },
    };

    expect(loadMutedPreference(failingStorage)).toBe(false);
    expect(() => setMuted(true, failingStorage)).not.toThrow();
    expect(isMuted()).toBe(true);
  });

  it('notifies subscribers only when muted state changes and supports unsubscribe', () => {
    const storage = createMemoryStorage();
    const listener = vi.fn();
    const unsub = subscribeMuted(listener);

    setMuted(false, storage);
    expect(listener).not.toHaveBeenCalled();

    setMuted(true, storage);
    expect(listener).toHaveBeenCalledTimes(1);

    setMuted(true, storage);
    expect(listener).toHaveBeenCalledTimes(1);

    unsub();
    setMuted(false, storage);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('safely no-ops all play functions when AudioContext is absent', () => {
    delete (globalThis as { AudioContext?: typeof AudioContext }).AudioContext;

    expect(() => playCardSnap()).not.toThrow();
    expect(() => playDealSound()).not.toThrow();
    expect(() => playTrickWin(true)).not.toThrow();
    expect(() => playTrickWin(false)).not.toThrow();
    expect(() => playBeloteFanfare()).not.toThrow();
    expect(() => playTurnPing()).not.toThrow();
  });

  it('attempts resume without scheduling cues while AudioContext is suspended', () => {
    const mock = createMockAudioContext('suspended');
    mock.resume.mockImplementationOnce(() => Promise.reject(new Error('Autoplay blocked')));

    class MockAudioContext {
      constructor() {
        return mock.instance as unknown as MockAudioContext;
      }
    }
    globalThis.AudioContext = MockAudioContext as unknown as typeof AudioContext;

    playCardSnap();
    playBeloteFanfare();
    expect(mock.resume).toHaveBeenCalledTimes(2);
    expect(mock.createdBufferSources.length).toBe(0);
    expect(mock.createdOscillators.length).toBe(0);
  });

  it('synthesizes sounds when AudioContext is running and respects mute', () => {
    const mock = createMockAudioContext('running');

    class MockAudioContext {
      constructor() {
        return mock.instance as unknown as MockAudioContext;
      }
    }
    globalThis.AudioContext = MockAudioContext as unknown as typeof AudioContext;

    playCardSnap();
    expect(mock.createdBufferSources.length).toBeGreaterThan(0);
    expect(mock.createdOscillators.length).toBeGreaterThan(0);

    const oscAfterSnap = mock.createdOscillators.length;
    const srcAfterSnap = mock.createdBufferSources.length;

    playDealSound();
    expect(mock.createdBufferSources.length).toBe(srcAfterSnap + 3);

    playTrickWin(true);
    playTrickWin(false);
    playBeloteFanfare();
    playTurnPing();
    expect(mock.createdOscillators.length).toBeGreaterThan(oscAfterSnap + 5);

    // Muting silences the shared master gain immediately and prevents further synthesis.
    const oscBeforeMute = mock.createdOscillators.length;
    const srcBeforeMute = mock.createdBufferSources.length;
    const masterGainNode = mock.instance.createGain.mock.results[1]?.value;
    const storage = createMemoryStorage();
    setMuted(true, storage);
    expect(masterGainNode.gain.setValueAtTime).toHaveBeenCalledWith(0, mock.instance.currentTime);

    playCardSnap();
    playDealSound();
    playTrickWin(true);
    playBeloteFanfare();
    playTurnPing();

    expect(mock.createdOscillators.length).toBe(oscBeforeMute);
    expect(mock.createdBufferSources.length).toBe(srcBeforeMute);

    // Unmuting restores the master gain back to 1.
    setMuted(false, storage);
    expect(masterGainNode.gain.setValueAtTime).toHaveBeenCalledWith(1, mock.instance.currentTime);
  });
});

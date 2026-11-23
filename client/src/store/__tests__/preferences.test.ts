import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../../networking/peer', () => ({
  sendPeerMessage: vi.fn(() => true),
}));

import {
  TWO_TAP_PLAY_STORAGE_KEY,
  loadTwoTapPlay,
  saveTwoTapPlay,
  resolveCardTap,
} from '../preferences';
import { useGameStore } from '../gameStore';

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

describe('preferences persistence (twoTapPlay)', () => {
  it('defaults to false when unset or when storage is unavailable', () => {
    const storage = createMemoryStorage();
    expect(loadTwoTapPlay(storage)).toBe(false);
    expect(loadTwoTapPlay(null)).toBe(false);
  });

  it('saves and loads true and false values under the expected storage key', () => {
    const storage = createMemoryStorage();

    expect(saveTwoTapPlay(true, storage)).toBe(true);
    expect(storage.getItem(TWO_TAP_PLAY_STORAGE_KEY)).toBe('true');
    expect(loadTwoTapPlay(storage)).toBe(true);

    expect(saveTwoTapPlay(false, storage)).toBe(true);
    expect(storage.getItem(TWO_TAP_PLAY_STORAGE_KEY)).toBe('false');
    expect(loadTwoTapPlay(storage)).toBe(false);
  });

  it('treats corrupted or unexpected stored values as false', () => {
    const storage = createMemoryStorage();
    storage.setItem(TWO_TAP_PLAY_STORAGE_KEY, '1');
    expect(loadTwoTapPlay(storage)).toBe(false);

    storage.setItem(TWO_TAP_PLAY_STORAGE_KEY, 'yes');
    expect(loadTwoTapPlay(storage)).toBe(false);
  });

  it('handles storage errors gracefully without throwing', () => {
    const throwingStorage: Storage = {
      ...createMemoryStorage(),
      getItem() {
        throw new Error('SecurityError');
      },
      setItem() {
        throw new Error('QuotaExceededError');
      },
    };

    expect(loadTwoTapPlay(throwingStorage)).toBe(false);
    expect(saveTwoTapPlay(true, throwingStorage)).toBe(false);
    expect(saveTwoTapPlay(true, null)).toBe(false);
  });
});

describe('resolveCardTap (card selection logic)', () => {
  it('ignores non-playable cards in both 1-tap and 2-tap modes', () => {
    expect(
      resolveCardTap({
        cardKey: 'A-spades',
        isPlayable: false,
        twoTapPlay: false,
        selectedCardKey: null,
      }),
    ).toEqual({ kind: 'ignore' });

    expect(
      resolveCardTap({
        cardKey: 'A-spades',
        isPlayable: false,
        twoTapPlay: true,
        selectedCardKey: 'A-spades',
      }),
    ).toEqual({ kind: 'ignore' });
  });

  it('plays immediately on first tap when twoTapPlay is disabled', () => {
    expect(
      resolveCardTap({
        cardKey: 'K-hearts',
        isPlayable: true,
        twoTapPlay: false,
        selectedCardKey: null,
      }),
    ).toEqual({ kind: 'play', cardKey: 'K-hearts' });
  });

  it('selects on first tap, switches on different card tap, and plays on second tap when twoTapPlay is enabled', () => {
    // First tap on hand card selects it
    expect(
      resolveCardTap({
        cardKey: 'A-spades',
        isPlayable: true,
        twoTapPlay: true,
        selectedCardKey: null,
      }),
    ).toEqual({ kind: 'select', cardKey: 'A-spades' });

    // Tapping a different playable card (e.g. in tableau) switches selection
    expect(
      resolveCardTap({
        cardKey: '10-diamonds',
        isPlayable: true,
        twoTapPlay: true,
        selectedCardKey: 'A-spades',
      }),
    ).toEqual({ kind: 'select', cardKey: '10-diamonds' });

    // Tapping the same card a second time confirms and plays it
    expect(
      resolveCardTap({
        cardKey: '10-diamonds',
        isPlayable: true,
        twoTapPlay: true,
        selectedCardKey: '10-diamonds',
      }),
    ).toEqual({ kind: 'play', cardKey: '10-diamonds' });
  });
});

describe('gameStore two-tap selection state', () => {
  beforeEach(() => {
    useGameStore.setState({
      gameState: null,
      connectionStatus: 'connected',
      connectionError: null,
      roomCode: null,
      isHost: false,
      localPlayer: 0,
      twoTapPlay: false,
      selectedCardKey: null,
    });
  });

  it('clears selectedCardKey when disabling twoTapPlay', () => {
    useGameStore.getState().setTwoTapPlay(true);
    useGameStore.getState().setSelectedCardKey('A-spades');
    expect(useGameStore.getState().selectedCardKey).toBe('A-spades');

    useGameStore.getState().setTwoTapPlay(false);
    expect(useGameStore.getState().twoTapPlay).toBe(false);
    expect(useGameStore.getState().selectedCardKey).toBeNull();
  });

  it('clears selectedCardKey when a game action or remote action updates state', () => {
    // Dealer 1 -> local player 0 acts first
    useGameStore.getState().initGame('selection-clear-seed', 1);
    useGameStore.getState().setTwoTapPlay(true);
    useGameStore.getState().setSelectedCardKey('J-hearts');

    useGameStore.getState().performAction({ type: 'bid-take' });
    expect(useGameStore.getState().selectedCardKey).toBeNull();

    // Selecting again then resetting connection clears selection but preserves twoTapPlay preference
    useGameStore.getState().setSelectedCardKey('9-clubs');
    useGameStore.getState().resetConnection();
    expect(useGameStore.getState().selectedCardKey).toBeNull();
    expect(useGameStore.getState().twoTapPlay).toBe(true);
  });
});

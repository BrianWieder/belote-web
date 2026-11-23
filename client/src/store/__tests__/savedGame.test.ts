import { describe, it, expect } from 'vitest';
import { createInitialState, applyAction } from '../../game/engine';
import { cardToString, DEFAULT_MATCH_OPTIONS } from '../../game/types';
import { getPlayableCards } from '../../game/validation';
import {
  SAVED_GAME_STORAGE_KEY,
  clearSavedGame,
  describeSavedPhase,
  formatSavedAt,
  isValidGameState,
  isValidResumableGameState,
  loadSavedGame,
  saveHostGame,
} from '../savedGame';

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

describe('savedGame persistence', () => {
  it('saves and loads an in-progress playing state round-trip', () => {
    const storage = createMemoryStorage();
    const initial = createInitialState('resume-seed', 0);
    const playing = applyAction(initial, initial.currentPlayer, { type: 'bid-take' });
    const playable = getPlayableCards(playing);
    const afterCard = applyAction(playing, playing.currentPlayer, {
      type: 'play-card',
      card: cardToString(playable[0]),
    });

    saveHostGame(afterCard, storage);

    const loaded = loadSavedGame(storage);
    expect(loaded).not.toBeNull();
    expect(loaded!.version).toBe(1);
    expect(loaded!.gameState).toEqual(afterCard);
  });

  it('clears saved game when phase reaches game-over', () => {
    const storage = createMemoryStorage();
    const initial = createInitialState('finish-seed', 0);
    saveHostGame(initial, storage);
    expect(loadSavedGame(storage)).not.toBeNull();

    const finished = { ...initial, phase: 'game-over' as const };
    saveHostGame(finished, storage);
    expect(loadSavedGame(storage)).toBeNull();
    expect(storage.getItem(SAVED_GAME_STORAGE_KEY)).toBeNull();
  });

  it('discards corrupted JSON or mismatched version safely', () => {
    const storage = createMemoryStorage();
    storage.setItem(SAVED_GAME_STORAGE_KEY, '{not valid json');
    expect(loadSavedGame(storage)).toBeNull();
    expect(storage.getItem(SAVED_GAME_STORAGE_KEY)).toBeNull();

    const initial = createInitialState('v2-seed', 0);
    storage.setItem(
      SAVED_GAME_STORAGE_KEY,
      JSON.stringify({ version: 2, savedAt: Date.now(), gameState: initial }),
    );
    expect(loadSavedGame(storage)).toBeNull();
    expect(storage.getItem(SAVED_GAME_STORAGE_KEY)).toBeNull();
  });

  it('rejects game-over or malformed game states in validator', () => {
    const initial = createInitialState('validate-seed', 0);
    expect(isValidResumableGameState(initial)).toBe(true);
    expect(isValidResumableGameState({ ...initial, phase: 'game-over' })).toBe(false);
    expect(isValidGameState({ ...initial, phase: 'game-over' })).toBe(true);
    expect(isValidGameState({ ...initial, phase: 'bogus-phase' })).toBe(false);
    expect(isValidResumableGameState({ ...initial, seed: '' })).toBe(false);
    expect(isValidResumableGameState({ ...initial, hands: [initial.hands[0]] })).toBe(false);
    expect(isValidResumableGameState({ ...initial, roundScores: [{ bad: true }] })).toBe(false);
    // Active trick with follower card but missing leader card would crash getPlayableCards
    expect(
      isValidResumableGameState({
        ...initial,
        currentTrick: { leader: 0, cards: [null, { suit: 'hearts', rank: 'A' }] },
      }),
    ).toBe(false);
    // Completed trick missing winner or a card must be rejected
    expect(
      isValidResumableGameState({
        ...initial,
        tricks: [{ leader: 0, cards: [{ suit: 'hearts', rank: 'A' }, null] }],
      }),
    ).toBe(false);
  });

  it('saveHostGame returns false when storage throws', () => {
    const failingStorage = {
      ...createMemoryStorage(),
      setItem() {
        throw new Error('QuotaExceededError');
      },
    };
    expect(saveHostGame(createInitialState('quota-seed', 0), failingStorage)).toBe(false);
  });

  it('clearSavedGame removes the entry', () => {
    const storage = createMemoryStorage();
    saveHostGame(createInitialState('clear-seed', 0), storage);
    clearSavedGame(storage);
    expect(loadSavedGame(storage)).toBeNull();
  });

  it('formats phase descriptions and relative timestamps', () => {
    const initial = createInitialState('desc-seed', 0);
    expect(describeSavedPhase(initial)).toBe('Bidding');

    const playing = applyAction(initial, initial.currentPlayer, { type: 'bid-take' });
    expect(describeSavedPhase(playing)).toBe('Trick 1/16');

    expect(describeSavedPhase({ ...playing, phase: 'round-over' })).toBe('Between rounds');

    const now = 1_700_000_000_000;
    expect(formatSavedAt(now - 20_000, now)).toBe('Just now');
    expect(formatSavedAt(now - 12 * 60_000, now)).toBe('12m ago');
    expect(formatSavedAt(now - 3 * 3_600_000, now)).toBe('3h ago');
    expect(formatSavedAt(now - 2 * 86_400_000, now)).toBe('2d ago');
  });

  it('validates and hydrates legacy snapshots saved without options', () => {
    const storage = createMemoryStorage();
    const initial = createInitialState('legacy-seed', 0);
    const legacyState: Record<string, unknown> = { ...initial };
    delete legacyState.options;

    expect(isValidResumableGameState(legacyState)).toBe(true);

    storage.setItem(
      SAVED_GAME_STORAGE_KEY,
      JSON.stringify({ version: 1, savedAt: Date.now(), gameState: legacyState }),
    );
    const loaded = loadSavedGame(storage);
    expect(loaded).not.toBeNull();
    expect(loaded!.gameState.options).toEqual(DEFAULT_MATCH_OPTIONS);
  });

  it('round-trips custom match options and rejects malformed options', () => {
    const storage = createMemoryStorage();
    const custom = createInitialState('custom-opts-seed', 0, {
      targetScore: 500,
      capotEnabled: true,
    });
    saveHostGame(custom, storage);

    const loaded = loadSavedGame(storage);
    expect(loaded).not.toBeNull();
    expect(loaded!.gameState.options).toEqual({ targetScore: 500, capotEnabled: true });

    expect(
      isValidResumableGameState({
        ...custom,
        options: { targetScore: 750, capotEnabled: true },
      }),
    ).toBe(false);
    expect(
      isValidResumableGameState({
        ...custom,
        options: { targetScore: 500, capotEnabled: 'yes' },
      }),
    ).toBe(false);
  });
});

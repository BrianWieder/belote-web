import { describe, it, expect } from 'vitest';
import { createInitialState, applyAction } from '../../game/engine';
import { cardToString } from '../../game/types';
import { getPlayableCards } from '../../game/validation';
import {
  SAVED_GAME_STORAGE_KEY,
  clearSavedGame,
  describeSavedPhase,
  formatSavedAt,
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
    expect(isValidResumableGameState({ ...initial, seed: '' })).toBe(false);
    expect(isValidResumableGameState({ ...initial, hands: [initial.hands[0]] })).toBe(false);
    expect(isValidResumableGameState({ ...initial, roundScores: [{ bad: true }] })).toBe(false);
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
});

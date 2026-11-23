import { describe, it, expect, vi } from 'vitest';
import {
  PLAYER_NAME_STORAGE_KEY,
  MAX_PLAYER_NAME_LENGTH,
  sanitizePlayerName,
  loadPlayerName,
  savePlayerName,
} from '../playerName';

function createMemoryStorage(initial: Record<string, string> = {}): Storage {
  const data = new Map<string, string>(Object.entries(initial));
  return {
    get length() {
      return data.size;
    },
    clear() {
      data.clear();
    },
    getItem(key: string) {
      return data.has(key) ? data.get(key)! : null;
    },
    key(index: number) {
      return Array.from(data.keys())[index] ?? null;
    },
    removeItem(key: string) {
      data.delete(key);
    },
    setItem(key: string, value: string) {
      data.set(key, value);
    },
  };
}

describe('sanitizePlayerName', () => {
  it('returns empty string for non-string inputs', () => {
    expect(sanitizePlayerName(null)).toBe('');
    expect(sanitizePlayerName(undefined)).toBe('');
    expect(sanitizePlayerName(123)).toBe('');
    expect(sanitizePlayerName({})).toBe('');
  });

  it('trims surrounding whitespace and collapses control whitespace into spaces', () => {
    expect(sanitizePlayerName('  Jean-Luc  ')).toBe('Jean-Luc');
    expect(sanitizePlayerName('Jean\n\r\tLuc')).toBe('Jean Luc');
    expect(sanitizePlayerName('   \t\n  ')).toBe('');
  });

  it('truncates names exceeding MAX_PLAYER_NAME_LENGTH', () => {
    const longName = 'A'.repeat(MAX_PLAYER_NAME_LENGTH + 15);
    expect(sanitizePlayerName(longName)).toBe('A'.repeat(MAX_PLAYER_NAME_LENGTH));
  });
});

describe('loadPlayerName and savePlayerName', () => {
  it('returns empty string when storage is null or key is missing', () => {
    expect(loadPlayerName(null)).toBe('');
    expect(loadPlayerName(createMemoryStorage())).toBe('');
  });

  it('persists and loads a sanitized player name under PLAYER_NAME_STORAGE_KEY', () => {
    const storage = createMemoryStorage();
    const saved = savePlayerName('  Camille\nDupont  ', storage);
    expect(saved).toBe('Camille Dupont');
    expect(storage.getItem(PLAYER_NAME_STORAGE_KEY)).toBe('Camille Dupont');
    expect(loadPlayerName(storage)).toBe('Camille Dupont');
  });

  it('sanitizes malformed or oversized values already stored in storage', () => {
    const storage = createMemoryStorage({
      [PLAYER_NAME_STORAGE_KEY]: `  ${'X'.repeat(MAX_PLAYER_NAME_LENGTH + 5)}  `,
    });
    expect(loadPlayerName(storage)).toBe('X'.repeat(MAX_PLAYER_NAME_LENGTH));
  });

  it('removes the storage entry when saving an empty or whitespace-only name', () => {
    const storage = createMemoryStorage({
      [PLAYER_NAME_STORAGE_KEY]: 'Jean',
    });
    const saved = savePlayerName('   \t  ', storage);
    expect(saved).toBe('');
    expect(storage.getItem(PLAYER_NAME_STORAGE_KEY)).toBeNull();
  });

  it('returns sanitized value without throwing when storage is null', () => {
    expect(savePlayerName('  Henri  ', null)).toBe('Henri');
  });

  it('handles storage read/write exceptions gracefully', () => {
    const throwingStorage = {
      ...createMemoryStorage(),
      getItem: vi.fn(() => {
        throw new Error('SecurityError');
      }),
      setItem: vi.fn(() => {
        throw new Error('QuotaExceededError');
      }),
      removeItem: vi.fn(() => {
        throw new Error('SecurityError');
      }),
    } as Storage;

    expect(loadPlayerName(throwingStorage)).toBe('');
    expect(savePlayerName('Marcel', throwingStorage)).toBe('Marcel');
    expect(savePlayerName('   ', throwingStorage)).toBe('');
  });
});

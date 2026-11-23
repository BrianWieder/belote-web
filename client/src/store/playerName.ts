export const PLAYER_NAME_STORAGE_KEY = 'belote-web:player-name:v1';
export const MAX_PLAYER_NAME_LENGTH = 20;

export function sanitizePlayerName(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  return raw
    .replace(/[\r\n\t]+/g, ' ')
    .trim()
    .slice(0, MAX_PLAYER_NAME_LENGTH);
}

function getDefaultStorage(): Storage | null {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return null;
    return window.localStorage;
  } catch {
    return null;
  }
}

export function loadPlayerName(storage: Storage | null = getDefaultStorage()): string {
  if (!storage) return '';
  try {
    const raw = storage.getItem(PLAYER_NAME_STORAGE_KEY);
    return sanitizePlayerName(raw ?? '');
  } catch {
    return '';
  }
}

export function savePlayerName(
  name: string,
  storage: Storage | null = getDefaultStorage(),
): string {
  const sanitized = sanitizePlayerName(name);
  if (!storage) return sanitized;
  try {
    if (sanitized.length === 0) {
      storage.removeItem(PLAYER_NAME_STORAGE_KEY);
    } else {
      storage.setItem(PLAYER_NAME_STORAGE_KEY, sanitized);
    }
  } catch {
    // Ignore storage quota or private browsing errors
  }
  return sanitized;
}

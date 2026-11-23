export const TWO_TAP_PLAY_STORAGE_KEY = 'belote-web:two-tap-play:v1';

function getDefaultStorage(): Storage | null {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return null;
    return window.localStorage;
  } catch {
    return null;
  }
}

export function loadTwoTapPlay(storage: Storage | null = getDefaultStorage()): boolean {
  if (!storage) return false;
  try {
    return storage.getItem(TWO_TAP_PLAY_STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

export function saveTwoTapPlay(
  enabled: boolean,
  storage: Storage | null = getDefaultStorage(),
): boolean {
  if (!storage) return false;
  try {
    storage.setItem(TWO_TAP_PLAY_STORAGE_KEY, enabled ? 'true' : 'false');
    return true;
  } catch {
    // Ignore storage quota or private browsing errors
    return false;
  }
}

export type CardTapOutcome =
  | { kind: 'ignore' }
  | { kind: 'select'; cardKey: string }
  | { kind: 'play'; cardKey: string };

export function resolveCardTap(options: {
  cardKey: string;
  isPlayable: boolean;
  twoTapPlay: boolean;
  selectedCardKey: string | null;
}): CardTapOutcome {
  if (!options.isPlayable) {
    return { kind: 'ignore' };
  }
  if (!options.twoTapPlay) {
    return { kind: 'play', cardKey: options.cardKey };
  }
  if (options.selectedCardKey === options.cardKey) {
    return { kind: 'play', cardKey: options.cardKey };
  }
  return { kind: 'select', cardKey: options.cardKey };
}

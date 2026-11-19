import type { Card, GameState, Phase, PlayerID, Rank, Suit } from '../game/types';

export const SAVED_GAME_STORAGE_KEY = 'belote-web:saved-game:v1';

export interface SavedGameSnapshot {
  version: 1;
  savedAt: number;
  gameState: GameState;
}

const VALID_SUITS = new Set<Suit>(['hearts', 'diamonds', 'clubs', 'spades']);
const VALID_RANKS = new Set<Rank>(['7', '8', '9', '10', 'J', 'Q', 'K', 'A']);
const RESUMABLE_PHASES = new Set<Phase>([
  'bidding-round1',
  'bidding-round2',
  'bidding-forced',
  'playing',
  'round-over',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isPlayerID(value: unknown): value is PlayerID {
  return value === 0 || value === 1;
}

function isValidCard(value: unknown): value is Card {
  return (
    isRecord(value) &&
    typeof value.suit === 'string' &&
    VALID_SUITS.has(value.suit as Suit) &&
    typeof value.rank === 'string' &&
    VALID_RANKS.has(value.rank as Rank)
  );
}

function isCardArray(value: unknown): value is Card[] {
  return Array.isArray(value) && value.every(isValidCard);
}

function isValidTableauSlot(value: unknown): boolean {
  if (!isRecord(value)) return false;
  const faceDownOk = value.faceDown === null || isValidCard(value.faceDown);
  const faceUpOk = value.faceUp === null || isValidCard(value.faceUp);
  return faceDownOk && faceUpOk;
}

function isValidPlayerTableau(value: unknown): boolean {
  return Array.isArray(value) && value.length === 4 && value.every(isValidTableauSlot);
}

function isValidTrick(value: unknown): boolean {
  if (!isRecord(value)) return false;
  if (!isPlayerID(value.leader)) return false;
  if (value.winner !== undefined && !isPlayerID(value.winner)) return false;
  if (!Array.isArray(value.cards) || value.cards.length !== 2) return false;
  return value.cards.every((c) => c === null || isValidCard(c));
}

function isNumberPair(value: unknown): value is [number, number] {
  return (
    Array.isArray(value) &&
    value.length === 2 &&
    value.every((n) => typeof n === 'number' && Number.isFinite(n) && n >= 0)
  );
}

function isValidRoundScore(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return (
    isNumberPair(value.trickPoints) &&
    isNumberPair(value.beloteBonus) &&
    isNumberPair(value.lastTrickBonus) &&
    typeof value.dedans === 'boolean' &&
    isPlayerID(value.taker) &&
    typeof value.trumpSuit === 'string' &&
    VALID_SUITS.has(value.trumpSuit as Suit) &&
    isNumberPair(value.finalPoints)
  );
}

export function isValidResumableGameState(value: unknown): value is GameState {
  if (!isRecord(value)) return false;
  if (typeof value.phase !== 'string' || !RESUMABLE_PHASES.has(value.phase as Phase)) {
    return false;
  }
  if (typeof value.seed !== 'string' || value.seed.length === 0) return false;
  if (!isPlayerID(value.dealer) || !isPlayerID(value.currentPlayer)) return false;

  if (!Array.isArray(value.hands) || value.hands.length !== 2 || !value.hands.every(isCardArray)) {
    return false;
  }
  if (!isCardArray(value.deck)) return false;
  if (value.trumpCard !== null && !isValidCard(value.trumpCard)) return false;
  if (value.trumpSuit !== null && (typeof value.trumpSuit !== 'string' || !VALID_SUITS.has(value.trumpSuit as Suit))) {
    return false;
  }
  if (value.taker !== null && !isPlayerID(value.taker)) return false;
  if (value.biddingRound !== 1 && value.biddingRound !== 2) return false;
  if (typeof value.bidPasses !== 'number' || !Number.isInteger(value.bidPasses) || value.bidPasses < 0) {
    return false;
  }

  if (!Array.isArray(value.tricks) || !value.tricks.every(isValidTrick)) return false;
  if (!isValidTrick(value.currentTrick)) return false;
  if (
    !Array.isArray(value.tricksWon) ||
    value.tricksWon.length !== 2 ||
    !value.tricksWon.every(isCardArray)
  ) {
    return false;
  }
  if (
    !Array.isArray(value.tableau) ||
    value.tableau.length !== 2 ||
    !value.tableau.every(isValidPlayerTableau)
  ) {
    return false;
  }

  if (
    !Array.isArray(value.beloteDeclared) ||
    value.beloteDeclared.length !== 2 ||
    !value.beloteDeclared.every((v) => typeof v === 'boolean')
  ) {
    return false;
  }
  if (
    !Array.isArray(value.rebeloteDeclared) ||
    value.rebeloteDeclared.length !== 2 ||
    !value.rebeloteDeclared.every((v) => typeof v === 'boolean')
  ) {
    return false;
  }

  if (!Array.isArray(value.roundScores) || !value.roundScores.every(isValidRoundScore)) {
    return false;
  }
  if (!isNumberPair(value.gameScore)) {
    return false;
  }
  if (typeof value.sequenceNumber !== 'number' || !Number.isInteger(value.sequenceNumber) || value.sequenceNumber < 0) {
    return false;
  }

  return true;
}

function getDefaultStorage(): Storage | null {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return null;
    return window.localStorage;
  } catch {
    return null;
  }
}

export function saveHostGame(gameState: GameState, storage: Storage | null = getDefaultStorage()): void {
  if (!storage) return;
  if (gameState.phase === 'game-over') {
    clearSavedGame(storage);
    return;
  }
  try {
    const snapshot: SavedGameSnapshot = {
      version: 1,
      savedAt: Date.now(),
      gameState,
    };
    storage.setItem(SAVED_GAME_STORAGE_KEY, JSON.stringify(snapshot));
  } catch {
    // Ignore storage quota or private browsing errors
  }
}

export function loadSavedGame(storage: Storage | null = getDefaultStorage()): SavedGameSnapshot | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(SAVED_GAME_STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (
      !isRecord(parsed) ||
      parsed.version !== 1 ||
      typeof parsed.savedAt !== 'number' ||
      !Number.isFinite(parsed.savedAt) ||
      !isValidResumableGameState(parsed.gameState)
    ) {
      storage.removeItem(SAVED_GAME_STORAGE_KEY);
      return null;
    }
    return {
      version: 1,
      savedAt: parsed.savedAt,
      gameState: parsed.gameState,
    };
  } catch {
    try {
      storage.removeItem(SAVED_GAME_STORAGE_KEY);
    } catch {
      // Ignore cleanup errors
    }
    return null;
  }
}

export function clearSavedGame(storage: Storage | null = getDefaultStorage()): void {
  if (!storage) return;
  try {
    storage.removeItem(SAVED_GAME_STORAGE_KEY);
  } catch {
    // Ignore storage errors
  }
}

export function describeSavedPhase(gameState: GameState): string {
  switch (gameState.phase) {
    case 'bidding-round1':
    case 'bidding-round2':
    case 'bidding-forced':
      return 'Bidding';
    case 'playing':
      return `Trick ${Math.min(16, gameState.tricks.length + 1)}/16`;
    case 'round-over':
      return 'Between rounds';
    default:
      return '';
  }
}

export function formatSavedAt(savedAt: number, now: number = Date.now()): string {
  const diffMs = Math.max(0, now - savedAt);
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1) return 'Just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `${diffDays}d ago`;
  return new Date(savedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

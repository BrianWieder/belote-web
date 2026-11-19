import type { GameState, Phase, PlayerID, Suit } from '../game/types';

export interface TrumpAnnouncementInfo {
  suit: Suit;
  taker: PlayerID;
  round: number;
}

function isBiddingPhase(phase: Phase): boolean {
  return (
    phase === 'bidding-round1' ||
    phase === 'bidding-round2' ||
    phase === 'bidding-forced'
  );
}

/**
 * Returns announcement details when the game transitions from a bidding phase
 * into the start of the playing phase, and null otherwise (e.g. card plays or
 * resuming a saved game directly into 'playing').
 */
export function detectTrumpAnnouncement(
  prev: GameState | null,
  next: GameState | null,
): TrumpAnnouncementInfo | null {
  if (!prev || !next) return null;
  if (!isBiddingPhase(prev.phase) || next.phase !== 'playing') return null;
  if (!next.trumpSuit || next.taker === null) return null;
  if (next.tricks.length > 0) return null;

  return {
    suit: next.trumpSuit,
    taker: next.taker,
    round: next.roundScores.length + 1,
  };
}

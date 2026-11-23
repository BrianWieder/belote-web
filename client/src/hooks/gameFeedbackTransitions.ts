import type { GameState, Phase, PlayerID, Trick } from '../game/types';

export const DEFAULT_DOCUMENT_TITLE = 'Belote Maniée';
export const TURN_ALERT_DOCUMENT_TITLE = 'Your turn! — Belote Maniée';

export interface GameFeedbackEvents {
  deal: boolean;
  cardSnap: boolean;
  trickWin: { wonByLocal: boolean } | null;
  belote: boolean;
  turnPing: boolean;
}

const EMPTY_EVENTS: GameFeedbackEvents = {
  deal: false,
  cardSnap: false,
  trickWin: null,
  belote: false,
  turnPing: false,
};

export function isBiddingPhase(phase: Phase): boolean {
  return (
    phase === 'bidding-round1' ||
    phase === 'bidding-round2' ||
    phase === 'bidding-forced'
  );
}

export function isActiveTurnPhase(phase: Phase): boolean {
  return isBiddingPhase(phase) || phase === 'playing';
}

export function getTurnDocumentTitle(
  gameState: GameState | null,
  localPlayer: PlayerID,
  isDocumentHidden: boolean,
): string {
  if (
    isDocumentHidden &&
    gameState &&
    isActiveTurnPhase(gameState.phase) &&
    gameState.currentPlayer === localPlayer
  ) {
    return TURN_ALERT_DOCUMENT_TITLE;
  }
  return DEFAULT_DOCUMENT_TITLE;
}

function countTrickCards(trick: Trick): number {
  return (trick.cards[0] !== null ? 1 : 0) + (trick.cards[1] !== null ? 1 : 0);
}

function hasNewBeloteDeclaration(prev: GameState, next: GameState): boolean {
  for (const p of [0, 1] as const) {
    if (!prev.beloteDeclared[p] && next.beloteDeclared[p]) return true;
    if (!prev.rebeloteDeclared[p] && next.rebeloteDeclared[p]) return true;
  }
  return false;
}

/**
 * Pure transition detector that inspects two consecutive GameState snapshots
 * and determines which sound cues should fire for `localPlayer`.
 */
export function detectGameFeedbackEvents(
  prev: GameState | null,
  next: GameState | null,
  localPlayer: PlayerID,
): GameFeedbackEvents {
  if (!next || prev === next) {
    return { ...EMPTY_EVENTS };
  }

  // Freshly initialized game (not a hydrated mid-match resume).
  if (!prev || prev.seed !== next.seed) {
    const isFreshDeal =
      next.phase === 'bidding-round1' &&
      next.sequenceNumber === 0 &&
      next.roundScores.length === 0;
    return {
      ...EMPTY_EVENTS,
      deal: isFreshDeal,
    };
  }

  // Starting a new round from round-over (note: startNewRound preserves sequenceNumber).
  if (prev.phase === 'round-over' && next.phase === 'bidding-round1') {
    return {
      ...EMPTY_EVENTS,
      deal: true,
      turnPing: next.currentPlayer === localPlayer,
    };
  }

  // Only fire gameplay sounds for single-action increments; ignore full resync jumps or no-ops.
  if (next.sequenceNumber !== prev.sequenceNumber + 1) {
    return { ...EMPTY_EVENTS };
  }

  const deal =
    isBiddingPhase(prev.phase) &&
    next.phase === 'playing' &&
    next.tricks.length === 0;

  const trickCompleted =
    prev.phase === 'playing' &&
    next.tricks.length === prev.tricks.length + 1;

  const leadCardPlayed =
    prev.phase === 'playing' &&
    next.phase === 'playing' &&
    next.tricks.length === prev.tricks.length &&
    countTrickCards(next.currentTrick) > countTrickCards(prev.currentTrick);

  const cardSnap = trickCompleted || leadCardPlayed;

  const completedTrick = trickCompleted
    ? next.tricks[next.tricks.length - 1]
    : null;
  const trickWin =
    completedTrick && completedTrick.winner !== undefined
      ? { wonByLocal: completedTrick.winner === localPlayer }
      : null;

  const belote = hasNewBeloteDeclaration(prev, next);

  const wasMyTurn =
    isActiveTurnPhase(prev.phase) && prev.currentPlayer === localPlayer;
  const isMyTurn =
    isActiveTurnPhase(next.phase) && next.currentPlayer === localPlayer;

  // Suppress redundant turn ping when a trick-win chime already signaled the lead.
  const turnPing = !wasMyTurn && isMyTurn && trickWin === null;

  return {
    deal,
    cardSnap,
    trickWin,
    belote,
    turnPing,
  };
}

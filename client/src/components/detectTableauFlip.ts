import type { Card, PlayerTableau, TableauSlot } from '../game/types';
import { cardToString } from '../game/types';

function sameCard(a: Card | null, b: Card | null): boolean {
  if (!a || !b) return a === b;
  return a.suit === b.suit && a.rank === b.rank;
}

/**
 * Returns true when a tableau slot transitions from having both a buried
 * `faceDown` card and an exposed `faceUp` card to flipping that buried card
 * face-up (leaving `faceDown` empty and replacing `faceUp`).
 */
export function isSlotUncoveredFlip(
  prevSlot: TableauSlot | null | undefined,
  nextSlot: TableauSlot | null | undefined,
): boolean {
  if (!prevSlot || !nextSlot) return false;
  if (!prevSlot.faceDown || !prevSlot.faceUp) return false;
  if (nextSlot.faceDown !== null || !nextSlot.faceUp) return false;
  return !sameCard(prevSlot.faceUp, nextSlot.faceUp);
}

/**
 * Returns the slot indices (0..3) in a player's tableau where a buried
 * face-down card was just flipped face-up.
 */
export function detectUncoveredTableauSlots(
  prev: PlayerTableau | null | undefined,
  next: PlayerTableau | null | undefined,
): number[] {
  if (!prev || !next) return [];
  const flipped: number[] = [];
  for (let i = 0; i < next.length; i++) {
    if (isSlotUncoveredFlip(prev[i], next[i])) {
      flipped.push(i);
    }
  }
  return flipped;
}

/**
 * Returns the `cardToString` keys for any newly flipped face-up cards in a
 * player's tableau.
 */
export function getFlippedCardKeys(
  prev: PlayerTableau | null | undefined,
  next: PlayerTableau | null | undefined,
): string[] {
  if (!prev || !next) return [];
  const keys: string[] = [];
  for (let i = 0; i < next.length; i++) {
    const faceUp = next[i]?.faceUp;
    if (faceUp && isSlotUncoveredFlip(prev[i], next[i])) {
      keys.push(cardToString(faceUp));
    }
  }
  return keys;
}

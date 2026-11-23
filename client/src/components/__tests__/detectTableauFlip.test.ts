import { describe, it, expect } from 'vitest';
import { createInitialState, applyAction } from '../../game/engine';
import { cardToString } from '../../game/types';
import {
  detectUncoveredTableauSlots,
  getFlippedCardKeys,
  isSlotUncoveredFlip,
} from '../detectTableauFlip';

describe('detectTableauFlip', () => {
  it('detects the exact slot and card key when a buried tableau card flips face-up', () => {
    const initial = createInitialState('tableau-flip-seed', 0);
    const playing = applyAction(initial, initial.currentPlayer, { type: 'bid-take' });
    const leader = playing.currentPlayer;

    // Leader can lead any card, including slot 0's faceUp card.
    const slot0 = playing.tableau[leader][0];
    expect(slot0.faceUp).not.toBeNull();
    expect(slot0.faceDown).not.toBeNull();

    const afterPlay = applyAction(playing, leader, {
      type: 'play-card',
      card: cardToString(slot0.faceUp!),
    });

    expect(
      detectUncoveredTableauSlots(playing.tableau[leader], afterPlay.tableau[leader]),
    ).toEqual([0]);
    expect(
      getFlippedCardKeys(playing.tableau[leader], afterPlay.tableau[leader]),
    ).toEqual([cardToString(slot0.faceDown!)]);

    // Opponent's tableau did not change.
    const opponent = leader === 0 ? 1 : 0;
    expect(
      detectUncoveredTableauSlots(playing.tableau[opponent], afterPlay.tableau[opponent]),
    ).toEqual([]);
  });

  it('does not trigger on initial tableau deal from bidding to playing', () => {
    const initial = createInitialState('tableau-deal-seed', 0);
    const playing = applyAction(initial, initial.currentPlayer, { type: 'bid-take' });

    expect(detectUncoveredTableauSlots(initial.tableau[0], playing.tableau[0])).toEqual([]);
    expect(detectUncoveredTableauSlots(initial.tableau[1], playing.tableau[1])).toEqual([]);
  });

  it('does not trigger when playing a card from hand', () => {
    const initial = createInitialState('hand-play-seed', 0);
    const playing = applyAction(initial, initial.currentPlayer, { type: 'bid-take' });
    const leader = playing.currentPlayer;
    const handCard = playing.hands[leader][0];

    const afterHandPlay = applyAction(playing, leader, {
      type: 'play-card',
      card: cardToString(handCard),
    });

    expect(
      detectUncoveredTableauSlots(playing.tableau[leader], afterHandPlay.tableau[leader]),
    ).toEqual([]);
  });

  it('does not trigger when clearing the second (final) card of a tableau slot', () => {
    const prevSlot = { faceDown: null, faceUp: { suit: 'hearts' as const, rank: 'A' as const } };
    const nextSlot = { faceDown: null, faceUp: null };
    expect(isSlotUncoveredFlip(prevSlot, nextSlot)).toBe(false);
  });

  it('returns empty arrays safely for null or undefined tableaus', () => {
    expect(detectUncoveredTableauSlots(null, null)).toEqual([]);
    expect(getFlippedCardKeys(undefined, undefined)).toEqual([]);
  });
});

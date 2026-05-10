import { describe, it, expect } from 'vitest';
import { createInitialState, applyAction, startNewRound } from '../engine';
import { getPlayableCards } from '../validation';
import { cardToString } from '../types';
import type { GameState, PlayerID, Suit } from '../types';

describe('createInitialState', () => {
  it('deals 5 cards to each player', () => {
    const state = createInitialState('test', 0);
    expect(state.hands[0]).toHaveLength(5);
    expect(state.hands[1]).toHaveLength(5);
  });

  it('sets a trump card face up', () => {
    const state = createInitialState('test', 0);
    expect(state.trumpCard).not.toBeNull();
  });

  it('remaining deck has 21 cards', () => {
    const state = createInitialState('test', 0);
    // 32 - 5 - 5 - 1 (trump) = 21
    expect(state.deck).toHaveLength(21);
  });

  it('non-dealer is current player', () => {
    const state = createInitialState('test', 0);
    expect(state.currentPlayer).toBe(1);
  });

  it('is deterministic', () => {
    const a = createInitialState('seed123', 0);
    const b = createInitialState('seed123', 0);
    expect(a.hands).toEqual(b.hands);
    expect(a.trumpCard).toEqual(b.trumpCard);
    expect(a.deck).toEqual(b.deck);
  });

  it('starts in bidding-round1 phase', () => {
    const state = createInitialState('test', 0);
    expect(state.phase).toBe('bidding-round1');
  });

  it('initializes empty tableau for both players', () => {
    const state = createInitialState('test', 0);
    for (const playerTableau of state.tableau) {
      expect(playerTableau).toHaveLength(4);
      for (const slot of playerTableau) {
        expect(slot.faceDown).toBeNull();
        expect(slot.faceUp).toBeNull();
      }
    }
  });
});

describe('bidding', () => {
  it('take in round 1 gives trump card to taker, deals remaining and tableau', () => {
    const state = createInitialState('test', 0);
    const trumpCard = state.trumpCard!;
    const currentPlayer = state.currentPlayer;

    const next = applyAction(state, currentPlayer, { type: 'bid-take' });
    expect(next.phase).toBe('playing');
    expect(next.trumpSuit).toBe(trumpCard.suit);
    expect(next.taker).toBe(currentPlayer);
    expect(next.hands[0]).toHaveLength(8);
    expect(next.hands[1]).toHaveLength(8);
    // Trump card should be in taker's hand
    expect(next.hands[currentPlayer].some(
      c => c.suit === trumpCard.suit && c.rank === trumpCard.rank
    )).toBe(true);
    // Deck should be empty (all cards dealt to hands + tableau)
    expect(next.deck).toHaveLength(0);
    // All 8 tableau slots should be populated
    for (const playerTableau of next.tableau) {
      for (const slot of playerTableau) {
        expect(slot.faceDown).not.toBeNull();
        expect(slot.faceUp).not.toBeNull();
      }
    }
  });

  it('two passes move to round 2', () => {
    const state = createInitialState('test', 0);
    const p1 = state.currentPlayer;
    const p2 = p1 === 0 ? 1 : 0;

    let next = applyAction(state, p1, { type: 'bid-pass' });
    expect(next.phase).toBe('bidding-round1');

    next = applyAction(next, p2, { type: 'bid-pass' });
    expect(next.phase).toBe('bidding-round2');
    expect(next.biddingRound).toBe(2);
  });

  it('choosing suit in round 2 starts playing and deals tableau', () => {
    const state = createInitialState('test', 0);
    const p1 = state.currentPlayer;
    const p2 = p1 === 0 ? 1 : 0;
    const trumpCardSuit = state.trumpCard!.suit;

    // Pass round 1
    let next = applyAction(state, p1, { type: 'bid-pass' });
    next = applyAction(next, p2, { type: 'bid-pass' });

    // Choose a different suit
    const suits: Suit[] = ['hearts', 'diamonds', 'clubs', 'spades'];
    const chosenSuit = suits.find(s => s !== trumpCardSuit)!;

    next = applyAction(next, next.currentPlayer, { type: 'bid-choose', suit: chosenSuit });
    expect(next.phase).toBe('playing');
    expect(next.trumpSuit).toBe(chosenSuit);
    expect(next.hands[0]).toHaveLength(8);
    expect(next.hands[1]).toHaveLength(8);
    // Deck should be empty
    expect(next.deck).toHaveLength(0);
    // Tableau should be populated
    for (const playerTableau of next.tableau) {
      for (const slot of playerTableau) {
        expect(slot.faceDown).not.toBeNull();
        expect(slot.faceUp).not.toBeNull();
      }
    }
  });

  it('cannot choose same suit as trump card in round 2', () => {
    const state = createInitialState('test', 0);
    const p1 = state.currentPlayer;
    const p2 = p1 === 0 ? 1 : 0;
    const trumpCardSuit = state.trumpCard!.suit;

    let next = applyAction(state, p1, { type: 'bid-pass' });
    next = applyAction(next, p2, { type: 'bid-pass' });

    next = applyAction(next, next.currentPlayer, { type: 'bid-choose', suit: trumpCardSuit });
    // Should remain in bidding
    expect(next.phase).toBe('bidding-round2');
  });

  it('four passes force the non-dealer to take the bid', () => {
    const state = createInitialState('test', 0);
    const nonDealer: PlayerID = state.dealer === 0 ? 1 : 0;
    const trumpCard = state.trumpCard!;
    const p1 = state.currentPlayer;
    const p2 = p1 === 0 ? 1 : 0;

    // Round 1: both pass
    let next = applyAction(state, p1, { type: 'bid-pass' });
    next = applyAction(next, p2, { type: 'bid-pass' });

    // Round 2: both pass
    next = applyAction(next, next.currentPlayer, { type: 'bid-pass' });
    next = applyAction(next, next.currentPlayer, { type: 'bid-pass' });

    // Non-dealer is now forced to choose; cards and tableau are already out.
    expect(next.phase).toBe('bidding-forced');
    expect(next.currentPlayer).toBe(nonDealer);
    expect(next.taker).toBe(nonDealer);
    expect(next.hands[0]).toHaveLength(8);
    expect(next.hands[1]).toHaveLength(8);
    expect(next.trumpCard).toBeNull();
    expect(next.hands[nonDealer].some(
      c => c.suit === trumpCard.suit && c.rank === trumpCard.rank
    )).toBe(true);
    for (const playerTableau of next.tableau) {
      for (const slot of playerTableau) {
        expect(slot.faceDown).not.toBeNull();
        expect(slot.faceUp).not.toBeNull();
      }
    }
  });

  it('forced bid lets the non-dealer pick any of the four suits', () => {
    const state = createInitialState('test', 0);
    const nonDealer: PlayerID = state.dealer === 0 ? 1 : 0;
    const trumpCardSuit = state.trumpCard!.suit;
    const p1 = state.currentPlayer;
    const p2 = p1 === 0 ? 1 : 0;

    let next = applyAction(state, p1, { type: 'bid-pass' });
    next = applyAction(next, p2, { type: 'bid-pass' });
    next = applyAction(next, next.currentPlayer, { type: 'bid-pass' });
    next = applyAction(next, next.currentPlayer, { type: 'bid-pass' });

    // Non-dealer can pick the original trump card's suit (any suit allowed)
    next = applyAction(next, nonDealer, { type: 'bid-choose', suit: trumpCardSuit });
    expect(next.phase).toBe('playing');
    expect(next.trumpSuit).toBe(trumpCardSuit);
    expect(next.taker).toBe(nonDealer);
    expect(next.currentPlayer).toBe(nonDealer);
  });

  it('forced bid ignores choose action from the dealer', () => {
    const state = createInitialState('test', 0);
    const dealer = state.dealer;
    const p1 = state.currentPlayer;
    const p2 = p1 === 0 ? 1 : 0;

    let next = applyAction(state, p1, { type: 'bid-pass' });
    next = applyAction(next, p2, { type: 'bid-pass' });
    next = applyAction(next, next.currentPlayer, { type: 'bid-pass' });
    next = applyAction(next, next.currentPlayer, { type: 'bid-pass' });

    next = applyAction(next, dealer, { type: 'bid-choose', suit: 'hearts' });
    expect(next.phase).toBe('bidding-forced');
    expect(next.trumpSuit).toBeNull();
  });
});

describe('playing', () => {
  function setupPlayingState(seed = 'play-test'): GameState {
    const state = createInitialState(seed, 0);
    return applyAction(state, state.currentPlayer, { type: 'bid-take' });
  }

  it('non-dealer leads the first trick', () => {
    const state = setupPlayingState();
    expect(state.currentPlayer).toBe(1); // non-dealer
  });

  it('playing a card removes it from hand', () => {
    const state = setupPlayingState();
    const player = state.currentPlayer;
    const card = state.hands[player][0];

    const next = applyAction(state, player, { type: 'play-card', card: cardToString(card) });
    expect(next.hands[player]).toHaveLength(7);
  });

  it('completing a trick determines winner and starts new trick', () => {
    const state = setupPlayingState();
    const p1 = state.currentPlayer;
    const p2: PlayerID = p1 === 0 ? 1 : 0;

    const playable1 = getPlayableCards(state);
    let next = applyAction(state, p1, { type: 'play-card', card: cardToString(playable1[0]) });

    const playable2 = getPlayableCards(next);
    next = applyAction(next, p2, { type: 'play-card', card: cardToString(playable2[0]) });

    expect(next.tricks).toHaveLength(1);
    expect(next.tricks[0].winner).toBeDefined();
  });

  it('sixteen tricks ends the round', () => {
    let state = setupPlayingState('full-round');

    // Play 16 tricks
    for (let trick = 0; trick < 16; trick++) {
      for (let play = 0; play < 2; play++) {
        const player = state.currentPlayer;
        const playable = getPlayableCards(state);
        state = applyAction(state, player, { type: 'play-card', card: cardToString(playable[0]) });
      }
    }

    expect(state.phase).toBe('round-over');
    expect(state.roundScores.length).toBeGreaterThan(0);
  });

  it('playing a tableau card flips faceDown to faceUp', () => {
    const state = setupPlayingState('tableau-flip-test');
    const player = state.currentPlayer;

    // Find a tableau slot with both faceDown and faceUp
    const slot = state.tableau[player].find(s => s.faceDown && s.faceUp);
    expect(slot).toBeDefined();

    const faceUpCard = slot!.faceUp!;
    const faceDownCard = slot!.faceDown!;
    const slotIdx = state.tableau[player].indexOf(slot!);

    // Play the face-up tableau card (need to make sure it's playable - leader can play anything)
    // If it's not the leader, we need to set up the state properly
    // Leader can play any card, so this should work
    const next = applyAction(state, player, { type: 'play-card', card: cardToString(faceUpCard) });

    // The face-down card should now be face-up
    expect(next.tableau[player][slotIdx].faceUp).toEqual(faceDownCard);
    expect(next.tableau[player][slotIdx].faceDown).toBeNull();
  });

  it('playing a tableau card with no faceDown leaves slot empty', () => {
    // Use structuredClone to set up a state where a tableau slot has faceUp but no faceDown
    const state = setupPlayingState('tableau-empty-slot');
    const player = state.currentPlayer;

    // Manually set up a slot with only faceUp (simulating after first flip)
    const modified = structuredClone(state);
    const card = modified.tableau[player][0].faceUp!;
    modified.tableau[player][0].faceDown = null; // no face-down card

    const next = applyAction(modified, player, { type: 'play-card', card: cardToString(card) });
    // Both should now be null
    expect(next.tableau[player][0].faceUp).toBeNull();
    expect(next.tableau[player][0].faceDown).toBeNull();
  });
});

describe('validation', () => {
  it('leader can play any card (hand + tableau)', () => {
    const state = createInitialState('test', 0);
    const next = applyAction(state, state.currentPlayer, { type: 'bid-take' });
    const playable = getPlayableCards(next);
    // 8 hand cards + 4 face-up tableau cards = 12
    expect(playable).toHaveLength(12);
  });

  it('getPlayableCards includes face-up tableau cards', () => {
    const state = createInitialState('tableau-playable', 0);
    const next = applyAction(state, state.currentPlayer, { type: 'bid-take' });
    const player = next.currentPlayer;
    const playable = getPlayableCards(next);

    // Verify tableau face-up cards are included
    const tableauFaceUp = next.tableau[player]
      .map(s => s.faceUp)
      .filter(c => c !== null);

    for (const card of tableauFaceUp) {
      expect(playable.some(p => p.suit === card!.suit && p.rank === card!.rank)).toBe(true);
    }
  });
});

describe('startNewRound', () => {
  it('resets for a new round with swapped dealer', () => {
    let state = createInitialState('test', 0);
    state = applyAction(state, state.currentPlayer, { type: 'bid-take' });

    // Play full round (16 tricks)
    for (let trick = 0; trick < 16; trick++) {
      for (let play = 0; play < 2; play++) {
        const playable = getPlayableCards(state);
        state = applyAction(state, state.currentPlayer, { type: 'play-card', card: cardToString(playable[0]) });
      }
    }

    const newRound = startNewRound(state);
    expect(newRound.phase).toBe('bidding-round1');
    expect(newRound.dealer).toBe(1); // swapped
    expect(newRound.hands[0]).toHaveLength(5);
    expect(newRound.hands[1]).toHaveLength(5);
    expect(newRound.gameScore).toEqual(state.gameScore); // preserved
    // Tableau should be reset
    for (const playerTableau of newRound.tableau) {
      for (const slot of playerTableau) {
        expect(slot.faceDown).toBeNull();
        expect(slot.faceUp).toBeNull();
      }
    }
  });
});

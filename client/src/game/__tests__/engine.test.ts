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
});

describe('bidding', () => {
  it('take in round 1 gives trump card to taker and deals remaining', () => {
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

  it('choosing suit in round 2 starts playing', () => {
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

  it('four passes cause a redeal', () => {
    const state = createInitialState('test', 0);
    const p1 = state.currentPlayer;
    const p2 = p1 === 0 ? 1 : 0;

    // Round 1: both pass
    let next = applyAction(state, p1, { type: 'bid-pass' });
    next = applyAction(next, p2, { type: 'bid-pass' });

    // Round 2: both pass
    next = applyAction(next, next.currentPlayer, { type: 'bid-pass' });
    next = applyAction(next, next.currentPlayer, { type: 'bid-pass' });

    // Should be back to round 1 with new deal
    expect(next.phase).toBe('bidding-round1');
    expect(next.hands[0]).toHaveLength(5);
    expect(next.hands[1]).toHaveLength(5);
    expect(next.trumpCard).not.toBeNull();
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

  it('eight tricks ends the round', () => {
    let state = setupPlayingState('full-round');

    // Play 8 tricks
    for (let trick = 0; trick < 8; trick++) {
      for (let play = 0; play < 2; play++) {
        const player = state.currentPlayer;
        const playable = getPlayableCards(state);
        state = applyAction(state, player, { type: 'play-card', card: cardToString(playable[0]) });
      }
    }

    expect(state.phase).toBe('round-over');
    expect(state.roundScores.length).toBeGreaterThan(0);
  });
});

describe('validation', () => {
  it('leader can play any card', () => {
    const state = createInitialState('test', 0);
    const next = applyAction(state, state.currentPlayer, { type: 'bid-take' });
    const playable = getPlayableCards(next);
    expect(playable).toHaveLength(8);
  });
});

describe('startNewRound', () => {
  it('resets for a new round with swapped dealer', () => {
    let state = createInitialState('test', 0);
    state = applyAction(state, state.currentPlayer, { type: 'bid-take' });

    // Play full round
    for (let trick = 0; trick < 8; trick++) {
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
  });
});

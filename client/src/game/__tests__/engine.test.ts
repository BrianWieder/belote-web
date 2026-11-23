import { describe, it, expect } from 'vitest';
import { createInitialState, applyAction, startNewRound } from '../engine';
import { createDeck } from '../deck';
import { getPlayableCards } from '../validation';
import { cardToString, DEFAULT_MATCH_OPTIONS } from '../types';
import type { GameState, PlayerID, Suit, Card, PlayerTableau } from '../types';

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

  it('non-dealer cannot pass in round 1 when trump card is a Jack', () => {
    const state = createInitialState('test', 0);
    state.trumpCard = { suit: 'hearts', rank: 'J' };
    const nonDealer = state.currentPlayer;

    const next = applyAction(state, nonDealer, { type: 'bid-pass' });
    expect(next.phase).toBe('bidding-round1');
    expect(next.bidPasses).toBe(0);
    expect(next.currentPlayer).toBe(nonDealer);
  });

  it('non-dealer can still take in round 1 when trump card is a Jack', () => {
    const state = createInitialState('test', 0);
    state.trumpCard = { suit: 'hearts', rank: 'J' };
    const nonDealer = state.currentPlayer;

    const next = applyAction(state, nonDealer, { type: 'bid-take' });
    expect(next.phase).toBe('playing');
    expect(next.trumpSuit).toBe('hearts');
    expect(next.taker).toBe(nonDealer);
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

  it('four passes give the non-dealer the turned-up card and 2 from the deck before choosing trump', () => {
    const state = createInitialState('test', 0);
    const dealer = state.dealer;
    const nonDealer: PlayerID = dealer === 0 ? 1 : 0;
    const trumpCard = state.trumpCard!;
    const expectedExtraTwo = state.deck.slice(0, 2);
    const p1 = state.currentPlayer;
    const p2 = p1 === 0 ? 1 : 0;

    // Round 1: both pass
    let next = applyAction(state, p1, { type: 'bid-pass' });
    next = applyAction(next, p2, { type: 'bid-pass' });

    // Round 2: both pass
    next = applyAction(next, next.currentPlayer, { type: 'bid-pass' });
    next = applyAction(next, next.currentPlayer, { type: 'bid-pass' });

    // Non-dealer sees their full 8-card hand (original 5 + turned-up card + 2 from deck)
    // before choosing trump; dealer still has 5 cards and tableau is not yet dealt.
    expect(next.phase).toBe('bidding-forced');
    expect(next.currentPlayer).toBe(nonDealer);
    expect(next.taker).toBe(nonDealer);
    expect(next.trumpCard).toBeNull();
    expect(next.hands[nonDealer]).toHaveLength(8);
    expect(next.hands[dealer]).toHaveLength(5);
    expect(next.deck).toHaveLength(19);
    for (const card of [trumpCard, ...expectedExtraTwo]) {
      expect(next.hands[nonDealer].some(
        c => c.suit === card.suit && c.rank === card.rank
      )).toBe(true);
    }
    for (const playerTableau of next.tableau) {
      for (const slot of playerTableau) {
        expect(slot.faceDown).toBeNull();
        expect(slot.faceUp).toBeNull();
      }
    }
  });

  it('forced bid lets the non-dealer pick any suit, then deals dealer remaining cards and tableau', () => {
    const state = createInitialState('test', 0);
    const dealer = state.dealer;
    const nonDealer: PlayerID = dealer === 0 ? 1 : 0;
    const trumpCard = state.trumpCard!;
    const expectedExtraTwo = state.deck.slice(0, 2);
    const expectedDealerThree = state.deck.slice(2, 5);
    const otherSuit: Suit = trumpCard.suit === 'hearts' ? 'spades' : 'hearts';
    const p1 = state.currentPlayer;
    const p2 = p1 === 0 ? 1 : 0;

    let forcedState = applyAction(state, p1, { type: 'bid-pass' });
    forcedState = applyAction(forcedState, p2, { type: 'bid-pass' });
    forcedState = applyAction(forcedState, forcedState.currentPlayer, { type: 'bid-pass' });
    forcedState = applyAction(forcedState, forcedState.currentPlayer, { type: 'bid-pass' });

    for (const chosenSuit of [trumpCard.suit, otherSuit]) {
      const next = applyAction(forcedState, nonDealer, { type: 'bid-choose', suit: chosenSuit });
      expect(next.phase).toBe('playing');
      expect(next.trumpSuit).toBe(chosenSuit);
      expect(next.taker).toBe(nonDealer);
      expect(next.currentPlayer).toBe(nonDealer);
      expect(next.trumpCard).toBeNull();
      expect(next.hands[0]).toHaveLength(8);
      expect(next.hands[1]).toHaveLength(8);
      expect(next.deck).toHaveLength(0);
      for (const card of [trumpCard, ...expectedExtraTwo]) {
        expect(next.hands[nonDealer].some(
          c => c.suit === card.suit && c.rank === card.rank
        )).toBe(true);
      }
      for (const card of expectedDealerThree) {
        expect(next.hands[dealer].some(
          c => c.suit === card.suit && c.rank === card.rank
        )).toBe(true);
      }
      const allDealtCards = [
        ...next.hands[0],
        ...next.hands[1],
        ...next.tableau.flatMap(t => t.flatMap(s => [s.faceDown!, s.faceUp!])),
      ];
      expect(new Set(allDealtCards.map(cardToString)).size).toBe(32);
      for (const playerTableau of next.tableau) {
        for (const slot of playerTableau) {
          expect(slot.faceDown).not.toBeNull();
          expect(slot.faceUp).not.toBeNull();
        }
      }
    }
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
    expect(newRound.sequenceNumber).toBe(state.sequenceNumber + 1);
    // Tableau should be reset
    for (const playerTableau of newRound.tableau) {
      for (const slot of playerTableau) {
        expect(slot.faceDown).toBeNull();
        expect(slot.faceUp).toBeNull();
      }
    }
  });
});

describe('belote', () => {
  const c = (rank: Card['rank'], suit: Suit): Card => ({ rank, suit });
  const EMPTY_TABLEAU: PlayerTableau = [
    { faceDown: null, faceUp: null },
    { faceDown: null, faceUp: null },
    { faceDown: null, faceUp: null },
    { faceDown: null, faceUp: null },
  ];

  // Player 1 (non-dealer) with spades as trump and a hand we control.
  function beloteState(player1Hand: Card[]): GameState {
    const state = createInitialState('belote-test', 0);
    const playing = applyAction(state, state.currentPlayer, { type: 'bid-take' });
    const s = structuredClone(playing);
    s.trumpSuit = 'spades';
    s.hands[1] = player1Hand;
    s.hands[0] = [
      c('7', 'hearts'), c('8', 'hearts'), c('9', 'hearts'),
      c('10', 'hearts'), c('J', 'hearts'), c('A', 'diamonds'),
      c('7', 'diamonds'), c('8', 'diamonds'),
    ];
    s.tableau = [EMPTY_TABLEAU, EMPTY_TABLEAU];
    s.currentTrick = { cards: [null, null], leader: 1 };
    s.currentPlayer = 1;
    return s;
  }

  it('declares belote on the first card and rebelote on the second', () => {
    let state = beloteState([
      c('K', 'spades'), c('Q', 'spades'),
      c('A', 'hearts'), c('10', 'hearts'), c('9', 'hearts'),
      c('8', 'hearts'), c('7', 'hearts'), c('A', 'diamonds'),
    ]);

    // Player 1 leads K of trump with the full pair in hand -> belote.
    state = applyAction(state, 1, { type: 'play-card', card: 'K_spades' });
    expect(state.beloteDeclared[1]).toBe(true);
    expect(state.rebeloteDeclared[1]).toBe(false);

    // Player 0 follows (no spades -> can play anything).
    const playable0 = getPlayableCards(state);
    state = applyAction(state, 0, { type: 'play-card', card: cardToString(playable0[0]) });

    // Player 1 wins the trick (trump beats non-trump) and leads Q -> rebelote.
    expect(state.currentPlayer).toBe(1);
    state = applyAction(state, 1, { type: 'play-card', card: 'Q_spades' });
    expect(state.beloteDeclared[1]).toBe(true);
    expect(state.rebeloteDeclared[1]).toBe(true);
  });

  it('does not declare belote when only one card of the pair is held', () => {
    const state = beloteState([
      c('K', 'spades'), c('A', 'clubs'),
      c('A', 'hearts'), c('10', 'hearts'), c('9', 'hearts'),
      c('8', 'hearts'), c('7', 'hearts'), c('A', 'diamonds'),
    ]);

    const next = applyAction(state, 1, { type: 'play-card', card: 'K_spades' });
    expect(next.beloteDeclared[1]).toBe(false);
    expect(next.rebeloteDeclared[1]).toBe(false);
  });

  it('does not declare rebelote without a prior belote', () => {
    // Only the Q is in hand; the K was never possessed.
    const state = beloteState([
      c('Q', 'spades'), c('A', 'clubs'),
      c('A', 'hearts'), c('10', 'hearts'), c('9', 'hearts'),
      c('8', 'hearts'), c('7', 'hearts'), c('A', 'diamonds'),
    ]);

    const next = applyAction(state, 1, { type: 'play-card', card: 'Q_spades' });
    expect(next.beloteDeclared[1]).toBe(false);
    expect(next.rebeloteDeclared[1]).toBe(false);
  });

  it('does not declare belote or rebelote when the second card is still face-down when the first is played', () => {
    let state = beloteState([
      c('A', 'hearts'), c('10', 'hearts'), c('9', 'hearts'),
      c('8', 'hearts'), c('7', 'hearts'), c('A', 'diamonds'),
    ]);
    state.tableau[1] = [
      { faceDown: c('Q', 'spades'), faceUp: c('K', 'spades') },
      { faceDown: null, faceUp: null },
      { faceDown: null, faceUp: null },
      { faceDown: null, faceUp: null },
    ];

    // Playing K while Q is unseen (face-down underneath) cannot declare belote.
    state = applyAction(state, 1, { type: 'play-card', card: 'K_spades' });
    expect(state.beloteDeclared[1]).toBe(false);
    expect(state.rebeloteDeclared[1]).toBe(false);
    expect(state.tableau[1][0].faceUp).toEqual(c('Q', 'spades'));

    const playable0 = getPlayableCards(state);
    state = applyAction(state, 0, { type: 'play-card', card: cardToString(playable0[0]) });

    // Even after Q flips face-up and is played next trick, rebelote is not declared.
    expect(state.currentPlayer).toBe(1);
    state = applyAction(state, 1, { type: 'play-card', card: 'Q_spades' });
    expect(state.beloteDeclared[1]).toBe(false);
    expect(state.rebeloteDeclared[1]).toBe(false);
  });

  it('declares belote and rebelote if a face-down pair card is uncovered before the first is played', () => {
    let state = beloteState([
      c('K', 'spades'), c('10', 'hearts'), c('9', 'hearts'),
      c('8', 'hearts'), c('7', 'hearts'), c('A', 'diamonds'),
    ]);
    state.tableau[1] = [
      { faceDown: c('Q', 'spades'), faceUp: c('A', 'clubs') },
      { faceDown: null, faceUp: null },
      { faceDown: null, faceUp: null },
      { faceDown: null, faceUp: null },
    ];

    // Trick 1: Play A_clubs to uncover Q_spades first (player 0 has no clubs/spades, so player 1 wins).
    state = applyAction(state, 1, { type: 'play-card', card: 'A_clubs' });
    expect(state.tableau[1][0].faceUp).toEqual(c('Q', 'spades'));
    let playable0 = getPlayableCards(state);
    state = applyAction(state, 0, { type: 'play-card', card: cardToString(playable0[0]) });
    expect(state.currentPlayer).toBe(1);

    // Trick 2: Now both K_spades and Q_spades are visible -> playing K_spades declares belote.
    state = applyAction(state, 1, { type: 'play-card', card: 'K_spades' });
    expect(state.beloteDeclared[1]).toBe(true);
    expect(state.rebeloteDeclared[1]).toBe(false);
    playable0 = getPlayableCards(state);
    state = applyAction(state, 0, { type: 'play-card', card: cardToString(playable0[0]) });

    // Trick 3: Playing Q_spades declares rebelote.
    expect(state.currentPlayer).toBe(1);
    state = applyAction(state, 1, { type: 'play-card', card: 'Q_spades' });
    expect(state.beloteDeclared[1]).toBe(true);
    expect(state.rebeloteDeclared[1]).toBe(true);
  });
});

describe('match options (targetScore & capot)', () => {
  const c = (rank: Card['rank'], suit: Suit): Card => ({ rank, suit });
  const EMPTY_TABLEAU: PlayerTableau = [
    { faceDown: null, faceUp: null },
    { faceDown: null, faceUp: null },
    { faceDown: null, faceUp: null },
    { faceDown: null, faceUp: null },
  ];

  function playFinalTrick(
    options: Partial<{ targetScore: 500 | 1000 | 1500; capotEnabled: boolean }>,
    initialGameScore: [number, number],
    sweepAllByPlayer1 = false,
  ): GameState {
    const initial = createInitialState('options-test', 0, options);
    const playing = applyAction(initial, initial.currentPlayer, { type: 'bid-take' });
    const s = structuredClone(playing);
    s.trumpSuit = 'hearts';
    s.taker = 1;
    s.gameScore = [...initialGameScore];
    s.tableau = [EMPTY_TABLEAU, EMPTY_TABLEAU];
    s.hands[1] = [c('J', 'hearts')];
    s.hands[0] = [c('7', 'spades')];
    s.currentTrick = { cards: [null, null], leader: 1 };
    s.currentPlayer = 1;

    const remaining30 = createDeck().filter(
      (card) =>
        !(card.suit === 'hearts' && card.rank === 'J') &&
        !(card.suit === 'spades' && card.rank === '7'),
    );

    // Populate 15 completed tricks so playing this trick finishes the round (trick 16).
    s.tricks = Array.from({ length: 15 }, (_, idx) => ({
      cards: [remaining30[idx * 2], remaining30[idx * 2 + 1]] as [Card, Card],
      leader: 1 as PlayerID,
      winner: (sweepAllByPlayer1 || idx > 0 ? 1 : 0) as PlayerID,
    }));
    s.tricksWon = sweepAllByPlayer1
      ? [[], [...remaining30]]
      : [remaining30.slice(0, 2), remaining30.slice(2)];

    let next = applyAction(s, 1, { type: 'play-card', card: 'J_hearts' });
    next = applyAction(next, 0, { type: 'play-card', card: '7_spades' });
    return next;
  }

  it('defaults to targetScore 1000 and capotEnabled false', () => {
    const state = createInitialState('defaults-test', 0);
    expect(state.options).toEqual(DEFAULT_MATCH_OPTIONS);
  });

  it('preserves custom options across startNewRound', () => {
    const state = createInitialState('preserve-options', 0, {
      targetScore: 1500,
      capotEnabled: true,
    });
    const nextRound = startNewRound(state);
    expect(nextRound.options).toEqual({ targetScore: 1500, capotEnabled: true });
  });

  it('ends the match at custom targetScore 500', () => {
    const finished = playFinalTrick({ targetScore: 500 }, [0, 420]);
    expect(finished.phase).toBe('game-over');
    expect(finished.gameScore[1]).toBeGreaterThanOrEqual(500);
  });

  it('continues past 1000 when targetScore is 1500 and ends once 1500 is reached', () => {
    const midMatch = playFinalTrick({ targetScore: 1500 }, [0, 950]);
    expect(midMatch.phase).toBe('round-over');
    expect(midMatch.gameScore[1]).toBeGreaterThan(1000);
    expect(midMatch.gameScore[1]).toBeLessThan(1500);

    const finished = playFinalTrick({ targetScore: 1500 }, [0, 1400]);
    expect(finished.phase).toBe('game-over');
    expect(finished.gameScore[1]).toBeGreaterThanOrEqual(1500);
  });

  it('applies 252-point capot in endRound only when capotEnabled is true', () => {
    const withCapot = playFinalTrick({ targetScore: 1000, capotEnabled: true }, [0, 0], true);
    expect(withCapot.phase).toBe('round-over');
    expect(withCapot.roundScores[0].capot).toBe(true);
    expect(withCapot.roundScores[0].finalPoints).toEqual([0, 252]);
    expect(withCapot.gameScore).toEqual([0, 252]);

    const withoutCapot = playFinalTrick({ targetScore: 1000, capotEnabled: false }, [0, 0], true);
    expect(withoutCapot.phase).toBe('round-over');
    expect(withoutCapot.roundScores[0].capot).toBe(false);
    expect(withoutCapot.roundScores[0].finalPoints).toEqual([0, 162]);
    expect(withoutCapot.gameScore).toEqual([0, 162]);
  });
});

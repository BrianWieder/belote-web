import type { Card, PlayerID, GameState, GameAction, Suit, Trick, PlayerTableau, Rank } from './types';
import { stringToCard } from './types';
import { createDeck, shuffleDeck } from './deck';
import { trickWinner, calculateRoundScore } from './scoring';
import { isCardPlayable, isBeloteCard, hasBelotePair } from './validation';

const GAME_TARGET = 1000;

function otherPlayer(p: PlayerID): PlayerID {
  return p === 0 ? 1 : 0;
}

function emptyTrick(leader: PlayerID): Trick {
  return { cards: [null, null], leader };
}

function emptyTableau(): PlayerTableau {
  return [
    { faceDown: null, faceUp: null },
    { faceDown: null, faceUp: null },
    { faceDown: null, faceUp: null },
    { faceDown: null, faceUp: null },
  ];
}

function dealTableau(state: GameState): void {
  const deck = state.deck;
  // Deal face-down cards: alternate p0/p1 for each slot
  for (let slot = 0; slot < 4; slot++) {
    state.tableau[0][slot].faceDown = deck.splice(0, 1)[0];
    state.tableau[1][slot].faceDown = deck.splice(0, 1)[0];
  }
  // Deal face-up cards on top: alternate p0/p1 for each slot
  for (let slot = 0; slot < 4; slot++) {
    state.tableau[0][slot].faceUp = deck.splice(0, 1)[0];
    state.tableau[1][slot].faceUp = deck.splice(0, 1)[0];
  }
}

export function createInitialState(seed: string, dealer: PlayerID): GameState {
  const state: GameState = {
    phase: 'bidding-round1',
    seed,
    dealer,
    hands: [[], []],
    deck: [],
    trumpCard: null,
    trumpSuit: null,
    taker: null,
    currentPlayer: otherPlayer(dealer),
    biddingRound: 1,
    bidPasses: 0,
    tricks: [],
    currentTrick: emptyTrick(otherPlayer(dealer)),
    tricksWon: [[], []],
    tableau: [emptyTableau(), emptyTableau()],
    beloteDeclared: [false, false],
    rebeloteDeclared: [false, false],
    roundScores: [],
    gameScore: [0, 0],
    sequenceNumber: 0,
  };

  dealCards(state);
  return state;
}

function dealCards(state: GameState): void {
  const roundNumber = state.roundScores.length;
  const deck = shuffleDeck(createDeck(), state.seed, roundNumber);

  const nonDealer = otherPlayer(state.dealer);

  // Deal 3 to each, then 2 to each
  state.hands[nonDealer] = deck.splice(0, 3);
  state.hands[state.dealer] = deck.splice(0, 3);
  state.hands[nonDealer].push(...deck.splice(0, 2));
  state.hands[state.dealer].push(...deck.splice(0, 2));

  // Turn up card for bidding
  state.trumpCard = deck.splice(0, 1)[0];
  state.deck = deck;
}

function dealRemainingCards(state: GameState): void {
  const deck = [...state.deck];
  const nonDealer = otherPlayer(state.dealer);

  // Each player needs to end up with 8 cards total
  // Deal enough to bring each player to 8
  const need0 = 8 - state.hands[0].length;
  const need1 = 8 - state.hands[1].length;

  state.hands[nonDealer].push(...deck.splice(0, nonDealer === 0 ? need0 : need1));
  state.hands[state.dealer].push(...deck.splice(0, state.dealer === 0 ? need0 : need1));

  state.deck = deck;
}

export function applyAction(state: GameState, player: PlayerID, action: GameAction): GameState {
  const next = structuredClone(state);

  switch (action.type) {
    case 'bid-take':
      return handleBidTake(next, player);
    case 'bid-pass':
      return handleBidPass(next, player);
    case 'bid-choose':
      return handleBidChoose(next, player, action.suit);
    case 'play-card':
      return handlePlayCard(next, player, action.card);
    default:
      return next;
  }
}

function handleBidTake(state: GameState, player: PlayerID): GameState {
  if (state.phase !== 'bidding-round1' || state.currentPlayer !== player) return state;

  state.taker = player;
  state.trumpSuit = state.trumpCard!.suit;

  // Give trump card to taker
  state.hands[player].push(state.trumpCard!);
  state.trumpCard = null;

  // Deal remaining 3 cards to each
  dealRemainingCards(state);
  dealTableau(state);

  state.phase = 'playing';
  state.currentPlayer = otherPlayer(state.dealer);
  state.currentTrick = emptyTrick(otherPlayer(state.dealer));

  state.sequenceNumber++;
  return state;
}

function handleBidPass(state: GameState, player: PlayerID): GameState {
  if (state.currentPlayer !== player) return state;
  if (state.phase !== 'bidding-round1' && state.phase !== 'bidding-round2') return state;

  // Jack turned up: non-dealer is forced to take, so passes are rejected in round 1.
  if (state.phase === 'bidding-round1' && state.trumpCard?.rank === 'J') return state;

  state.bidPasses++;
  state.currentPlayer = otherPlayer(player);

  if (state.phase === 'bidding-round1') {
    if (state.bidPasses >= 2) {
      // Both passed in round 1, go to round 2
      state.phase = 'bidding-round2';
      state.biddingRound = 2;
      state.bidPasses = 0;
      state.currentPlayer = otherPlayer(state.dealer);
    }
  } else {
    // bidding-round2
    if (state.bidPasses >= 2) {
      // Both passed in round 2 - the non-dealer is forced to take the bid
      // and choose any suit while seeing only their original 5 cards and
      // the turned-up proposal card.
      const forced = otherPlayer(state.dealer);
      state.phase = 'bidding-forced';
      state.bidPasses = 0;
      state.taker = forced;
      state.currentPlayer = forced;
    }
  }

  state.sequenceNumber++;
  return state;
}

function handleBidChoose(state: GameState, player: PlayerID, suit: Suit): GameState {
  if (state.currentPlayer !== player) return state;

  if (state.phase === 'bidding-round2') {
    // Can't choose the same suit as the trump card
    if (suit === state.trumpCard!.suit) return state;

    state.taker = player;
    state.trumpSuit = suit;

    // Trump card stays in the deck (not given to anyone in round 2)
    const deck = [...state.deck];
    deck.unshift(state.trumpCard!);
    state.deck = deck;
    state.trumpCard = null;

    dealRemainingCards(state);
    dealTableau(state);
  } else if (state.phase === 'bidding-forced') {
    state.taker = player;
    state.trumpSuit = suit;

    // Forced taker takes the turned-up card into their hand (+ 2 from deck = 8)
    state.hands[player].push(state.trumpCard!);
    state.trumpCard = null;

    dealRemainingCards(state);
    dealTableau(state);
  } else {
    return state;
  }

  state.phase = 'playing';
  state.currentPlayer = otherPlayer(state.dealer);
  state.currentTrick = emptyTrick(otherPlayer(state.dealer));

  state.sequenceNumber++;
  return state;
}

function handlePlayCard(state: GameState, player: PlayerID, cardStr: string): GameState {
  if (state.phase !== 'playing' || state.currentPlayer !== player) return state;

  const card = stringToCard(cardStr);
  if (!isCardPlayable(state, card)) return state;

  // Announce belote/rebelote when playing K or Q of trump. Checked before
  // the card leaves the hand so the pair is still complete for the first
  // card of a belote.
  announceBeloteIfApplicable(state, player, card);

  // Remove card from hand or tableau
  const handIdx = state.hands[player].findIndex(
    c => c.suit === card.suit && c.rank === card.rank
  );
  if (handIdx !== -1) {
    state.hands[player].splice(handIdx, 1);
  } else {
    // Search tableau for face-up match
    const tableau = state.tableau[player];
    const slotIdx = tableau.findIndex(
      s => s.faceUp && s.faceUp.suit === card.suit && s.faceUp.rank === card.rank
    );
    if (slotIdx === -1) return state;
    // Flip: face-down becomes face-up, face-down clears
    tableau[slotIdx].faceUp = tableau[slotIdx].faceDown;
    tableau[slotIdx].faceDown = null;
  }

  // Place card in trick
  state.currentTrick.cards[player] = card;

  state.sequenceNumber++;

  // Check if trick is complete
  const trickCards = state.currentTrick.cards;
  if (trickCards[0] !== null && trickCards[1] !== null) {
    // Determine winner
    const winner = trickWinner(
      trickCards as [Card, Card],
      state.currentTrick.leader,
      state.trumpSuit!,
    );

    state.currentTrick.winner = winner;
    state.tricksWon[winner].push(trickCards[0]!, trickCards[1]!);
    state.tricks.push({ ...state.currentTrick });

    // Check if round is over (16 tricks played)
    if (state.tricks.length === 16) {
      return endRound(state);
    }

    // Start new trick, winner leads
    state.currentTrick = emptyTrick(winner);
    state.currentPlayer = winner;
  } else {
    // Wait for other player's card
    state.currentPlayer = otherPlayer(player);
  }

  return state;
}

/**
 * Declares belote when a player plays the first card of a visible trump K+Q
 * pair (in hand or face-up in the tableau), and rebelote when they play the
 * second card. Face-down tableau cards do not count until uncovered before
 * the first card of the pair is played. Evaluated from shared state so both
 * clients agree automatically.
 */
function announceBeloteIfApplicable(state: GameState, player: PlayerID, card: Card): void {
  const trumpSuit = state.trumpSuit;
  if (!trumpSuit || !isBeloteCard(card, trumpSuit)) return;
  if (state.rebeloteDeclared[player]) return;

  const visibleCards: Card[] = [
    ...state.hands[player],
    ...state.tableau[player].flatMap(s => (s.faceUp ? [s.faceUp] : [])),
  ];

  // Both cards of the pair visible in hand or face-up tableau: first card played → belote.
  if (hasBelotePair(visibleCards, trumpSuit)) {
    state.beloteDeclared[player] = true;
    return;
  }

  // Pair is broken: rebelote if we already played the other card this round.
  if (state.beloteDeclared[player]) {
    const otherRank: Rank = card.rank === 'K' ? 'Q' : 'K';
    const playedByPlayer = state.tricks.flatMap(t => {
      const c = t.cards[player];
      return c ? [c] : [];
    });
    if (playedByPlayer.some(c => c.suit === trumpSuit && c.rank === otherRank)) {
      state.rebeloteDeclared[player] = true;
    }
  }
}

function endRound(state: GameState): GameState {
  const lastTrickWinner = state.tricks[state.tricks.length - 1].winner!;

  const roundScore = calculateRoundScore(
    state.tricksWon,
    state.taker!,
    state.trumpSuit!,
    state.beloteDeclared,
    state.rebeloteDeclared,
    lastTrickWinner,
  );

  state.roundScores.push(roundScore);
  state.gameScore[0] += roundScore.finalPoints[0];
  state.gameScore[1] += roundScore.finalPoints[1];

  // Check for game over
  if (state.gameScore[0] >= GAME_TARGET || state.gameScore[1] >= GAME_TARGET) {
    state.phase = 'game-over';
    return state;
  }

  // Start new round
  state.phase = 'round-over';
  return state;
}

export function startNewRound(state: GameState): GameState {
  const next = structuredClone(state);

  next.dealer = otherPlayer(next.dealer);
  next.phase = 'bidding-round1';
  next.biddingRound = 1;
  next.bidPasses = 0;
  next.currentPlayer = otherPlayer(next.dealer);
  next.trumpCard = null;
  next.trumpSuit = null;
  next.taker = null;
  next.tricks = [];
  next.currentTrick = emptyTrick(otherPlayer(next.dealer));
  next.tricksWon = [[], []];
  next.tableau = [emptyTableau(), emptyTableau()];
  next.beloteDeclared = [false, false];
  next.rebeloteDeclared = [false, false];

  dealCards(next);
  return next;
}

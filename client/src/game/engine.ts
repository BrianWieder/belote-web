import type { Card, PlayerID, GameState, GameAction, Suit, Trick } from './types';
import { stringToCard } from './types';
import { createDeck, shuffleDeck } from './deck';
import { trickWinner, calculateRoundScore } from './scoring';
import { isCardPlayable } from './validation';

const GAME_TARGET = 1000;

function otherPlayer(p: PlayerID): PlayerID {
  return p === 0 ? 1 : 0;
}

function emptyTrick(leader: PlayerID): Trick {
  return { cards: [null, null], leader };
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
  next.sequenceNumber++;

  switch (action.type) {
    case 'bid-take':
      return handleBidTake(next, player);
    case 'bid-pass':
      return handleBidPass(next, player);
    case 'bid-choose':
      return handleBidChoose(next, player, action.suit);
    case 'play-card':
      return handlePlayCard(next, player, action.card);
    case 'announce-belote':
      return handleAnnounceBelote(next, player);
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

  state.phase = 'playing';
  state.currentPlayer = otherPlayer(state.dealer);
  state.currentTrick = emptyTrick(otherPlayer(state.dealer));

  return state;
}

function handleBidPass(state: GameState, player: PlayerID): GameState {
  if (state.currentPlayer !== player) return state;
  if (state.phase !== 'bidding-round1' && state.phase !== 'bidding-round2') return state;

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
      // Both passed in round 2 - redeal
      state.dealer = otherPlayer(state.dealer);
      state.phase = 'bidding-round1';
      state.biddingRound = 1;
      state.bidPasses = 0;
      state.currentPlayer = otherPlayer(state.dealer);
      state.trumpCard = null;
      state.trumpSuit = null;
      state.taker = null;

      // Increment round number by adding a dummy score entry then removing it
      // Actually we just need to redeal with a new seed modifier
      state.roundScores.push({
        trickPoints: [0, 0],
        beloteBonus: [0, 0],
        lastTrickBonus: [0, 0],
        dedans: false,
        taker: 0,
        trumpSuit: 'hearts',
        finalPoints: [0, 0],
      });

      dealCards(state);
    }
  }

  return state;
}

function handleBidChoose(state: GameState, player: PlayerID, suit: Suit): GameState {
  if (state.phase !== 'bidding-round2' || state.currentPlayer !== player) return state;

  // Can't choose the same suit as the trump card
  if (suit === state.trumpCard!.suit) return state;

  state.taker = player;
  state.trumpSuit = suit;

  // Trump card stays in the deck (not given to anyone in round 2)
  // Deal remaining 3 cards to each
  const deck = [...state.deck];
  // Put trump card back in deck
  deck.unshift(state.trumpCard!);
  state.deck = deck;
  state.trumpCard = null;

  dealRemainingCards(state);

  state.phase = 'playing';
  state.currentPlayer = otherPlayer(state.dealer);
  state.currentTrick = emptyTrick(otherPlayer(state.dealer));

  return state;
}

function handlePlayCard(state: GameState, player: PlayerID, cardStr: string): GameState {
  if (state.phase !== 'playing' || state.currentPlayer !== player) return state;

  const card = stringToCard(cardStr);
  if (!isCardPlayable(state, card)) return state;

  // Remove card from hand
  const handIdx = state.hands[player].findIndex(
    c => c.suit === card.suit && c.rank === card.rank
  );
  if (handIdx === -1) return state;
  state.hands[player].splice(handIdx, 1);

  // Place card in trick
  state.currentTrick.cards[player] = card;

  // Auto-announce belote when playing K or Q of trump
  // (handled separately via announce-belote action for explicit UI)

  // Check if trick is complete
  const trickCards = state.currentTrick.cards;
  if (trickCards[0] !== null && trickCards[1] !== null) {
    // Determine winner
    const ledSuit = trickCards[state.currentTrick.leader]!.suit;
    const winner = trickWinner(
      trickCards as [Card, Card],
      state.currentTrick.leader,
      state.trumpSuit!,
      ledSuit,
    );

    state.currentTrick.winner = winner;
    state.tricksWon[winner].push(trickCards[0]!, trickCards[1]!);
    state.tricks.push({ ...state.currentTrick });

    // Check if round is over (8 tricks played)
    if (state.tricks.length === 8) {
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

function handleAnnounceBelote(state: GameState, player: PlayerID): GameState {
  if (state.phase !== 'playing') return state;

  if (!state.beloteDeclared[player]) {
    state.beloteDeclared[player] = true;
  } else if (!state.rebeloteDeclared[player]) {
    state.rebeloteDeclared[player] = true;
  }

  return state;
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
  next.beloteDeclared = [false, false];
  next.rebeloteDeclared = [false, false];

  dealCards(next);
  return next;
}

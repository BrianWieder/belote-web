import type { Card, GameAction, GameState, PlayerID, Rank, Suit } from './types';
import { cardToString } from './types';
import { SUITS } from './deck';
import { cardStrength, cardValue, trickWinner } from './scoring';
import { getPlayableCards, hasBelotePair, isBeloteCard } from './validation';

export type BotDifficulty = 'casual' | 'smart';

const ALL_RANKS: Rank[] = ['7', '8', '9', '10', 'J', 'Q', 'K', 'A'];

const TRUMP_BID_WEIGHTS: Record<Rank, number> = {
  J: 30,
  '9': 22,
  A: 12,
  '10': 9,
  K: 5,
  Q: 4,
  '8': 2,
  '7': 2,
};

const ROUND1_TAKE_THRESHOLD: Record<BotDifficulty, number> = {
  smart: 38,
  casual: 31,
};

const ROUND2_CHOOSE_THRESHOLD: Record<BotDifficulty, number> = {
  smart: 36,
  casual: 29,
};

/**
 * Pure deterministic PRNG in [0, 1) derived from public game progress.
 * Keeps casual play varied without making chooseBotAction impure or flaky.
 */
function deterministicUnit(state: GameState, salt = 0): number {
  const input = `${state.seed}:${state.roundScores.length}:${state.sequenceNumber}:${salt}`;
  let hash = 2166136261;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 4294967296;
}

/**
 * Evaluates a hand's strength if `suit` were chosen as trump.
 */
export function evaluateSuitForBidding(cards: Card[], suit: Suit): number {
  const trumps = cards.filter((c) => c.suit === suit);
  const nonTrumps = cards.filter((c) => c.suit !== suit);

  let score = 0;
  let hasJ = false;
  let has9 = false;

  for (const card of trumps) {
    score += TRUMP_BID_WEIGHTS[card.rank];
    if (card.rank === 'J') hasJ = true;
    if (card.rank === '9') has9 = true;
  }

  // J + 9 commanding trump synergy
  if (hasJ && has9) {
    score += 8;
  }

  // Belote (K + Q of trump)
  if (hasBelotePair(trumps, suit)) {
    score += 14;
  }

  // Trump length bonus
  if (trumps.length >= 5) {
    score += 28;
  } else if (trumps.length === 4) {
    score += 18;
  } else if (trumps.length === 3) {
    score += 8;
  }

  // Side-suit Aces and protected 10s
  for (const sideSuit of SUITS) {
    if (sideSuit === suit) continue;
    const sideCards = nonTrumps.filter((c) => c.suit === sideSuit);
    const hasAce = sideCards.some((c) => c.rank === 'A');
    const hasTen = sideCards.some((c) => c.rank === '10');
    const hasKing = sideCards.some((c) => c.rank === 'K');

    if (hasAce) score += 10;
    if (hasTen) score += hasAce ? 7 : 2;
    if (hasKing && (hasAce || hasTen)) score += 2;
  }

  return score;
}

function chooseBestSuit(cards: Card[], allowedSuits: Suit[]): { suit: Suit; score: number } {
  let bestSuit = allowedSuits[0];
  let bestScore = -Infinity;
  let bestTrumpCount = -1;

  for (const suit of allowedSuits) {
    const score = evaluateSuitForBidding(cards, suit);
    const trumpCount = cards.filter((c) => c.suit === suit).length;
    if (score > bestScore || (score === bestScore && trumpCount > bestTrumpCount)) {
      bestScore = score;
      bestSuit = suit;
      bestTrumpCount = trumpCount;
    }
  }

  return { suit: bestSuit, score: bestScore };
}

function chooseBiddingAction(
  state: GameState,
  botPlayer: PlayerID,
  difficulty: BotDifficulty,
): GameAction {
  const hand = state.hands[botPlayer];

  if (state.phase === 'bidding-round1') {
    const trumpCard = state.trumpCard;
    if (!trumpCard) {
      return { type: 'bid-take' };
    }

    // Rule: Jack turned up forces the non-dealer to take.
    if (trumpCard.rank === 'J') {
      return { type: 'bid-take' };
    }

    const candidateHand = [...hand, trumpCard];
    const score = evaluateSuitForBidding(candidateHand, trumpCard.suit);
    if (score >= ROUND1_TAKE_THRESHOLD[difficulty]) {
      return { type: 'bid-take' };
    }
    return { type: 'bid-pass' };
  }

  if (state.phase === 'bidding-round2') {
    const excludedSuit = state.trumpCard?.suit;
    const allowedSuits = SUITS.filter((s) => s !== excludedSuit);
    const { suit, score } = chooseBestSuit(hand, allowedSuits);

    if (score >= ROUND2_CHOOSE_THRESHOLD[difficulty]) {
      return { type: 'bid-choose', suit };
    }
    return { type: 'bid-pass' };
  }

  // bidding-forced: bot holds its full 8-card hand (plus trumpCard defensively if present)
  const fullHand = state.trumpCard ? [...hand, state.trumpCard] : hand;
  const { suit } = chooseBestSuit(fullHand, SUITS);
  return { type: 'bid-choose', suit };
}

interface PublicKnowledge {
  trumpSuit: Suit;
  playedSet: Set<string>;
  botVisibleCards: Card[];
  botVisibleSet: Set<string>;
  botTableauUncovers: Map<string, boolean>;
  oppFaceUpCards: Card[];
  unseenTrumpsCount: number;
  botHasBelotePair: boolean;
}

/**
 * Builds knowledge strictly from public table information + the bot's own hand.
 * NEVER reads the opponent's hidden hand, the deck, or any face-down tableau card values.
 */
function buildPublicKnowledge(state: GameState, botPlayer: PlayerID): PublicKnowledge {
  const opponent: PlayerID = botPlayer === 0 ? 1 : 0;
  const trumpSuit = state.trumpSuit!;

  const playedSet = new Set<string>();
  for (const trick of state.tricks) {
    if (trick.cards[0]) playedSet.add(cardToString(trick.cards[0]));
    if (trick.cards[1]) playedSet.add(cardToString(trick.cards[1]));
  }
  if (state.currentTrick.cards[0]) {
    playedSet.add(cardToString(state.currentTrick.cards[0]));
  }
  if (state.currentTrick.cards[1]) {
    playedSet.add(cardToString(state.currentTrick.cards[1]));
  }

  const botTableauUncovers = new Map<string, boolean>();
  const botFaceUpCards: Card[] = [];
  for (const slot of state.tableau[botPlayer]) {
    if (slot.faceUp) {
      botFaceUpCards.push(slot.faceUp);
      // Only check existence of a face-down card beneath (publicly visible), never its rank/suit.
      botTableauUncovers.set(cardToString(slot.faceUp), slot.faceDown !== null);
    }
  }

  const oppFaceUpCards: Card[] = [];
  for (const slot of state.tableau[opponent]) {
    if (slot.faceUp) {
      oppFaceUpCards.push(slot.faceUp);
    }
  }

  const botVisibleCards = [...state.hands[botPlayer], ...botFaceUpCards];
  const botVisibleSet = new Set(botVisibleCards.map(cardToString));

  let unseenTrumpsCount = 0;
  for (const rank of ALL_RANKS) {
    const key = cardToString({ suit: trumpSuit, rank });
    if (!playedSet.has(key) && !botVisibleSet.has(key)) {
      unseenTrumpsCount++;
    }
  }

  const botHasBelotePair =
    !state.rebeloteDeclared[botPlayer] && hasBelotePair(botVisibleCards, trumpSuit);

  return {
    trumpSuit,
    playedSet,
    botVisibleCards,
    botVisibleSet,
    botTableauUncovers,
    oppFaceUpCards,
    unseenTrumpsCount,
    botHasBelotePair,
  };
}

function countUnseenHigher(card: Card, knowledge: PublicKnowledge): number {
  const myStrength = cardStrength(card, knowledge.trumpSuit);
  let count = 0;
  for (const rank of ALL_RANKS) {
    const candidate: Card = { suit: card.suit, rank };
    if (cardStrength(candidate, knowledge.trumpSuit) > myStrength) {
      const key = cardToString(candidate);
      if (!knowledge.playedSet.has(key) && !knowledge.botVisibleSet.has(key)) {
        count++;
      }
    }
  }
  return count;
}

function countPlayedInSuit(suit: Suit, knowledge: PublicKnowledge): number {
  let count = 0;
  for (const rank of ALL_RANKS) {
    if (knowledge.playedSet.has(cardToString({ suit, rank }))) {
      count++;
    }
  }
  return count;
}

function isCompletingRebelote(state: GameState, botPlayer: PlayerID, card: Card): boolean {
  return (
    state.beloteDeclared[botPlayer] &&
    !state.rebeloteDeclared[botPlayer] &&
    state.trumpSuit !== null &&
    isBeloteCard(card, state.trumpSuit)
  );
}

function scoreLeadCard(
  state: GameState,
  botPlayer: PlayerID,
  card: Card,
  knowledge: PublicKnowledge,
): number {
  const { trumpSuit, unseenTrumpsCount, botTableauUncovers, oppFaceUpCards, botHasBelotePair } =
    knowledge;
  const key = cardToString(card);
  const isTrump = card.suit === trumpSuit;
  const val = cardValue(card, trumpSuit);
  const str = cardStrength(card, trumpSuit);
  const higherOut = countUnseenHigher(card, knowledge);
  const isMaster = higherOut === 0;
  const fromTableau = botTableauUncovers.has(key);
  const uncovers = botTableauUncovers.get(key) === true;
  const oppSuitCards = oppFaceUpCards.filter((c) => c.suit === card.suit);
  const oppHasVisibleBeat = oppSuitCards.some(
    (c) => cardStrength(c, trumpSuit) > str,
  );
  const oppHasVisibleTrump = oppFaceUpCards.some((c) => c.suit === trumpSuit);
  const botIsTaker = state.taker === botPlayer;
  const botTrumpCount = knowledge.botVisibleCards.filter((c) => c.suit === trumpSuit).length;
  const isLastTrick = state.tricks.length === 15;
  const completesRebelote = isCompletingRebelote(state, botPlayer, card);
  const startsBelote = botHasBelotePair && isBeloteCard(card, trumpSuit);

  let score = 0;

  if (isTrump) {
    if (unseenTrumpsCount > 0) {
      if (isMaster) {
        score += botIsTaker ? 52 : 34;
        if (oppHasVisibleTrump) score += 8;
        if (botTrumpCount >= 3) score += 6;
        if (completesRebelote) score += 16;
        if (startsBelote) score += 10;
      } else {
        score += botIsTaker ? 10 : -8;
        score -= val * 1.4;
        if (oppHasVisibleBeat) score -= 22;
        if (startsBelote) score -= 14;
        if (val === 0 && botIsTaker && botTrumpCount >= 3) score += 8;
      }
    } else {
      // Opponent has no trumps left: trump is a guaranteed winner.
      score += 22 + val * 0.4;
      if (completesRebelote || startsBelote) score += 18;
    }
  } else if (isMaster) {
    score += unseenTrumpsCount === 0 ? 48 : 38;
    score += val * 0.6;

    if (oppSuitCards.length > 0) {
      // Opponent has a visible card of this suit and must follow suit — cannot ruff!
      const bestOppCardPts = Math.max(...oppSuitCards.map((c) => cardValue(c, trumpSuit)));
      score += 12 + bestOppCardPts * 0.5;
    } else if (unseenTrumpsCount > 0 && countPlayedInSuit(card.suit, knowledge) >= 4) {
      // Suit is heavily played; opponent is more likely void and able to ruff.
      score -= 8;
    }
  } else {
    score += 12;
    if (card.rank === '10') {
      // Never blindly lead a bare 10 into an unseen Ace.
      score -= 32;
    }
    score -= val * 1.6;
    if (oppHasVisibleBeat) score -= 14;
    if (val === 0) score += 6;
  }

  // Prefer playing from tableau when uncovering a buried card is helpful.
  if (uncovers) {
    score += isMaster || val <= 4 ? 8 : 3;
  } else if (fromTableau && val === 0) {
    score += 2;
  }

  if (isLastTrick && isMaster) {
    score += 20;
  }

  return score;
}

function scoreFollowCard(
  state: GameState,
  botPlayer: PlayerID,
  card: Card,
  knowledge: PublicKnowledge,
): number {
  const { trumpSuit, botTableauUncovers, botHasBelotePair } = knowledge;
  const leader = state.currentTrick.leader;
  const leaderCard = state.currentTrick.cards[leader]!;
  const simCards: [Card, Card] = leader === 0 ? [leaderCard, card] : [card, leaderCard];
  const botWins = trickWinner(simCards, leader, trumpSuit) === botPlayer;

  const key = cardToString(card);
  const val = cardValue(card, trumpSuit);
  const str = cardStrength(card, trumpSuit);
  const leaderPts = cardValue(leaderCard, trumpSuit);
  const isTrump = card.suit === trumpSuit;
  const uncovers = botTableauUncovers.get(key) === true;
  const isLastTrick = state.tricks.length === 15;
  const completesRebelote = isCompletingRebelote(state, botPlayer, card);
  const startsBelote = botHasBelotePair && isBeloteCard(card, trumpSuit);

  if (botWins) {
    const trickPts = leaderPts + val + (isLastTrick ? 10 : 0);
    let score = 100 + trickPts * 1.5;

    if (!isTrump) {
      // Playing second safely rescues a 10 even if opponent still holds the Ace.
      if (card.rank === '10' && countUnseenHigher(card, knowledge) > 0) {
        score += 18;
      }
      // Prefer cheaper winning non-trumps so we keep masters for leading.
      score -= str * 3.5;
    } else {
      // Win with the cheapest winning trump to preserve J/9.
      score -= str * 6 + val * 0.8;
      if (completesRebelote) score += 22;
      if (startsBelote) score += 6;
    }

    if (uncovers) score += 5;
    return score;
  }

  // Losing the trick: shed lowest-value non-trump card and protect high cards / Belote.
  let score = -val * 5 - str * 1.5;

  if (!isTrump && card.rank === 'A') score -= 18;
  if (!isTrump && card.rank === '10') score -= 12;
  if (isTrump) score -= 10 + str * 2;

  if (completesRebelote) {
    // Completing Rebelote is worth +20 even if this trick is lost (assuming >=1 trick won).
    score += 14;
  } else if (startsBelote || (isBeloteCard(card, trumpSuit) && !state.rebeloteDeclared[botPlayer])) {
    score -= 16;
  }

  if (uncovers && val === 0) {
    score += 5;
  }

  return score;
}

function chooseSmartPlayCard(
  state: GameState,
  botPlayer: PlayerID,
  playable: Card[],
): Card {
  const knowledge = buildPublicKnowledge(state, botPlayer);
  const isLeading =
    state.currentTrick.cards[0] === null && state.currentTrick.cards[1] === null;

  let bestCard = playable[0];
  let bestScore = -Infinity;

  for (const card of playable) {
    const score = isLeading
      ? scoreLeadCard(state, botPlayer, card, knowledge)
      : scoreFollowCard(state, botPlayer, card, knowledge);

    if (score > bestScore) {
      bestScore = score;
      bestCard = card;
    }
  }

  return bestCard;
}

function chooseCasualPlayCard(
  state: GameState,
  botPlayer: PlayerID,
  playable: Card[],
): Card {
  const trumpSuit = state.trumpSuit!;

  // Semi-random legal play (~35% of turns) so beginners can beat casual comfortably.
  // Rescale the accepted [0, 0.35) draw to [0, 1) so every legal card index is reachable.
  const randomRoll = deterministicUnit(state, 1);
  if (randomRoll < 0.35) {
    const idx = Math.min(
      playable.length - 1,
      Math.floor((randomRoll / 0.35) * playable.length),
    );
    return playable[idx];
  }

  const isLeading =
    state.currentTrick.cards[0] === null && state.currentTrick.cards[1] === null;

  if (isLeading) {
    // Simple greedy lead: prefer non-trump high card or low card without deep tracking.
    const sorted = [...playable].sort((a, b) => {
      const aTrump = a.suit === trumpSuit ? 1 : 0;
      const bTrump = b.suit === trumpSuit ? 1 : 0;
      if (aTrump !== bTrump) return aTrump - bTrump;
      return cardValue(b, trumpSuit) - cardValue(a, trumpSuit);
    });
    return sorted[0];
  }

  const leader = state.currentTrick.leader;
  const leaderCard = state.currentTrick.cards[leader]!;
  const winning = playable.filter((card) => {
    const simCards: [Card, Card] = leader === 0 ? [leaderCard, card] : [card, leaderCard];
    return trickWinner(simCards, leader, trumpSuit) === botPlayer;
  });

  if (winning.length > 0) {
    winning.sort((a, b) => cardStrength(a, trumpSuit) - cardStrength(b, trumpSuit));
    return winning[0];
  }

  // Losing: discard lowest point value card.
  const losing = [...playable].sort(
    (a, b) => cardValue(a, trumpSuit) - cardValue(b, trumpSuit),
  );
  return losing[0];
}

/**
 * Pure heuristic Belote Maniée AI engine.
 * Always returns a strictly legal GameAction for the given state and botPlayer,
 * using only publicly visible information and the bot's own hand.
 */
export function chooseBotAction(
  state: GameState,
  botPlayer: PlayerID,
  difficulty: BotDifficulty = 'smart',
): GameAction {
  const isBiddingPhase =
    state.phase === 'bidding-round1' ||
    state.phase === 'bidding-round2' ||
    state.phase === 'bidding-forced';

  if (!isBiddingPhase && state.phase !== 'playing') {
    throw new Error(`chooseBotAction called in non-actionable phase: ${state.phase}`);
  }

  if (state.currentPlayer !== botPlayer) {
    throw new Error(
      `chooseBotAction called out of turn: currentPlayer is ${state.currentPlayer}, botPlayer is ${botPlayer}`,
    );
  }

  if (isBiddingPhase) {
    return chooseBiddingAction(state, botPlayer, difficulty);
  }

  const playable = getPlayableCards(state);

  if (playable.length === 0) {
    throw new Error(`No playable cards available for bot player ${botPlayer}`);
  }

  if (playable.length === 1) {
    return { type: 'play-card', card: cardToString(playable[0]) };
  }

  const chosen =
    difficulty === 'casual'
      ? chooseCasualPlayCard(state, botPlayer, playable)
      : chooseSmartPlayCard(state, botPlayer, playable);

  return { type: 'play-card', card: cardToString(chosen) };
}

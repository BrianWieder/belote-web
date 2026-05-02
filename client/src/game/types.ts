export type Suit = 'hearts' | 'diamonds' | 'clubs' | 'spades';
export type Rank = '7' | '8' | '9' | '10' | 'J' | 'Q' | 'K' | 'A';

export interface Card {
  suit: Suit;
  rank: Rank;
}

export type PlayerID = 0 | 1;

export type Phase =
  | 'bidding-round1'
  | 'bidding-round2'
  | 'playing'
  | 'round-over'
  | 'game-over';

export type GameAction =
  | { type: 'bid-take' }
  | { type: 'bid-pass' }
  | { type: 'bid-choose'; suit: Suit }
  | { type: 'play-card'; card: string }
  | { type: 'announce-belote' };

export interface Trick {
  cards: [Card | null, Card | null];
  leader: PlayerID;
  winner?: PlayerID;
}

export interface RoundScore {
  trickPoints: [number, number];
  beloteBonus: [number, number];
  lastTrickBonus: [number, number];
  dedans: boolean;
  taker: PlayerID;
  trumpSuit: Suit;
  finalPoints: [number, number];
}

export interface GameState {
  phase: Phase;
  seed: string;
  dealer: PlayerID;
  hands: [Card[], Card[]];
  deck: Card[];
  trumpCard: Card | null;
  trumpSuit: Suit | null;
  taker: PlayerID | null;
  currentPlayer: PlayerID;
  biddingRound: 1 | 2;
  bidPasses: number;

  tricks: Trick[];
  currentTrick: Trick;
  tricksWon: [Card[], Card[]];

  beloteDeclared: [boolean, boolean];
  rebeloteDeclared: [boolean, boolean];

  roundScores: RoundScore[];
  gameScore: [number, number];

  sequenceNumber: number;
}

export function cardToString(card: Card): string {
  return `${card.rank}_${card.suit}`;
}

export function stringToCard(s: string): Card {
  const [rank, suit] = s.split('_');
  return { rank: rank as Rank, suit: suit as Suit };
}

import type { Card, Suit, Rank, PlayerID, RoundScore } from './types';

const TRUMP_VALUES: Record<Rank, number> = {
  'J': 20, '9': 14, 'A': 11, '10': 10, 'K': 4, 'Q': 3, '8': 0, '7': 0,
};

const NON_TRUMP_VALUES: Record<Rank, number> = {
  'A': 11, '10': 10, 'K': 4, 'Q': 3, 'J': 2, '9': 0, '8': 0, '7': 0,
};

const TRUMP_ORDER: Rank[] = ['7', '8', 'Q', 'K', '10', 'A', '9', 'J'];
const NON_TRUMP_ORDER: Rank[] = ['7', '8', '9', 'J', 'Q', 'K', '10', 'A'];

export function cardValue(card: Card, trumpSuit: Suit): number {
  return card.suit === trumpSuit
    ? TRUMP_VALUES[card.rank]
    : NON_TRUMP_VALUES[card.rank];
}

export function cardStrength(card: Card, trumpSuit: Suit): number {
  const order = card.suit === trumpSuit ? TRUMP_ORDER : NON_TRUMP_ORDER;
  return order.indexOf(card.rank);
}

export function trickWinner(
  cards: [Card, Card],
  leader: PlayerID,
  trumpSuit: Suit,
  _ledSuit: Suit,
): PlayerID {
  const follower: PlayerID = leader === 0 ? 1 : 0;
  const leaderCard = cards[leader];
  const followerCard = cards[follower];

  // If follower played trump and leader didn't
  if (followerCard.suit === trumpSuit && leaderCard.suit !== trumpSuit) {
    return follower;
  }
  // If leader played trump and follower didn't
  if (leaderCard.suit === trumpSuit && followerCard.suit !== trumpSuit) {
    return leader;
  }
  // Both trump or both same suit - compare strength
  if (followerCard.suit === leaderCard.suit) {
    const leaderStrength = cardStrength(leaderCard, trumpSuit);
    const followerStrength = cardStrength(followerCard, trumpSuit);
    return followerStrength > leaderStrength ? follower : leader;
  }
  // Follower played different non-trump suit -> leader wins
  return leader;
}

export function trickPoints(cards: Card[], trumpSuit: Suit): number {
  return cards.reduce((sum, card) => sum + cardValue(card, trumpSuit), 0);
}

export function calculateRoundScore(
  tricksWon: [Card[], Card[]],
  taker: PlayerID,
  trumpSuit: Suit,
  beloteDeclared: [boolean, boolean],
  rebeloteDeclared: [boolean, boolean],
  lastTrickWinner: PlayerID,
): RoundScore {
  const trickPts: [number, number] = [
    trickPoints(tricksWon[0], trumpSuit),
    trickPoints(tricksWon[1], trumpSuit),
  ];

  const lastTrickBonusPts: [number, number] = [0, 0];
  lastTrickBonusPts[lastTrickWinner] = 10;

  const beloteBonusPts: [number, number] = [0, 0];
  for (const p of [0, 1] as PlayerID[]) {
    if (beloteDeclared[p] && rebeloteDeclared[p]) {
      beloteBonusPts[p] = 20;
    }
  }

  const rawPoints: [number, number] = [
    trickPts[0] + lastTrickBonusPts[0] + beloteBonusPts[0],
    trickPts[1] + lastTrickBonusPts[1] + beloteBonusPts[1],
  ];

  const defender: PlayerID = taker === 0 ? 1 : 0;

  // Dedans: if taker didn't get more points than defender, defender gets all 162 + bonuses
  const dedans = rawPoints[taker] <= rawPoints[defender];
  const finalPoints: [number, number] = [0, 0];

  if (dedans) {
    // Defender gets all card points (162) + last trick bonus + both belote bonuses go to respective owners
    finalPoints[defender] = 162;
    // Belote bonus always goes to the team that declared it, even on dedans
    finalPoints[0] += beloteBonusPts[0];
    finalPoints[1] += beloteBonusPts[1];
  } else {
    finalPoints[0] = rawPoints[0];
    finalPoints[1] = rawPoints[1];
  }

  return {
    trickPoints: trickPts,
    beloteBonus: beloteBonusPts,
    lastTrickBonus: lastTrickBonusPts,
    dedans,
    taker,
    trumpSuit,
    finalPoints,
  };
}

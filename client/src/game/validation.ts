import type { Card, Suit, GameState } from './types';
import { cardStrength } from './scoring';

/**
 * Returns the list of cards the current player can legally play.
 * Belote rules:
 * 1. Must follow suit if possible
 * 2. If can't follow suit, must play trump if possible
 * 3. If partner is winning (N/A in 2-player, opponent always leads), must overtrump if possible
 * 4. If trumping, must overtrump the existing trump if possible
 */
export function getPlayableCards(state: GameState): Card[] {
  const hand = state.hands[state.currentPlayer];
  const tableauFaceUp = state.tableau[state.currentPlayer]
    .map(s => s.faceUp)
    .filter((c): c is Card => c !== null);
  const allCards = [...hand, ...tableauFaceUp];
  const trumpSuit = state.trumpSuit!;
  const trick = state.currentTrick;

  // Leader can play anything
  if (trick.cards[0] === null && trick.cards[1] === null) {
    return allCards;
  }

  const leaderCard = trick.cards[trick.leader]!;
  const ledSuit = leaderCard.suit;

  // Cards of the led suit
  const suitCards = allCards.filter(c => c.suit === ledSuit);

  if (ledSuit === trumpSuit) {
    // Led suit is trump - must follow with trump
    if (suitCards.length > 0) {
      // Must overtrump if possible
      const leaderStrength = cardStrength(leaderCard, trumpSuit);
      const higherTrumps = suitCards.filter(c => cardStrength(c, trumpSuit) > leaderStrength);
      return higherTrumps.length > 0 ? higherTrumps : suitCards;
    }
    // No trump - can play anything
    return allCards;
  }

  // Led suit is not trump
  if (suitCards.length > 0) {
    // Must follow suit
    return suitCards;
  }

  // Can't follow suit - must trump if possible
  const trumpCards = allCards.filter(c => c.suit === trumpSuit);
  if (trumpCards.length > 0) {
    return trumpCards;
  }

  // Can't follow suit and can't trump - play anything
  return allCards;
}

export function isCardPlayable(state: GameState, card: Card): boolean {
  const playable = getPlayableCards(state);
  return playable.some(c => c.suit === card.suit && c.rank === card.rank);
}

export function isBeloteCard(card: Card, trumpSuit: Suit): boolean {
  return card.suit === trumpSuit && (card.rank === 'K' || card.rank === 'Q');
}

export function hasBelotePair(hand: Card[], trumpSuit: Suit): boolean {
  const hasKing = hand.some(c => c.suit === trumpSuit && c.rank === 'K');
  const hasQueen = hand.some(c => c.suit === trumpSuit && c.rank === 'Q');
  return hasKing && hasQueen;
}

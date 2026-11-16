import { describe, it, expect } from 'vitest';
import { getPlayableCards } from '../validation';
import { createInitialState, applyAction } from '../engine';
import { cardToString } from '../types';
import type { Card, GameState, PlayerID, Suit, PlayerTableau } from '../types';

const c = (rank: Card['rank'], suit: Suit): Card => ({ rank, suit });

const EMPTY_TABLEAU: PlayerTableau = [
  { faceDown: null, faceUp: null },
  { faceDown: null, faceUp: null },
  { faceDown: null, faceUp: null },
  { faceDown: null, faceUp: null },
];

/**
 * Build a playing state where `follower` must respond to `leaderCard`
 * (led by `leader`). The follower's hand is under our control and their
 * tableau is empty so only hand cards matter.
 */
function followingState(
  trump: Suit,
  leader: PlayerID,
  leaderCard: Card,
  followerHand: Card[],
): GameState {
  const state = createInitialState('validation', 0);
  const playing = applyAction(state, state.currentPlayer, { type: 'bid-take' });
  const s = structuredClone(playing);
  s.trumpSuit = trump;
  s.currentTrick = { cards: [null, null], leader };
  s.currentTrick.cards[leader] = leaderCard;
  const follower: PlayerID = leader === 0 ? 1 : 0;
  s.currentPlayer = follower;
  s.hands[follower] = followerHand;
  s.hands[leader] = [];
  s.tableau = [EMPTY_TABLEAU, EMPTY_TABLEAU];
  return s;
}

/** Build a playing state where `player` leads an empty trick. */
function leadingState(player: PlayerID, hand: Card[], tableau?: PlayerTableau): GameState {
  const state = createInitialState('validation', 0);
  const playing = applyAction(state, state.currentPlayer, { type: 'bid-take' });
  const s = structuredClone(playing);
  s.currentTrick = { cards: [null, null], leader: player };
  s.currentPlayer = player;
  s.hands[player] = hand;
  s.tableau[player] = tableau ?? EMPTY_TABLEAU;
  const other: PlayerID = player === 0 ? 1 : 0;
  s.hands[other] = [];
  s.tableau[other] = EMPTY_TABLEAU;
  return s;
}

function suitsOf(cards: Card[]): Suit[] {
  return cards.map(card => card.suit);
}

describe('getPlayableCards', () => {
  it('leader can play any card (hand + face-up tableau)', () => {
    const tableau: PlayerTableau = [
      { faceDown: null, faceUp: c('A', 'clubs') },
      { faceDown: null, faceUp: null },
      { faceDown: null, faceUp: null },
      { faceDown: null, faceUp: null },
    ];
    const state = leadingState(0, [c('7', 'spades')], tableau);
    const playable = getPlayableCards(state);
    expect(playable).toHaveLength(2);
    expect(suitsOf(playable)).toContain('spades');
    expect(suitsOf(playable)).toContain('clubs');
  });

  it('must follow suit when able', () => {
    const state = followingState('hearts', 0, c('A', 'spades'), [
      c('7', 'spades'), c('8', 'spades'), c('A', 'hearts'),
    ]);
    const playable = getPlayableCards(state);
    expect(suitsOf(playable)).toEqual(['spades', 'spades']);
  });

  it('must play trump when unable to follow suit', () => {
    const state = followingState('hearts', 0, c('A', 'spades'), [
      c('J', 'hearts'), c('A', 'diamonds'), c('K', 'clubs'),
    ]);
    const playable = getPlayableCards(state);
    expect(suitsOf(playable)).toEqual(['hearts']);
  });

  it('must overtrump when a higher trump is available', () => {
    // Trump led with 9 (rank 6); follower holds Q (rank 2) and J (rank 7).
    const state = followingState('hearts', 0, c('9', 'hearts'), [
      c('Q', 'hearts'), c('J', 'hearts'),
    ]);
    const playable = getPlayableCards(state);
    expect(playable).toHaveLength(1);
    expect(playable[0]).toEqual(c('J', 'hearts'));
  });

  it('may play any trump when no higher trump is available', () => {
    const state = followingState('hearts', 0, c('J', 'hearts'), [
      c('10', 'hearts'), c('A', 'spades'),
    ]);
    const playable = getPlayableCards(state);
    expect(playable).toHaveLength(1);
    expect(playable[0]).toEqual(c('10', 'hearts'));
  });

  it('may play anything when unable to follow and holding no trump', () => {
    const state = followingState('hearts', 0, c('A', 'spades'), [
      c('A', 'diamonds'), c('A', 'clubs'),
    ]);
    const playable = getPlayableCards(state);
    expect(playable).toHaveLength(2);
    expect(playable.map(cardToString).sort()).toEqual([
      cardToString(c('A', 'clubs')),
      cardToString(c('A', 'diamonds')),
    ]);
  });

  it('includes face-up tableau cards in the playable set', () => {
    const tableau: PlayerTableau = [
      { faceDown: null, faceUp: c('7', 'spades') },
      { faceDown: null, faceUp: null },
      { faceDown: null, faceUp: null },
      { faceDown: null, faceUp: null },
    ];
    const state = followingState('hearts', 0, c('A', 'spades'), [
      c('8', 'spades'),
    ]);
    // Give the follower a face-up tableau card of the led suit too.
    state.tableau[1] = tableau;
    const playable = getPlayableCards(state);
    expect(playable).toHaveLength(2);
    expect(suitsOf(playable)).toEqual(['spades', 'spades']);
  });
});

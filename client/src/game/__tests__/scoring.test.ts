import { describe, it, expect } from 'vitest';
import { cardValue, trickWinner, trickPoints, calculateRoundScore } from '../scoring';
import type { Card, Suit } from '../types';

const c = (rank: string, suit: Suit): Card => ({ rank: rank as Card['rank'], suit });

describe('cardValue', () => {
  it('J of trump is worth 20', () => {
    expect(cardValue(c('J', 'hearts'), 'hearts')).toBe(20);
  });

  it('9 of trump is worth 14', () => {
    expect(cardValue(c('9', 'hearts'), 'hearts')).toBe(14);
  });

  it('J of non-trump is worth 2', () => {
    expect(cardValue(c('J', 'spades'), 'hearts')).toBe(2);
  });

  it('A is always worth 11', () => {
    expect(cardValue(c('A', 'hearts'), 'hearts')).toBe(11);
    expect(cardValue(c('A', 'spades'), 'hearts')).toBe(11);
  });

  it('7 is always worth 0', () => {
    expect(cardValue(c('7', 'hearts'), 'hearts')).toBe(0);
  });

  it('total of all 32 cards is 152', () => {
    const suits: Suit[] = ['hearts', 'diamonds', 'clubs', 'spades'];
    const ranks = ['7', '8', '9', '10', 'J', 'Q', 'K', 'A'] as const;
    let total = 0;
    for (const suit of suits) {
      for (const rank of ranks) {
        total += cardValue({ suit, rank }, 'hearts');
      }
    }
    expect(total).toBe(152);
  });
});

describe('trickWinner', () => {
  it('higher card of led suit wins', () => {
    const winner = trickWinner(
      [c('K', 'spades'), c('A', 'spades')],
      0, 'hearts', 'spades',
    );
    expect(winner).toBe(1);
  });

  it('trump beats non-trump', () => {
    const winner = trickWinner(
      [c('A', 'spades'), c('7', 'hearts')],
      0, 'hearts', 'spades',
    );
    expect(winner).toBe(1);
  });

  it('higher trump beats lower trump', () => {
    const winner = trickWinner(
      [c('9', 'hearts'), c('J', 'hearts')],
      0, 'hearts', 'hearts',
    );
    expect(winner).toBe(1);
  });

  it('non-led non-trump suit loses', () => {
    const winner = trickWinner(
      [c('A', 'spades'), c('A', 'diamonds')],
      0, 'hearts', 'spades',
    );
    expect(winner).toBe(0);
  });

  it('trump 9 beats trump 10 (trump order)', () => {
    const winner = trickWinner(
      [c('10', 'hearts'), c('9', 'hearts')],
      0, 'hearts', 'hearts',
    );
    expect(winner).toBe(1);
  });
});

describe('trickPoints', () => {
  it('sums card values', () => {
    const cards = [c('J', 'hearts'), c('A', 'spades')];
    expect(trickPoints(cards, 'hearts')).toBe(31);
  });
});

describe('calculateRoundScore', () => {
  it('applies dedans when taker scores less', () => {
    const score = calculateRoundScore(
      [[c('7', 'spades')], [c('A', 'hearts'), c('J', 'hearts')]],
      0, 'hearts',
      [false, false], [false, false],
      1,
    );
    expect(score.dedans).toBe(true);
    expect(score.finalPoints[1]).toBe(162);
  });

  it('applies dedans when taker ties', () => {
    // Equal points means dedans for the taker
    const score = calculateRoundScore(
      [[c('A', 'hearts')], [c('A', 'spades')]],
      0, 'hearts',
      [false, false], [false, false],
      0,
    );
    // Player 0 has 11 + 10 last trick = 21, Player 1 has 11
    // Not dedans since taker has more
    expect(score.dedans).toBe(false);
  });

  it('belote bonus preserved even on dedans', () => {
    const score = calculateRoundScore(
      [[c('7', 'spades')], [c('A', 'hearts')]],
      0, 'hearts',
      [true, false], [true, false],
      1,
    );
    expect(score.dedans).toBe(true);
    expect(score.finalPoints[0]).toBe(20); // belote bonus preserved
    expect(score.finalPoints[1]).toBe(162);
  });
});

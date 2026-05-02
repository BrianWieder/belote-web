import { describe, it, expect } from 'vitest';
import { createDeck, shuffleDeck } from '../deck';

describe('createDeck', () => {
  it('creates 32 cards', () => {
    const deck = createDeck();
    expect(deck).toHaveLength(32);
  });

  it('has 4 suits with 8 ranks each', () => {
    const deck = createDeck();
    const suits = new Set(deck.map(c => c.suit));
    expect(suits.size).toBe(4);
    for (const suit of suits) {
      expect(deck.filter(c => c.suit === suit)).toHaveLength(8);
    }
  });

  it('has no duplicate cards', () => {
    const deck = createDeck();
    const keys = deck.map(c => `${c.rank}_${c.suit}`);
    expect(new Set(keys).size).toBe(32);
  });
});

describe('shuffleDeck', () => {
  it('returns all 32 cards', () => {
    const deck = createDeck();
    const shuffled = shuffleDeck(deck, 'test-seed', 0);
    expect(shuffled).toHaveLength(32);
  });

  it('is deterministic with same seed', () => {
    const deck = createDeck();
    const a = shuffleDeck(deck, 'my-seed', 0);
    const b = shuffleDeck(deck, 'my-seed', 0);
    expect(a).toEqual(b);
  });

  it('differs with different seeds', () => {
    const deck = createDeck();
    const a = shuffleDeck(deck, 'seed-a', 0);
    const b = shuffleDeck(deck, 'seed-b', 0);
    expect(a).not.toEqual(b);
  });

  it('differs with different round numbers', () => {
    const deck = createDeck();
    const a = shuffleDeck(deck, 'same', 0);
    const b = shuffleDeck(deck, 'same', 1);
    expect(a).not.toEqual(b);
  });

  it('does not mutate the original deck', () => {
    const deck = createDeck();
    const original = [...deck];
    shuffleDeck(deck, 'test', 0);
    expect(deck).toEqual(original);
  });
});

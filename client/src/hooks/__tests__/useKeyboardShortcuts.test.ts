import { describe, it, expect } from 'vitest';
import {
  getNextPlayableIndex,
  isEditableTarget,
  resolveBiddingShortcut,
} from '../useKeyboardShortcuts';

describe('resolveBiddingShortcut', () => {
  it('maps t/T to bid-take only in bidding-round1', () => {
    expect(resolveBiddingShortcut('t', 'bidding-round1', '9')).toBe('bid-take');
    expect(resolveBiddingShortcut('T', 'bidding-round1', 'J')).toBe('bid-take');
    expect(resolveBiddingShortcut('t', 'bidding-round2', '9')).toBeNull();
    expect(resolveBiddingShortcut('t', 'bidding-forced', null)).toBeNull();
    expect(resolveBiddingShortcut('t', 'playing', null)).toBeNull();
    expect(resolveBiddingShortcut('t', 'round-over', null)).toBeNull();
  });

  it('maps p/P to bid-pass only when passing is allowed', () => {
    // Allowed in round 1 when trump card is not a Jack
    expect(resolveBiddingShortcut('p', 'bidding-round1', 'A')).toBe('bid-pass');
    expect(resolveBiddingShortcut('P', 'bidding-round1', '10')).toBe('bid-pass');

    // Disallowed in round 1 when a Jack is turned up (forced take)
    expect(resolveBiddingShortcut('p', 'bidding-round1', 'J')).toBeNull();

    // Allowed in round 2
    expect(resolveBiddingShortcut('p', 'bidding-round2', '9')).toBe('bid-pass');

    // Disallowed in forced bidding and non-bidding phases
    expect(resolveBiddingShortcut('p', 'bidding-forced', null)).toBeNull();
    expect(resolveBiddingShortcut('p', 'playing', null)).toBeNull();
  });

  it('ignores unrelated keys', () => {
    expect(resolveBiddingShortcut('Enter', 'bidding-round1', '9')).toBeNull();
    expect(resolveBiddingShortcut('x', 'bidding-round1', '9')).toBeNull();
    expect(resolveBiddingShortcut('ArrowRight', 'bidding-round1', '9')).toBeNull();
  });
});

describe('getNextPlayableIndex', () => {
  it('returns -1 when there are no playable cards', () => {
    expect(getNextPlayableIndex(-1, 0, 'next')).toBe(-1);
    expect(getNextPlayableIndex(0, 0, 'prev')).toBe(-1);
  });

  it('focuses first card on next and last card on prev when no playable card is focused', () => {
    expect(getNextPlayableIndex(-1, 4, 'next')).toBe(0);
    expect(getNextPlayableIndex(-1, 4, 'prev')).toBe(3);
  });

  it('cycles forward and wraps around on next', () => {
    expect(getNextPlayableIndex(0, 3, 'next')).toBe(1);
    expect(getNextPlayableIndex(1, 3, 'next')).toBe(2);
    expect(getNextPlayableIndex(2, 3, 'next')).toBe(0);
  });

  it('cycles backward and wraps around on prev', () => {
    expect(getNextPlayableIndex(2, 3, 'prev')).toBe(1);
    expect(getNextPlayableIndex(1, 3, 'prev')).toBe(0);
    expect(getNextPlayableIndex(0, 3, 'prev')).toBe(2);
  });

  it('handles a single playable card cleanly', () => {
    expect(getNextPlayableIndex(-1, 1, 'next')).toBe(0);
    expect(getNextPlayableIndex(0, 1, 'next')).toBe(0);
    expect(getNextPlayableIndex(0, 1, 'prev')).toBe(0);
  });
});

describe('isEditableTarget', () => {
  it('detects form inputs and contenteditable targets', () => {
    expect(isEditableTarget({ tagName: 'INPUT' })).toBe(true);
    expect(isEditableTarget({ tagName: 'textarea' })).toBe(true);
    expect(isEditableTarget({ tagName: 'SELECT' })).toBe(true);
    expect(isEditableTarget({ tagName: 'DIV', isContentEditable: true })).toBe(true);
  });

  it('returns false for buttons, non-editable elements, and null', () => {
    expect(isEditableTarget({ tagName: 'BUTTON' })).toBe(false);
    expect(isEditableTarget({ tagName: 'DIV', isContentEditable: false })).toBe(false);
    expect(isEditableTarget({ tagName: 'BODY' })).toBe(false);
    expect(isEditableTarget(null)).toBe(false);
    expect(isEditableTarget(undefined)).toBe(false);
  });
});

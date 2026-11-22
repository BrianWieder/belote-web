import { describe, it, expect } from 'vitest';
import { createInitialState, applyAction } from '../../game/engine';
import { cardToString } from '../../game/types';
import { getPlayableCards } from '../../game/validation';
import { detectTrumpAnnouncement } from '../detectTrumpAnnouncement';

describe('detectTrumpAnnouncement', () => {
  it('returns info on bidding-round1 -> playing transition', () => {
    const initial = createInitialState('test', 0);
    const taker = initial.currentPlayer;
    const expectedSuit = initial.trumpCard!.suit;
    const playing = applyAction(initial, taker, { type: 'bid-take' });

    expect(detectTrumpAnnouncement(initial, playing)).toEqual({
      suit: expectedSuit,
      taker,
      round: 1,
    });
  });

  it('returns info on bidding-round2 -> playing transition', () => {
    const initial = createInitialState('test', 0);
    let r2 = applyAction(initial, initial.currentPlayer, { type: 'bid-pass' });
    r2 = applyAction(r2, r2.currentPlayer, { type: 'bid-pass' });
    const chosenSuit = r2.trumpCard!.suit === 'hearts' ? 'spades' : 'hearts';
    const taker = r2.currentPlayer;
    const playing = applyAction(r2, taker, { type: 'bid-choose', suit: chosenSuit });

    expect(detectTrumpAnnouncement(r2, playing)).toEqual({
      suit: chosenSuit,
      taker,
      round: 1,
    });
  });

  it('returns info on bidding-forced -> playing transition', () => {
    const initial = createInitialState('test', 0);
    let forced = applyAction(initial, initial.currentPlayer, { type: 'bid-pass' });
    forced = applyAction(forced, forced.currentPlayer, { type: 'bid-pass' });
    forced = applyAction(forced, forced.currentPlayer, { type: 'bid-pass' });
    forced = applyAction(forced, forced.currentPlayer, { type: 'bid-pass' });

    const taker = forced.currentPlayer;
    const chosenSuit = initial.trumpCard!.suit;
    const playing = applyAction(forced, taker, { type: 'bid-choose', suit: chosenSuit });

    expect(detectTrumpAnnouncement(forced, playing)).toEqual({
      suit: chosenSuit,
      taker,
      round: 1,
    });
  });

  it('returns null when hydrating directly into playing from null', () => {
    const initial = createInitialState('test', 0);
    const playing = applyAction(initial, initial.currentPlayer, { type: 'bid-take' });

    expect(detectTrumpAnnouncement(null, playing)).toBeNull();
  });

  it('returns null during playing -> playing card actions', () => {
    const initial = createInitialState('test', 0);
    const playing = applyAction(initial, initial.currentPlayer, { type: 'bid-take' });
    const playable = getPlayableCards(playing);
    const nextPlay = applyAction(playing, playing.currentPlayer, {
      type: 'play-card',
      card: cardToString(playable[0]),
    });

    expect(detectTrumpAnnouncement(playing, nextPlay)).toBeNull();
  });
});

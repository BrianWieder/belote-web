import { describe, it, expect } from 'vitest';
import { createInitialState, applyAction, startNewRound } from '../../game/engine';
import { cardToString } from '../../game/types';
import { getPlayableCards } from '../../game/validation';
import {
  DEFAULT_DOCUMENT_TITLE,
  TURN_ALERT_DOCUMENT_TITLE,
  detectGameFeedbackEvents,
  getTurnDocumentTitle,
} from '../gameFeedbackTransitions';

describe('detectGameFeedbackEvents', () => {
  it('fires deal sound on a freshly initialized game, not on mid-match hydration', () => {
    const initial = createInitialState('feedback-seed', 0);
    expect(detectGameFeedbackEvents(null, initial, 0)).toEqual({
      deal: true,
      cardSnap: false,
      trickWin: null,
      belote: false,
      turnPing: false,
    });

    const resumed = applyAction(initial, initial.currentPlayer, { type: 'bid-take' });
    expect(detectGameFeedbackEvents(null, resumed, 0)).toEqual({
      deal: false,
      cardSnap: false,
      trickWin: null,
      belote: false,
      turnPing: false,
    });
  });

  it('fires turnPing when opponent passes in bidding and local player gets the turn', () => {
    // Dealer 0 => player 1 acts first. Local player is 0.
    const initial = createInitialState('pass-seed', 0);
    expect(initial.currentPlayer).toBe(1);

    const afterPass = applyAction(initial, 1, { type: 'bid-pass' });
    expect(afterPass.currentPlayer).toBe(0);

    expect(detectGameFeedbackEvents(initial, afterPass, 0)).toEqual({
      deal: false,
      cardSnap: false,
      trickWin: null,
      belote: false,
      turnPing: true,
    });

    // From player 1's perspective (who just passed), turnPing is false.
    expect(detectGameFeedbackEvents(initial, afterPass, 1).turnPing).toBe(false);
  });

  it('fires deal sound when bidding completes and transitions to playing', () => {
    // Dealer 0 => player 1 bids first and takes; player 1 also leads first trick.
    const initial = createInitialState('test', 0);
    expect(initial.trumpCard?.rank).not.toBe('J');
    const playing = applyAction(initial, 1, { type: 'bid-take' });

    // Local player 1 already had the turn when taking, so no redundant turnPing.
    expect(detectGameFeedbackEvents(initial, playing, 1)).toEqual({
      deal: true,
      cardSnap: false,
      trickWin: null,
      belote: false,
      turnPing: false,
    });

    // If dealer (0) takes in round 1 after non-dealer (1) passed, player 1 leads:
    // player 1 gets both deal and turnPing.
    const afterPass = applyAction(initial, 1, { type: 'bid-pass' });
    expect(afterPass.currentPlayer).toBe(0);
    const dealerTook = applyAction(afterPass, 0, { type: 'bid-take' });
    expect(dealerTook.phase).toBe('playing');
    expect(detectGameFeedbackEvents(afterPass, dealerTook, 1)).toEqual({
      deal: true,
      cardSnap: false,
      trickWin: null,
      belote: false,
      turnPing: true,
    });
  });

  it('fires cardSnap and turnPing on first trick card, and cardSnap + trickWin on second card', () => {
    const initial = createInitialState('trick-sound-seed', 0);
    const playing = applyAction(initial, 1, { type: 'bid-take' });
    // Player 1 leads, local player is 0.
    const leadCard = getPlayableCards(playing)[0];
    const afterLead = applyAction(playing, 1, {
      type: 'play-card',
      card: cardToString(leadCard),
    });

    expect(detectGameFeedbackEvents(playing, afterLead, 0)).toEqual({
      deal: false,
      cardSnap: true,
      trickWin: null,
      belote: false,
      turnPing: true,
    });

    // Player 0 replies to complete the trick.
    const replyCard = getPlayableCards(afterLead)[0];
    const afterReply = applyAction(afterLead, 0, {
      type: 'play-card',
      card: cardToString(replyCard),
    });

    const winner = afterReply.tricks[0].winner;
    expect(detectGameFeedbackEvents(afterLead, afterReply, 0)).toEqual({
      deal: false,
      cardSnap: true,
      trickWin: { wonByLocal: winner === 0 },
      belote: false,
      turnPing: false,
    });
  });

  it('detects belote and rebelote declarations on card play', () => {
    const initial = createInitialState('belote-fanfare-seed', 0);
    const playing = applyAction(initial, 1, { type: 'bid-take' });
    const trump = playing.trumpSuit!;

    // Craft a valid state where player 1 holds both K and Q of trump in hand.
    const state = structuredClone(playing);
    state.hands[1] = [
      { suit: trump, rank: 'K' },
      { suit: trump, rank: 'Q' },
    ];
    state.tableau[1] = [
      { faceDown: null, faceUp: null },
      { faceDown: null, faceUp: null },
      { faceDown: null, faceUp: null },
      { faceDown: null, faceUp: null },
    ];

    const afterBelote = applyAction(state, 1, {
      type: 'play-card',
      card: cardToString({ suit: trump, rank: 'K' }),
    });
    expect(afterBelote.beloteDeclared[1]).toBe(true);
    expect(detectGameFeedbackEvents(state, afterBelote, 0).belote).toBe(true);
    expect(detectGameFeedbackEvents(state, afterBelote, 1).belote).toBe(true);

    // Finish trick 1 so player 1 can play Q of trump for Rebelote.
    const reply = getPlayableCards(afterBelote)[0];
    const afterTrick1 = applyAction(afterBelote, 0, {
      type: 'play-card',
      card: cardToString(reply),
    });
    // Ensure player 1 leads trick 2 to test rebelote.
    const beforeRebelote = structuredClone(afterTrick1);
    beforeRebelote.currentPlayer = 1;
    beforeRebelote.currentTrick = { cards: [null, null], leader: 1 };

    const afterRebelote = applyAction(beforeRebelote, 1, {
      type: 'play-card',
      card: cardToString({ suit: trump, rank: 'Q' }),
    });
    expect(afterRebelote.rebeloteDeclared[1]).toBe(true);
    expect(detectGameFeedbackEvents(beforeRebelote, afterRebelote, 0).belote).toBe(true);
  });

  it('fires deal sound when starting a new round from round-over', () => {
    const initial = createInitialState('next-round-seed', 0);
    const roundOver = { ...initial, phase: 'round-over' as const };
    const nextRoundState = startNewRound(roundOver);

    // Dealer rotated from 0 to 1 => player 0 is non-dealer and acts first.
    expect(nextRoundState.currentPlayer).toBe(0);
    expect(detectGameFeedbackEvents(roundOver, nextRoundState, 0)).toEqual({
      deal: true,
      cardSnap: false,
      trickWin: null,
      belote: false,
      turnPing: true,
    });
    expect(detectGameFeedbackEvents(roundOver, nextRoundState, 1)).toEqual({
      deal: true,
      cardSnap: false,
      trickWin: null,
      belote: false,
      turnPing: false,
    });
  });

  it('ignores multi-sequence resync jumps', () => {
    const initial = createInitialState('resync-jump-seed', 0);
    const jumped = { ...initial, phase: 'playing' as const, sequenceNumber: 12 };

    expect(detectGameFeedbackEvents(initial, jumped, 0)).toEqual({
      deal: false,
      cardSnap: false,
      trickWin: null,
      belote: false,
      turnPing: false,
    });
  });
});

describe('getTurnDocumentTitle', () => {
  it('shows turn alert title only when hidden and local player has an active turn', () => {
    // Dealer 0 => player 1 has the opening turn.
    const bidding = createInitialState('title-seed', 0);

    // Hidden + local player's turn (player 1) => alert title.
    expect(getTurnDocumentTitle(bidding, 1, true)).toBe(TURN_ALERT_DOCUMENT_TITLE);

    // Visible + local player's turn => default title.
    expect(getTurnDocumentTitle(bidding, 1, false)).toBe(DEFAULT_DOCUMENT_TITLE);

    // Hidden + opponent's turn (local player 0) => default title.
    expect(getTurnDocumentTitle(bidding, 0, true)).toBe(DEFAULT_DOCUMENT_TITLE);

    // Playing phase, hidden, local player's turn => alert title.
    const playing = applyAction(bidding, 1, { type: 'bid-take' });
    expect(getTurnDocumentTitle(playing, 1, true)).toBe(TURN_ALERT_DOCUMENT_TITLE);

    // Non-turn phases (round-over, game-over, null) => default title even when hidden.
    expect(
      getTurnDocumentTitle({ ...playing, phase: 'round-over' }, 1, true),
    ).toBe(DEFAULT_DOCUMENT_TITLE);
    expect(
      getTurnDocumentTitle({ ...playing, phase: 'game-over' }, 1, true),
    ).toBe(DEFAULT_DOCUMENT_TITLE);
    expect(getTurnDocumentTitle(null, 1, true)).toBe(DEFAULT_DOCUMENT_TITLE);
  });
});

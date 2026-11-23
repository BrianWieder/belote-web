import { describe, it, expect } from 'vitest';
import { createInitialState, applyAction, startNewRound } from '../engine';
import { chooseBotAction, evaluateSuitForBidding, type BotDifficulty } from '../bot';
import { getPlayableCards } from '../validation';
import { cardToString, type Card, type GameState, type PlayerID, type Suit } from '../types';

function makePlayingState(overrides: Partial<GameState> = {}): GameState {
  const base = createInitialState('bot-unit-seed', 0);
  const taken = applyAction(base, 1, { type: 'bid-take' });
  return {
    ...taken,
    ...overrides,
  };
}

describe('bot AI engine', () => {
  describe('bidding round 1', () => {
    it('always takes when a Jack is turned up (forced Jack rule)', () => {
      const state = createInitialState('bot-jack-test', 0);
      state.currentPlayer = 1;
      state.trumpCard = { suit: 'hearts', rank: 'J' };
      // Even with an otherwise terrible hand of 7s and 8s
      state.hands[1] = [
        { suit: 'clubs', rank: '7' },
        { suit: 'clubs', rank: '8' },
        { suit: 'diamonds', rank: '7' },
        { suit: 'diamonds', rank: '8' },
        { suit: 'spades', rank: '7' },
      ];

      expect(chooseBotAction(state, 1, 'smart')).toEqual({ type: 'bid-take' });
      expect(chooseBotAction(state, 1, 'casual')).toEqual({ type: 'bid-take' });

      const next = applyAction(state, 1, chooseBotAction(state, 1, 'smart'));
      expect(next.sequenceNumber).toBe(state.sequenceNumber + 1);
      expect(next.phase).toBe('playing');
    });

    it('takes with a strong trump hand and passes with a weak hand', () => {
      const strongState = createInitialState('bot-r1-strong', 0);
      strongState.currentPlayer = 1;
      strongState.trumpCard = { suit: 'spades', rank: '9' };
      strongState.hands[1] = [
        { suit: 'spades', rank: 'J' },
        { suit: 'spades', rank: '7' },
        { suit: 'hearts', rank: 'A' },
        { suit: 'clubs', rank: '8' },
        { suit: 'diamonds', rank: '7' },
      ];

      expect(chooseBotAction(strongState, 1, 'smart')).toEqual({ type: 'bid-take' });
      expect(chooseBotAction(strongState, 1, 'casual')).toEqual({ type: 'bid-take' });

      const weakState = createInitialState('bot-r1-weak', 0);
      weakState.currentPlayer = 1;
      weakState.trumpCard = { suit: 'spades', rank: '7' };
      weakState.hands[1] = [
        { suit: 'hearts', rank: '7' },
        { suit: 'hearts', rank: '8' },
        { suit: 'clubs', rank: '8' },
        { suit: 'diamonds', rank: '7' },
        { suit: 'diamonds', rank: '9' },
      ];

      expect(chooseBotAction(weakState, 1, 'smart')).toEqual({ type: 'bid-pass' });
      expect(chooseBotAction(weakState, 1, 'casual')).toEqual({ type: 'bid-pass' });
    });

    it('uses a looser take threshold in casual mode than smart mode', () => {
      const borderline = createInitialState('bot-r1-borderline', 0);
      borderline.currentPlayer = 1;
      borderline.trumpCard = { suit: 'hearts', rank: '9' };
      // 9 of trump (22) + 7 of trump (2) + side Ace (10) = 34 (>= 31 casual, < 38 smart)
      borderline.hands[1] = [
        { suit: 'hearts', rank: '7' },
        { suit: 'clubs', rank: 'A' },
        { suit: 'clubs', rank: '8' },
        { suit: 'diamonds', rank: '7' },
        { suit: 'spades', rank: '8' },
      ];

      const score = evaluateSuitForBidding(
        [...borderline.hands[1], borderline.trumpCard],
        'hearts',
      );
      expect(score).toBe(34);
      expect(chooseBotAction(borderline, 1, 'casual')).toEqual({ type: 'bid-take' });
      expect(chooseBotAction(borderline, 1, 'smart')).toEqual({ type: 'bid-pass' });
    });
  });

  describe('bidding round 2', () => {
    it('never selects the excluded round-1 trumpCard suit', () => {
      const state = createInitialState('bot-r2-exclude', 0);
      state.phase = 'bidding-round2';
      state.biddingRound = 2;
      state.currentPlayer = 1;
      state.trumpCard = { suit: 'hearts', rank: 'A' };
      // Loaded with hearts (excluded), weak in everything else
      state.hands[1] = [
        { suit: 'hearts', rank: 'J' },
        { suit: 'hearts', rank: '9' },
        { suit: 'hearts', rank: '10' },
        { suit: 'hearts', rank: 'K' },
        { suit: 'clubs', rank: '7' },
      ];

      const action = chooseBotAction(state, 1, 'smart');
      expect(action).toEqual({ type: 'bid-pass' });
    });

    it('chooses the strongest legal non-excluded suit when above threshold', () => {
      const state = createInitialState('bot-r2-choose', 0);
      state.phase = 'bidding-round2';
      state.biddingRound = 2;
      state.currentPlayer = 1;
      state.trumpCard = { suit: 'hearts', rank: '7' };
      state.hands[1] = [
        { suit: 'clubs', rank: 'J' },
        { suit: 'clubs', rank: '9' },
        { suit: 'clubs', rank: '8' },
        { suit: 'spades', rank: 'A' },
        { suit: 'diamonds', rank: '7' },
      ];

      const action = chooseBotAction(state, 1, 'smart');
      expect(action).toEqual({ type: 'bid-choose', suit: 'clubs' });

      const next = applyAction(state, 1, action);
      expect(next.sequenceNumber).toBe(state.sequenceNumber + 1);
      expect(next.trumpSuit).toBe('clubs');
    });
  });

  describe('bidding forced', () => {
    it('evaluates full 8-card hand across all 4 suits and picks the best suit', () => {
      const state = createInitialState('bot-forced', 0);
      state.phase = 'bidding-forced';
      state.biddingRound = 2;
      state.currentPlayer = 1;
      state.taker = 1;
      state.trumpCard = null;
      state.hands[1] = [
        { suit: 'diamonds', rank: 'J' },
        { suit: 'diamonds', rank: '9' },
        { suit: 'diamonds', rank: 'A' },
        { suit: 'diamonds', rank: '7' },
        { suit: 'spades', rank: 'A' },
        { suit: 'clubs', rank: '8' },
        { suit: 'hearts', rank: '7' },
        { suit: 'hearts', rank: '8' },
      ];

      const action = chooseBotAction(state, 1, 'smart');
      expect(action).toEqual({ type: 'bid-choose', suit: 'diamonds' });

      const next = applyAction(state, 1, action);
      expect(next.sequenceNumber).toBe(state.sequenceNumber + 1);
      expect(next.phase).toBe('playing');
      expect(next.trumpSuit).toBe('diamonds');
    });
  });

  describe('playing heuristics & anti-cheat', () => {
    it('plays immediately when only one legal card exists', () => {
      const state = makePlayingState({
        trumpSuit: 'spades',
        currentPlayer: 1,
        currentTrick: {
          cards: [{ suit: 'hearts', rank: 'A' }, null],
          leader: 0,
        },
        hands: [
          [{ suit: 'clubs', rank: '7' }],
          [
            { suit: 'hearts', rank: '7' },
            { suit: 'spades', rank: 'J' },
          ],
        ],
        tableau: [
          [
            { faceDown: null, faceUp: null },
            { faceDown: null, faceUp: null },
            { faceDown: null, faceUp: null },
            { faceDown: null, faceUp: null },
          ],
          [
            { faceDown: null, faceUp: null },
            { faceDown: null, faceUp: null },
            { faceDown: null, faceUp: null },
            { faceDown: null, faceUp: null },
          ],
        ],
      });

      expect(getPlayableCards(state)).toHaveLength(1);
      expect(chooseBotAction(state, 1, 'smart')).toEqual({
        type: 'play-card',
        card: '7_hearts',
      });
    });

    it('smart bot leads master trump as taker to draw remaining trumps', () => {
      const state = makePlayingState({
        trumpSuit: 'spades',
        taker: 1,
        currentPlayer: 1,
        currentTrick: { cards: [null, null], leader: 1 },
        tricks: [],
        hands: [
          [{ suit: 'spades', rank: '9' }],
          [
            { suit: 'spades', rank: 'J' },
            { suit: 'spades', rank: '8' },
            { suit: 'hearts', rank: '10' },
            { suit: 'clubs', rank: '7' },
          ],
        ],
        tableau: [
          [
            { faceDown: null, faceUp: { suit: 'spades', rank: 'Q' } },
            { faceDown: null, faceUp: null },
            { faceDown: null, faceUp: null },
            { faceDown: null, faceUp: null },
          ],
          [
            { faceDown: null, faceUp: null },
            { faceDown: null, faceUp: null },
            { faceDown: null, faceUp: null },
            { faceDown: null, faceUp: null },
          ],
        ],
      });

      expect(chooseBotAction(state, 1, 'smart')).toEqual({
        type: 'play-card',
        card: 'J_spades',
      });
    });

    it('smart bot avoids leading a bare 10 when the Ace is unseen', () => {
      const state = makePlayingState({
        trumpSuit: 'spades',
        taker: 0,
        currentPlayer: 1,
        currentTrick: { cards: [null, null], leader: 1 },
        tricks: [],
        hands: [
          [{ suit: 'hearts', rank: 'A' }],
          [
            { suit: 'hearts', rank: '10' },
            { suit: 'clubs', rank: '7' },
          ],
        ],
        tableau: [
          [
            { faceDown: null, faceUp: null },
            { faceDown: null, faceUp: null },
            { faceDown: null, faceUp: null },
            { faceDown: null, faceUp: null },
          ],
          [
            { faceDown: null, faceUp: null },
            { faceDown: null, faceUp: null },
            { faceDown: null, faceUp: null },
            { faceDown: null, faceUp: null },
          ],
        ],
      });

      expect(chooseBotAction(state, 1, 'smart')).toEqual({
        type: 'play-card',
        card: '7_clubs',
      });
    });

    it('smart bot sheds lowest-value card when forced to lose a trick', () => {
      const state = makePlayingState({
        trumpSuit: 'spades',
        taker: 0,
        currentPlayer: 1,
        currentTrick: {
          cards: [{ suit: 'spades', rank: 'J' }, null],
          leader: 0,
        },
        tricks: [],
        hands: [
          [{ suit: 'clubs', rank: '7' }],
          [
            { suit: 'hearts', rank: 'A' },
            { suit: 'hearts', rank: '10' },
            { suit: 'diamonds', rank: '8' },
          ],
        ],
        tableau: [
          [
            { faceDown: null, faceUp: null },
            { faceDown: null, faceUp: null },
            { faceDown: null, faceUp: null },
            { faceDown: null, faceUp: null },
          ],
          [
            { faceDown: null, faceUp: null },
            { faceDown: null, faceUp: null },
            { faceDown: null, faceUp: null },
            { faceDown: null, faceUp: null },
          ],
        ],
      });

      expect(chooseBotAction(state, 1, 'smart')).toEqual({
        type: 'play-card',
        card: '8_diamonds',
      });
    });

    it('smart bot wins a valuable trick with the cheapest winning trump', () => {
      const state = makePlayingState({
        trumpSuit: 'spades',
        taker: 1,
        currentPlayer: 1,
        currentTrick: {
          cards: [{ suit: 'hearts', rank: 'A' }, null],
          leader: 0,
        },
        tricks: [],
        hands: [
          [{ suit: 'clubs', rank: '7' }],
          [
            { suit: 'spades', rank: 'J' },
            { suit: 'spades', rank: '9' },
            { suit: 'spades', rank: '7' },
          ],
        ],
        tableau: [
          [
            { faceDown: null, faceUp: null },
            { faceDown: null, faceUp: null },
            { faceDown: null, faceUp: null },
            { faceDown: null, faceUp: null },
          ],
          [
            { faceDown: null, faceUp: null },
            { faceDown: null, faceUp: null },
            { faceDown: null, faceUp: null },
            { faceDown: null, faceUp: null },
          ],
        ],
      });

      expect(chooseBotAction(state, 1, 'smart')).toEqual({
        type: 'play-card',
        card: '7_spades',
      });
    });

    it('never peeks at hidden opponent hand or face-down tableau cards', () => {
      const stateA = makePlayingState({ currentPlayer: 1 });
      const stateB = structuredClone(stateA);

      // Scramble all hidden information: opponent's hand, deck, and every face-down card
      const fakeCards: Card[] = [
        { suit: 'clubs', rank: 'A' },
        { suit: 'diamonds', rank: 'A' },
        { suit: 'hearts', rank: 'A' },
        { suit: 'spades', rank: 'A' },
      ];
      stateB.hands[0] = stateB.hands[0].map((_, i) => fakeCards[i % fakeCards.length]);
      stateB.deck = [];
      for (const p of [0, 1] as PlayerID[]) {
        for (let slot = 0; slot < 4; slot++) {
          if (stateB.tableau[p][slot].faceDown) {
            stateB.tableau[p][slot].faceDown = fakeCards[slot];
          }
        }
      }

      const prohibitedReads: string[] = [];
      const wrapCard = (card: Card, label: string): Card =>
        new Proxy(card, {
          get(target, prop, receiver) {
            prohibitedReads.push(`${label}.${String(prop)}`);
            return Reflect.get(target, prop, receiver);
          },
        });

      const trackedState = structuredClone(stateA);
      trackedState.hands[0] = new Proxy(
        trackedState.hands[0].map((card, i) => wrapCard(card, `opponentHand[${i}]`)),
        {
          get(target, prop, receiver) {
            prohibitedReads.push(`opponentHand.${String(prop)}`);
            return Reflect.get(target, prop, receiver);
          },
        },
      );
      trackedState.deck = new Proxy(
        trackedState.deck.map((card, i) => wrapCard(card, `deck[${i}]`)),
        {
          get(target, prop, receiver) {
            prohibitedReads.push(`deck.${String(prop)}`);
            return Reflect.get(target, prop, receiver);
          },
        },
      );
      for (const p of [0, 1] as PlayerID[]) {
        for (let slot = 0; slot < 4; slot++) {
          const hidden = trackedState.tableau[p][slot].faceDown;
          if (hidden) {
            // Presence check (slot.faceDown !== null) is allowed; reading card suit/rank is prohibited.
            trackedState.tableau[p][slot].faceDown = wrapCard(
              hidden,
              `tableau[${p}][${slot}].faceDown`,
            );
          }
        }
      }

      const smartTracked = chooseBotAction(trackedState, 1, 'smart');
      const casualTracked = chooseBotAction(trackedState, 1, 'casual');

      expect(prohibitedReads).toEqual([]);
      expect(smartTracked).toEqual(chooseBotAction(stateB, 1, 'smart'));
      expect(casualTracked).toEqual(chooseBotAction(stateB, 1, 'casual'));
    });

    it('casual random branch can select every legal card index including index 2 of 4', () => {
      const base = makePlayingState({
        trumpSuit: 'spades',
        taker: 0,
        currentPlayer: 1,
        currentTrick: { cards: [null, null], leader: 1 },
        tricks: [],
        hands: [
          [{ suit: 'clubs', rank: '7' }],
          [
            { suit: 'hearts', rank: 'A' }, // index 0 (greedy pick)
            { suit: 'diamonds', rank: 'K' }, // index 1
            { suit: 'clubs', rank: 'Q' }, // index 2
            { suit: 'hearts', rank: '7' }, // index 3
          ],
        ],
        tableau: [
          [
            { faceDown: null, faceUp: null },
            { faceDown: null, faceUp: null },
            { faceDown: null, faceUp: null },
            { faceDown: null, faceUp: null },
          ],
          [
            { faceDown: null, faceUp: null },
            { faceDown: null, faceUp: null },
            { faceDown: null, faceUp: null },
            { faceDown: null, faceUp: null },
          ],
        ],
      });

      const chosenCards = new Set<string>();
      for (let i = 0; i < 200; i++) {
        const action = chooseBotAction(
          { ...base, seed: `casual-dist-${i}`, sequenceNumber: i + 1 },
          1,
          'casual',
        );
        if (action.type === 'play-card') {
          chosenCards.add(action.card);
        }
      }

      expect(chosenCards.has('A_hearts')).toBe(true);
      expect(chosenCards.has('K_diamonds')).toBe(true);
      expect(chosenCards.has('Q_clubs')).toBe(true);
      expect(chosenCards.has('7_hearts')).toBe(true);
    });

    it('rejects off-turn and non-actionable phase calls to chooseBotAction', () => {
      const biddingState = createInitialState('off-turn-bid', 0);
      // Dealer 0 => player 1 acts first; asking for player 0 must throw.
      expect(biddingState.currentPlayer).toBe(1);
      expect(() => chooseBotAction(biddingState, 0, 'smart')).toThrow(/out of turn/i);
      expect(() => chooseBotAction(biddingState, 0, 'casual')).toThrow(/out of turn/i);

      const playingState = makePlayingState({ currentPlayer: 0 });
      expect(() => chooseBotAction(playingState, 1, 'smart')).toThrow(/out of turn/i);
      expect(() => chooseBotAction(playingState, 1, 'casual')).toThrow(/out of turn/i);

      const roundOverState = makePlayingState({ phase: 'round-over', currentPlayer: 1 });
      expect(() => chooseBotAction(roundOverState, 1, 'smart')).toThrow(/non-actionable phase/i);
    });
  });

  describe('full game simulations', () => {
    const matchups: Array<{ p0: BotDifficulty; p1: BotDifficulty; count: number }> = [
      { p0: 'smart', p1: 'smart', count: 10 },
      { p0: 'casual', p1: 'casual', count: 10 },
      { p0: 'smart', p1: 'casual', count: 10 },
    ];

    it('completes 30 full 16-trick rounds with 100% legal moves and zero stuck states', () => {
      let totalRounds = 0;

      for (const { p0, p1, count } of matchups) {
        for (let i = 0; i < count; i++) {
          const seed = `sim-${p0}-vs-${p1}-${i}`;
          const dealer: PlayerID = (i % 2) as PlayerID;
          let state = createInitialState(seed, dealer);
          let steps = 0;

          while (state.phase !== 'round-over' && state.phase !== 'game-over') {
            steps++;
            expect(steps).toBeLessThan(60); // max 5 bids + 32 plays = 37

            const actor = state.currentPlayer;
            const difficulty = actor === 0 ? p0 : p1;
            const action = chooseBotAction(state, actor, difficulty);

            if (state.phase === 'playing') {
              const legalCards = getPlayableCards(state).map(cardToString);
              expect(action.type).toBe('play-card');
              if (action.type === 'play-card') {
                expect(legalCards).toContain(action.card);
              }
            } else if (state.phase === 'bidding-round2' && action.type === 'bid-choose') {
              expect(action.suit).not.toBe(state.trumpCard?.suit);
            } else if (state.phase === 'bidding-forced') {
              expect(action.type).toBe('bid-choose');
            }

            const prevSeq = state.sequenceNumber;
            const next = applyAction(state, actor, action);
            expect(next.sequenceNumber).toBe(prevSeq + 1);
            state = next;
          }

          expect(state.tricks).toHaveLength(16);
          expect(state.roundScores).toHaveLength(1);
          expect(state.hands[0]).toHaveLength(0);
          expect(state.hands[1]).toHaveLength(0);
          totalRounds++;
        }
      }

      expect(totalRounds).toBe(30);
    });

    it('completes full multi-round matches to game-over (1000+ points)', () => {
      for (let matchIdx = 0; matchIdx < 5; matchIdx++) {
        let state = createInitialState(`full-match-${matchIdx}`, (matchIdx % 2) as PlayerID);
        let rounds = 0;

        while (state.phase !== 'game-over') {
          rounds++;
          expect(rounds).toBeLessThan(30);

          while (state.phase !== 'round-over' && state.phase !== 'game-over') {
            const actor = state.currentPlayer;
            const difficulty: BotDifficulty = actor === 0 ? 'smart' : 'casual';
            const action = chooseBotAction(state, actor, difficulty);
            const prevSeq = state.sequenceNumber;
            state = applyAction(state, actor, action);
            expect(state.sequenceNumber).toBe(prevSeq + 1);
          }

          if (state.phase === 'round-over') {
            state = startNewRound(state);
          }
        }

        expect(state.phase).toBe('game-over');
        expect(Math.max(state.gameScore[0], state.gameScore[1])).toBeGreaterThanOrEqual(1000);
      }
    });

    it('handles forced-bid suit choices across all 4 suits cleanly', () => {
      const suitsSeen = new Set<Suit>();
      for (const suit of ['hearts', 'diamonds', 'clubs', 'spades'] as Suit[]) {
        const state = createInitialState(`forced-suit-${suit}`, 0);
        state.phase = 'bidding-forced';
        state.biddingRound = 2;
        state.currentPlayer = 1;
        state.taker = 1;
        state.trumpCard = null;
        state.hands[1] = [
          { suit, rank: 'J' },
          { suit, rank: '9' },
          { suit, rank: 'A' },
          { suit, rank: '10' },
          { suit, rank: 'K' },
          { suit, rank: 'Q' },
          { suit, rank: '8' },
          { suit, rank: '7' },
        ];
        const action = chooseBotAction(state, 1, 'smart');
        expect(action).toEqual({ type: 'bid-choose', suit });
        if (action.type === 'bid-choose') {
          suitsSeen.add(action.suit);
        }
      }
      expect(suitsSeen.size).toBe(4);
    });
  });
});

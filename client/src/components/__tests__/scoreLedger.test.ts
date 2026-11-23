import { describe, it, expect } from 'vitest';
import type { RoundScore } from '../../game/types';
import { buildScoreLedger } from '../scoreLedger';

function makeRound(overrides: Partial<RoundScore> = {}): RoundScore {
  return {
    trickPoints: [100, 52],
    beloteBonus: [0, 0],
    lastTrickBonus: [10, 0],
    dedans: false,
    taker: 0,
    trumpSuit: 'hearts',
    finalPoints: [110, 52],
    ...overrides,
  };
}

describe('buildScoreLedger', () => {
  it('returns an empty summary when no rounds have been completed', () => {
    expect(buildScoreLedger([], 0)).toEqual({
      rows: [],
      totalMyPoints: 0,
      totalOppPoints: 0,
      roundsWonByMe: 0,
      roundsWonByOpp: 0,
      dedansCount: 0,
    });
  });

  it('maps taker, round points, and running totals for localPlayer 0 and 1', () => {
    const rounds: RoundScore[] = [
      makeRound({
        trumpSuit: 'spades',
        taker: 0,
        finalPoints: [112, 50],
      }),
      makeRound({
        trumpSuit: 'diamonds',
        taker: 1,
        finalPoints: [42, 120],
      }),
    ];

    const p0Ledger = buildScoreLedger(rounds, 0);
    expect(p0Ledger).toEqual({
      rows: [
        {
          roundNumber: 1,
          trumpSuit: 'spades',
          taker: 0,
          takerLabel: 'You',
          dedans: false,
          myBelote: false,
          oppBelote: false,
          beloteOwner: null,
          myRoundPoints: 112,
          oppRoundPoints: 50,
          myCumulative: 112,
          oppCumulative: 50,
        },
        {
          roundNumber: 2,
          trumpSuit: 'diamonds',
          taker: 1,
          takerLabel: 'Opp',
          dedans: false,
          myBelote: false,
          oppBelote: false,
          beloteOwner: null,
          myRoundPoints: 42,
          oppRoundPoints: 120,
          myCumulative: 154,
          oppCumulative: 170,
        },
      ],
      totalMyPoints: 154,
      totalOppPoints: 170,
      roundsWonByMe: 1,
      roundsWonByOpp: 1,
      dedansCount: 0,
    });

    const p1Ledger = buildScoreLedger(rounds, 1);
    expect(p1Ledger.rows[0].takerLabel).toBe('Opp');
    expect(p1Ledger.rows[0].myRoundPoints).toBe(50);
    expect(p1Ledger.rows[0].oppRoundPoints).toBe(112);
    expect(p1Ledger.rows[1].takerLabel).toBe('You');
    expect(p1Ledger.rows[1].myCumulative).toBe(170);
    expect(p1Ledger.rows[1].oppCumulative).toBe(154);
    expect(p1Ledger.totalMyPoints).toBe(170);
    expect(p1Ledger.totalOppPoints).toBe(154);
  });

  it('tracks dedans rounds and belote owners accurately', () => {
    const rounds: RoundScore[] = [
      makeRound({
        trumpSuit: 'clubs',
        taker: 0,
        dedans: true,
        beloteBonus: [20, 0],
        finalPoints: [20, 162],
      }),
      makeRound({
        trumpSuit: 'hearts',
        taker: 1,
        dedans: false,
        beloteBonus: [0, 20],
        finalPoints: [60, 122],
      }),
      makeRound({
        trumpSuit: 'spades',
        taker: 1,
        dedans: true,
        beloteBonus: [0, 0],
        finalPoints: [162, 0],
      }),
    ];

    const ledger = buildScoreLedger(rounds, 0);

    expect(ledger.dedansCount).toBe(2);
    expect(ledger.roundsWonByMe).toBe(1);
    expect(ledger.roundsWonByOpp).toBe(2);

    expect(ledger.rows[0]).toMatchObject({
      roundNumber: 1,
      dedans: true,
      myBelote: true,
      oppBelote: false,
      beloteOwner: 'you',
      myCumulative: 20,
      oppCumulative: 162,
    });

    expect(ledger.rows[1]).toMatchObject({
      roundNumber: 2,
      dedans: false,
      myBelote: false,
      oppBelote: true,
      beloteOwner: 'opp',
      myCumulative: 80,
      oppCumulative: 284,
    });

    expect(ledger.rows[2]).toMatchObject({
      roundNumber: 3,
      dedans: true,
      myBelote: false,
      oppBelote: false,
      beloteOwner: null,
      myCumulative: 242,
      oppCumulative: 284,
    });
  });

  it('handles equal round scores without awarding a round win to either player', () => {
    const rounds: RoundScore[] = [
      makeRound({
        finalPoints: [81, 81],
      }),
    ];

    const ledger = buildScoreLedger(rounds, 0);
    expect(ledger.roundsWonByMe).toBe(0);
    expect(ledger.roundsWonByOpp).toBe(0);
    expect(ledger.totalMyPoints).toBe(81);
    expect(ledger.totalOppPoints).toBe(81);
  });

  it('does not mutate the input roundScores array', () => {
    const rounds: RoundScore[] = [makeRound(), makeRound({ trumpSuit: 'clubs' })];
    const snapshot = structuredClone(rounds);

    buildScoreLedger(rounds, 0);

    expect(rounds).toEqual(snapshot);
  });
});

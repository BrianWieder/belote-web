import type { PlayerID, RoundScore, Suit } from '../game/types';

export interface ScoreLedgerRow {
  roundNumber: number;
  trumpSuit: Suit;
  taker: PlayerID;
  takerLabel: 'You' | 'Opp';
  dedans: boolean;
  capot: boolean;
  myBelote: boolean;
  oppBelote: boolean;
  beloteOwner: 'you' | 'opp' | null;
  myRoundPoints: number;
  oppRoundPoints: number;
  myCumulative: number;
  oppCumulative: number;
}

export interface ScoreLedgerSummary {
  rows: ScoreLedgerRow[];
  totalMyPoints: number;
  totalOppPoints: number;
  roundsWonByMe: number;
  roundsWonByOpp: number;
  dedansCount: number;
}

export function buildScoreLedger(
  roundScores: readonly RoundScore[],
  localPlayer: PlayerID,
): ScoreLedgerSummary {
  const opponent: PlayerID = localPlayer === 0 ? 1 : 0;

  let myCumulative = 0;
  let oppCumulative = 0;
  let roundsWonByMe = 0;
  let roundsWonByOpp = 0;
  let dedansCount = 0;

  const rows: ScoreLedgerRow[] = roundScores.map((round, index) => {
    const myRoundPoints = round.finalPoints[localPlayer];
    const oppRoundPoints = round.finalPoints[opponent];

    myCumulative += myRoundPoints;
    oppCumulative += oppRoundPoints;

    if (myRoundPoints > oppRoundPoints) {
      roundsWonByMe += 1;
    } else if (oppRoundPoints > myRoundPoints) {
      roundsWonByOpp += 1;
    }

    if (round.dedans) {
      dedansCount += 1;
    }

    const myBelote = round.beloteBonus[localPlayer] > 0;
    const oppBelote = round.beloteBonus[opponent] > 0;
    const beloteOwner = myBelote ? 'you' : oppBelote ? 'opp' : null;

    return {
      roundNumber: index + 1,
      trumpSuit: round.trumpSuit,
      taker: round.taker,
      takerLabel: round.taker === localPlayer ? 'You' : 'Opp',
      dedans: round.dedans,
      capot: Boolean(round.capot),
      myBelote,
      oppBelote,
      beloteOwner,
      myRoundPoints,
      oppRoundPoints,
      myCumulative,
      oppCumulative,
    };
  });

  return {
    rows,
    totalMyPoints: myCumulative,
    totalOppPoints: oppCumulative,
    roundsWonByMe,
    roundsWonByOpp,
    dedansCount,
  };
}

import { useEffect, useRef } from 'react';
import { useFocusTrap } from '../hooks/useFocusTrap';
import { DEFAULT_MATCH_OPTIONS, type MatchOptions } from '../game/types';

interface RulesModalProps {
  open: boolean;
  onClose: () => void;
  options?: MatchOptions;
}

interface RankRow {
  trumpRank: string;
  trumpPoints: number;
  nonTrumpRank: string;
  nonTrumpPoints: number;
}

const CARD_VALUES: readonly RankRow[] = [
  { trumpRank: 'J', trumpPoints: 20, nonTrumpRank: 'A', nonTrumpPoints: 11 },
  { trumpRank: '9', trumpPoints: 14, nonTrumpRank: '10', nonTrumpPoints: 10 },
  { trumpRank: 'A', trumpPoints: 11, nonTrumpRank: 'K', nonTrumpPoints: 4 },
  { trumpRank: '10', trumpPoints: 10, nonTrumpRank: 'Q', nonTrumpPoints: 3 },
  { trumpRank: 'K', trumpPoints: 4, nonTrumpRank: 'J', nonTrumpPoints: 2 },
  { trumpRank: 'Q', trumpPoints: 3, nonTrumpRank: '9', nonTrumpPoints: 0 },
  { trumpRank: '8', trumpPoints: 0, nonTrumpRank: '8', nonTrumpPoints: 0 },
  { trumpRank: '7', trumpPoints: 0, nonTrumpRank: '7', nonTrumpPoints: 0 },
];

export function RulesModal({
  open,
  onClose,
  options = DEFAULT_MATCH_OPTIONS,
}: RulesModalProps) {
  const panelRef = useRef<HTMLDivElement>(null);

  useFocusTrap(panelRef, open);

  useEffect(() => {
    if (!open) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      data-testid="rules-modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby="rules-modal-heading"
      onMouseDown={(event) => {
        if (event.button === 0 && event.target === event.currentTarget) onClose();
      }}
      className="fixed inset-0 bg-[#06110c]/75 backdrop-blur-xs flex items-center justify-center z-50 p-3 sm:p-4"
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        onMouseDown={(event) => event.stopPropagation()}
        className="ardoise-panel rounded-2xl p-5 sm:p-6 max-w-lg w-full max-h-[88dvh] overflow-y-auto text-[#efe9dc] focus:outline-none"
      >
        <div className="flex items-start justify-between gap-3 mb-4">
          <div>
            <p className="text-[10px] uppercase tracking-[0.18em] font-semibold text-[#e3ba62]">
              Quick Reference
            </p>
            <h2
              id="rules-modal-heading"
              className="font-display text-xl sm:text-2xl font-semibold leading-tight mt-0.5"
            >
              Belote Maniée Rules
            </h2>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close rules"
            className="btn-slate w-8 h-8 rounded-lg flex items-center justify-center text-base leading-none shrink-0 cursor-pointer"
          >
            <span aria-hidden="true">&times;</span>
          </button>
        </div>

        <div className="space-y-4 text-xs sm:text-[13px] leading-relaxed">
          {/* Card order & point values */}
          <section aria-labelledby="rules-card-values-heading">
            <div className="flex items-baseline justify-between mb-2">
              <h3
                id="rules-card-values-heading"
                className="font-display text-sm sm:text-base font-semibold text-[#e3ba62]"
              >
                Rank Order &amp; Point Values
              </h3>
              <span className="text-[11px] text-[#73907c]">Strongest &rarr; weakest</span>
            </div>

            <div className="tapis-ring rounded-xl overflow-hidden tabular-nums">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-[#efe9dc]/12 text-[11px] uppercase tracking-wider text-[#a4bba9]">
                    <th scope="col" className="py-2 px-3 font-semibold text-[#e3ba62]">
                      Trump
                    </th>
                    <th scope="col" className="py-2 px-3 text-right font-semibold text-[#e3ba62]">
                      Pts
                    </th>
                    <th
                      scope="col"
                      className="py-2 px-3 border-l border-[#efe9dc]/12 font-semibold"
                    >
                      Non-Trump
                    </th>
                    <th scope="col" className="py-2 px-3 text-right font-semibold">
                      Pts
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {CARD_VALUES.map((row) => (
                    <tr
                      key={`${row.trumpRank}-${row.nonTrumpRank}`}
                      className="border-b border-[#efe9dc]/8 last:border-b-0"
                    >
                      <td className="py-1.5 px-3 font-display font-semibold text-[#efe9dc]">
                        {row.trumpRank}
                      </td>
                      <td
                        className={`py-1.5 px-3 text-right font-medium ${
                          row.trumpPoints > 0 ? 'text-[#e3ba62]' : 'text-[#73907c]'
                        }`}
                      >
                        {row.trumpPoints}
                      </td>
                      <td className="py-1.5 px-3 border-l border-[#efe9dc]/12 font-display font-semibold text-[#efe9dc]">
                        {row.nonTrumpRank}
                      </td>
                      <td
                        className={`py-1.5 px-3 text-right font-medium ${
                          row.nonTrumpPoints > 0 ? 'text-[#efe9dc]' : 'text-[#73907c]'
                        }`}
                      >
                        {row.nonTrumpPoints}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {/* Bidding */}
          <section aria-labelledby="rules-bidding-heading" className="tapis-ring rounded-xl p-3.5">
            <h3
              id="rules-bidding-heading"
              className="font-display text-sm sm:text-base font-semibold text-[#e3ba62] mb-1.5"
            >
              Bidding
            </h3>
            <ul className="space-y-1 text-[#a4bba9]">
              <li>
                <strong className="text-[#efe9dc]">Round 1:</strong> Non-dealer acts first —{' '}
                <strong className="text-[#efe9dc]">Take</strong> the turned-up suit or{' '}
                <strong className="text-[#efe9dc]">Pass</strong>.
              </li>
              <li>
                <strong className="text-[#efe9dc]">Jack turned up:</strong> Non-dealer is forced
                to take immediately.
              </li>
              <li>
                <strong className="text-[#efe9dc]">Round 2:</strong> Choose any other suit as
                trump, or pass again.
              </li>
              <li>
                <strong className="text-[#efe9dc]">4 Passes:</strong> Non-dealer takes the
                turned-up card plus 2 from the deck and must choose any suit as trump.
              </li>
            </ul>
          </section>

          {/* Playing */}
          <section aria-labelledby="rules-playing-heading" className="tapis-ring rounded-xl p-3.5">
            <h3
              id="rules-playing-heading"
              className="font-display text-sm sm:text-base font-semibold text-[#e3ba62] mb-1.5"
            >
              Playing
            </h3>
            <ul className="space-y-1 text-[#a4bba9]">
              <li>
                <strong className="text-[#efe9dc]">Follow suit</strong> led whenever able.
              </li>
              <li>
                <strong className="text-[#efe9dc]">Must trump</strong> if unable to follow a
                non-trump suit.
              </li>
              <li>
                <strong className="text-[#efe9dc]">Must overtrump</strong> with a higher trump
                when trump is led, if able.
              </li>
              <li>
                <strong className="text-[#efe9dc]">Open tableau:</strong> 4 face-up cards sit on
                4 face-down cards — playing a face-up card uncovers the card beneath it.
              </li>
            </ul>
          </section>

          {/* Scoring */}
          <section aria-labelledby="rules-scoring-heading" className="tapis-ring rounded-xl p-3.5">
            <h3
              id="rules-scoring-heading"
              className="font-display text-sm sm:text-base font-semibold text-[#e3ba62] mb-1.5"
            >
              Scoring
            </h3>
            <ul className="space-y-1 text-[#a4bba9]">
              <li>
                <strong className="text-[#efe9dc]">162 pts per round:</strong> 152 card points +{' '}
                <strong className="text-[#efe9dc]">10</strong> for winning the last trick.
              </li>
              <li>
                <strong className="text-[#efe9dc]">Belote &amp; Rebelote (+20):</strong> Declared
                automatically when playing both the King and Queen of trump (must win at least one
                trick).
              </li>
              <li>
                <strong className="text-[#efe9dc]">Dedans:</strong> If the taker does not outscore
                the defender, the defender takes all 162 points (including the 10-point last-trick
                bonus; only Belote &amp; Rebelote stays with who declared it).
              </li>
              {options.capotEnabled && (
                <li>
                  <strong className="text-[#efe9dc]">Capot (252 pts):</strong> Winning all 16
                  tricks awards 252 points (152 card points + 100 capot bonus replacing the
                  last-trick bonus, plus 20 if Belote &amp; Rebelote was declared by the capot
                  winner).
                </li>
              )}
              <li>
                <strong className="text-[#efe9dc]">Match:</strong> First to{' '}
                <strong className="text-[#e3ba62]">{options.targetScore.toLocaleString()}</strong>{' '}
                points wins.
              </li>
            </ul>
          </section>
        </div>

        <button
          type="button"
          onClick={onClose}
          className="btn-slate w-full mt-5 py-2.5 rounded-xl text-sm font-semibold cursor-pointer"
        >
          Back to table
        </button>
      </div>
    </div>
  );
}

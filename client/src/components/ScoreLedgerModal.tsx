import { useEffect, useRef } from 'react';
import { useFocusTrap } from '../hooks/useFocusTrap';
import type { PlayerID, RoundScore } from '../game/types';
import { SuitIcon } from './Card';
import { SUIT_NAMES, isRedSuit } from './suits';
import { buildScoreLedger } from './scoreLedger';

interface ScoreLedgerModalProps {
  open: boolean;
  onClose: () => void;
  roundScores: readonly RoundScore[];
  localPlayer: PlayerID;
}

export function ScoreLedgerModal({
  open,
  onClose,
  roundScores,
  localPlayer,
}: ScoreLedgerModalProps) {
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

  const ledger = buildScoreLedger(roundScores, localPlayer);

  return (
    <div
      data-testid="score-ledger-modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby="score-ledger-heading"
      onMouseDown={(event) => {
        if (event.button === 0 && event.target === event.currentTarget) onClose();
      }}
      className="fixed inset-0 bg-[#06110c]/75 backdrop-blur-xs flex items-center justify-center z-50 p-3 sm:p-4"
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        onMouseDown={(event) => event.stopPropagation()}
        className="ardoise-panel rounded-2xl p-5 sm:p-6 max-w-xl w-full max-h-[88dvh] overflow-y-auto text-[#efe9dc] focus:outline-none"
      >
        <div className="flex items-start justify-between gap-3 mb-4">
          <div>
            <p className="text-[10px] uppercase tracking-[0.18em] font-semibold text-[#e3ba62]">
              Match Ardoise
            </p>
            <h2
              id="score-ledger-heading"
              className="font-display text-xl sm:text-2xl font-semibold leading-tight mt-0.5"
            >
              Score Ledger
            </h2>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close score ledger"
            className="btn-slate w-8 h-8 rounded-lg flex items-center justify-center text-base leading-none shrink-0 cursor-pointer"
          >
            <span aria-hidden="true">&times;</span>
          </button>
        </div>

        {ledger.rows.length === 0 ? (
          <div className="tapis-ring rounded-xl px-5 py-8 text-center">
            <p className="font-display text-base text-[#efe9dc]">No completed rounds yet.</p>
            <p className="text-xs text-[#a4bba9] mt-1">
              Each finished round will be tallied here with running totals to 1,000.
            </p>
          </div>
        ) : (
          <div className="tapis-ring rounded-xl overflow-x-auto tabular-nums">
            <table className="w-full text-left border-collapse text-xs sm:text-[13px]">
              <thead>
                <tr className="border-b border-[#efe9dc]/14 text-[10px] sm:text-[11px] uppercase tracking-wider text-[#a4bba9]">
                  <th scope="col" className="py-2.5 pl-3 pr-1.5 font-semibold">
                    Rd
                  </th>
                  <th scope="col" className="py-2.5 px-1.5 font-semibold text-center">
                    Trump
                  </th>
                  <th scope="col" className="py-2.5 px-1.5 font-semibold">
                    Taker
                  </th>
                  <th scope="col" className="py-2.5 px-1.5 font-semibold">
                    Notes
                  </th>
                  <th scope="col" className="py-2.5 px-2 font-semibold text-right">
                    <div>Round</div>
                    <div className="text-[9px] normal-case tracking-normal font-normal text-[#73907c]">
                      You / Opp
                    </div>
                  </th>
                  <th scope="col" className="py-2.5 pl-2 pr-3 font-semibold text-right">
                    <div>Total</div>
                    <div className="text-[9px] normal-case tracking-normal font-normal text-[#73907c]">
                      You / Opp
                    </div>
                  </th>
                </tr>
              </thead>
              <tbody>
                {ledger.rows.map((row) => {
                  const red = isRedSuit(row.trumpSuit);
                  return (
                    <tr
                      key={row.roundNumber}
                      className="border-b border-[#efe9dc]/8 last:border-b-0"
                    >
                      <td className="py-2 pl-3 pr-1.5 text-[#a4bba9] font-medium">
                        {row.roundNumber}
                      </td>
                      <td className="py-2 px-1.5 text-center">
                        <span
                          className={`inline-flex items-center justify-center ${
                            red ? 'text-[#e45a5e]' : 'text-[#efe9dc]'
                          }`}
                          title={SUIT_NAMES[row.trumpSuit]}
                        >
                          <SuitIcon suit={row.trumpSuit} className="w-4 h-4" />
                          <span className="sr-only">{SUIT_NAMES[row.trumpSuit]}</span>
                        </span>
                      </td>
                      <td className="py-2 px-1.5">
                        <span
                          className={
                            row.takerLabel === 'You'
                              ? 'font-medium text-[#efe9dc]'
                              : 'text-[#a4bba9]'
                          }
                        >
                          {row.takerLabel}
                        </span>
                      </td>
                      <td className="py-2 px-1.5">
                        <div className="flex flex-wrap items-center gap-1">
                          {row.dedans && (
                            <span className="inline-flex items-center rounded-full bg-[#5c1619]/75 border border-[#e45a5e]/40 px-1.5 py-[1px] text-[10px] font-medium text-[#f7b4b6]">
                              Dedans
                            </span>
                          )}
                          {row.beloteOwner && (
                            <span
                              title={`Belote & Rebelote (+20) by ${
                                row.beloteOwner === 'you' ? 'You' : 'Opponent'
                              }`}
                              className="inline-flex items-center rounded-full bg-[#d4a84b]/20 border border-[#d4a84b]/45 px-1.5 py-[1px] text-[10px] font-medium text-[#e3ba62]"
                            >
                              Belote
                            </span>
                          )}
                          {!row.dedans && !row.beloteOwner && (
                            <span className="text-[#73907c]">&ndash;</span>
                          )}
                        </div>
                      </td>
                      <td className="py-2 px-2 text-right whitespace-nowrap">
                        <span className="text-[#efe9dc] font-medium">{row.myRoundPoints}</span>
                        <span className="text-[#73907c] mx-1">/</span>
                        <span className="text-[#a4bba9]">{row.oppRoundPoints}</span>
                      </td>
                      <td className="py-2 pl-2 pr-3 text-right whitespace-nowrap">
                        <span className="text-[#e3ba62] font-semibold">{row.myCumulative}</span>
                        <span className="text-[#73907c] mx-1">/</span>
                        <span className="text-[#efe9dc]">{row.oppCumulative}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t border-[#efe9dc]/16 bg-[#0b1f16]/45 font-display font-semibold">
                  <td colSpan={4} className="py-2.5 pl-3 pr-2 text-xs text-[#a4bba9]">
                    Match total ({ledger.rows.length}{' '}
                    {ledger.rows.length === 1 ? 'round' : 'rounds'})
                  </td>
                  <td className="py-2.5 px-2" />
                  <td className="py-2.5 pl-2 pr-3 text-right whitespace-nowrap text-sm">
                    <span className="text-[#e3ba62]">{ledger.totalMyPoints}</span>
                    <span className="text-[#73907c] mx-1 font-sans text-xs">/</span>
                    <span className="text-[#efe9dc]">{ledger.totalOppPoints}</span>
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}

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

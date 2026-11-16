import { useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { useGameStore } from '../store/gameStore';
import { Card } from './Card';
import type { Card as CardType } from '../game/types';

interface LobbyProps {
  peerActions: {
    hostGame: () => Promise<void>;
    joinGame: (code: string) => Promise<void>;
    cancelConnection: () => void;
  };
}

const FAN_CARDS: { card: CardType; rotate: number; y: number; x: number }[] = [
  { card: { rank: 'J', suit: 'spades' }, rotate: -14, y: 8, x: 10 },
  { card: { rank: '9', suit: 'hearts' }, rotate: -5, y: 1, x: 4 },
  { card: { rank: 'K', suit: 'clubs' }, rotate: 5, y: 1, x: -4 },
  { card: { rank: 'Q', suit: 'diamonds' }, rotate: 14, y: 8, x: -10 },
];

export function Lobby({ peerActions }: LobbyProps) {
  const [joinCode, setJoinCode] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const prefersReducedMotion = useReducedMotion();

  const { hostGame, joinGame, cancelConnection } = peerActions;
  const { connectionStatus, roomCode, connectionError } = useGameStore();

  const handleCreate = async () => {
    setLoading(true);
    setError('');
    try {
      await hostGame();
    } catch {
      setError('Could not reach the signaling server. Check your connection and try again.');
    }
    setLoading(false);
  };

  const handleJoin = async () => {
    if (joinCode.length !== 4) {
      setError('Enter all 4 characters of the room code.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      await joinGame(joinCode.toUpperCase());
    } catch (e) {
      setError((e as Error).message);
    }
    setLoading(false);
  };

  const handleCopyCode = async () => {
    if (!roomCode) return;
    try {
      await navigator.clipboard.writeText(roomCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API unavailable in insecure context; silently ignore
    }
  };

  if (connectionStatus === 'in-lobby' && roomCode) {
    return (
      <main className="tapis-surface h-full overflow-y-auto overscroll-y-contain flex flex-col items-center justify-center px-4 py-8">
        <div className="w-full max-w-md text-center">
          <h1 className="font-display text-3xl sm:text-4xl font-semibold tracking-tight text-[#efe9dc] mb-6">
            Belote Maniée
          </h1>

          <div className="ardoise-panel rounded-2xl p-6 sm:p-8 text-center">
            <p className="text-base font-medium text-[#efe9dc] mb-1">
              Waiting for your opponent to join
            </p>
            <p className="text-sm text-[#a4bba9] mb-5">
              Send them this 4-character code to deal the first hand.
            </p>

            <div className="tapis-ring rounded-xl px-5 py-4 mb-4 flex items-center justify-between gap-3">
              <div
                data-testid="room-code"
                className="font-display text-3xl sm:text-4xl font-bold tracking-[0.22em] text-[#e3ba62] tabular-nums pl-2"
              >
                {roomCode}
              </div>
              <button
                type="button"
                onClick={handleCopyCode}
                className="btn-slate rounded-lg px-3.5 py-2 text-xs font-semibold shrink-0 cursor-pointer"
              >
                {copied ? 'Copied' : 'Copy code'}
              </button>
            </div>

            {connectionError && (
              <p
                role="alert"
                className="text-sm text-[#f7b4b6] bg-[#5c1619]/60 border border-[#e45a5e]/35 px-4 py-2.5 rounded-lg mb-4 text-left"
              >
                {connectionError}
              </p>
            )}

            <div className="pt-2">
              <button
                type="button"
                onClick={cancelConnection}
                className="text-sm text-[#a4bba9] hover:text-[#efe9dc] underline underline-offset-4 cursor-pointer transition-colors"
              >
                Leave table
              </button>
            </div>
          </div>
        </div>
      </main>
    );
  }

  if (connectionStatus === 'connecting') {
    return (
      <main className="tapis-surface h-full overflow-y-auto overscroll-y-contain flex flex-col items-center justify-center px-4 py-8">
        <div className="w-full max-w-md text-center">
          <h1 className="font-display text-3xl sm:text-4xl font-semibold tracking-tight text-[#efe9dc] mb-6">
            Belote Maniée
          </h1>

          <div className="ardoise-panel rounded-2xl p-6 sm:p-8 text-center">
            <p className="text-base font-medium text-[#efe9dc] mb-2">
              Joining table {roomCode ? <span className="font-display text-[#e3ba62]">{roomCode}</span> : null}…
            </p>
            <p className="text-sm text-[#a4bba9] mb-5">
              Establishing a direct peer-to-peer connection for the deal.
            </p>

            {connectionError && (
              <p
                role="alert"
                className="text-sm text-[#f7b4b6] bg-[#5c1619]/60 border border-[#e45a5e]/35 px-4 py-2.5 rounded-lg mb-4 text-left"
              >
                {connectionError}
              </p>
            )}

            <button
              type="button"
              onClick={cancelConnection}
              className="text-sm text-[#a4bba9] hover:text-[#efe9dc] underline underline-offset-4 cursor-pointer transition-colors"
            >
              Back to lobby
            </button>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="tapis-surface h-full overflow-y-auto overscroll-y-contain flex flex-col items-center justify-center px-4 py-10">
      <div className="w-full max-w-md flex flex-col items-center">
        {/* Characteristic fanned piquet hand: Jack, 9, King, Queen */}
        <div
          aria-hidden="true"
          className="flex items-end justify-center mb-6 pt-2 select-none"
        >
          {FAN_CARDS.map((item, idx) => (
            <motion.div
              key={`${item.card.rank}-${item.card.suit}`}
              initial={
                prefersReducedMotion
                  ? false
                  : { opacity: 0, y: 18, rotate: 0 }
              }
              animate={{
                opacity: 1,
                y: item.y,
                rotate: item.rotate,
                x: item.x,
              }}
              transition={{
                duration: 0.42,
                delay: idx * 0.055,
                ease: [0.22, 1, 0.36, 1],
              }}
              className="-mx-1.5 sm:-mx-2 origin-bottom"
            >
              <Card card={item.card} decorative />
            </motion.div>
          ))}
        </div>

        {/* Title & concise subject framing */}
        <h1 className="font-display text-4xl sm:text-5xl font-semibold tracking-tight text-[#efe9dc] text-center">
          Belote Maniée
        </h1>
        <p className="mt-2 mb-7 text-sm sm:text-base text-[#a4bba9] text-center max-w-sm leading-relaxed">
          Two-player French trick-taking with open tableaus, dealt directly between browsers.
        </p>

        {/* Single cohesive table ledger */}
        <section
          aria-label="Start or join a game"
          className="ardoise-panel w-full rounded-2xl p-6 sm:p-7"
        >
          <button
            id="create-room-button"
            data-testid="create-room"
            type="button"
            onClick={handleCreate}
            disabled={loading}
            className="btn-brass w-full font-semibold text-base py-3.5 px-6 rounded-xl cursor-pointer"
          >
            {loading ? 'Opening table…' : 'Create a table'}
          </button>

          <div className="relative my-5 flex items-center">
            <div className="flex-grow border-t border-[#efe9dc]/12" />
            <span className="mx-3 text-xs text-[#a4bba9]">or join with a code</span>
            <div className="flex-grow border-t border-[#efe9dc]/12" />
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              void handleJoin();
            }}
            className="flex gap-2.5"
          >
            <label htmlFor="join-code-input" className="sr-only">
              4-character room code
            </label>
            <input
              id="join-code-input"
              data-testid="join-code-input"
              type="text"
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              value={joinCode}
              onChange={(e) => {
                setError('');
                setJoinCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4));
              }}
              placeholder="Code"
              className="w-36 sm:w-40 tapis-ring rounded-xl px-3.5 py-3 text-center font-display text-xl font-semibold tracking-[0.2em] text-[#efe9dc] tabular-nums placeholder:font-sans placeholder:text-sm placeholder:font-normal placeholder:tracking-normal placeholder:text-[#73907c]"
            />
            <button
              id="join-room-button"
              data-testid="join-room"
              type="submit"
              disabled={loading || joinCode.length !== 4}
              className="btn-slate flex-1 font-semibold text-sm sm:text-base py-3 px-4 rounded-xl cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {loading ? 'Joining…' : 'Join table'}
            </button>
          </form>

          {error && (
            <p
              role="alert"
              className="mt-4 text-sm text-[#f7b4b6] bg-[#5c1619]/60 border border-[#e45a5e]/35 px-3.5 py-2.5 rounded-lg"
            >
              {error}
            </p>
          )}
        </section>

        {/* Quiet expandable rules reference */}
        <details className="mt-5 w-full text-sm text-[#a4bba9] group">
          <summary className="cursor-pointer list-none text-center hover:text-[#efe9dc] transition-colors select-none">
            <span className="underline decoration-[#a4bba9]/40 underline-offset-4">
              How Belote Maniée works
            </span>
          </summary>
          <div className="mt-3 ardoise-bar rounded-xl p-4 text-xs sm:text-sm leading-relaxed text-[#d6dfd8] space-y-2">
            <p>
              Each player holds 8 cards in hand plus 4 tableau stacks (one face-up card resting on one hidden card). Face-up tableau cards play just like cards in your hand and uncover the card beneath.
            </p>
            <p>
              <strong className="text-[#efe9dc] font-semibold">Trump order:</strong>{' '}
              J (20), 9 (14), A (11), 10 (10), K (4), Q (3), 8, 7. Follow suit when able; otherwise trump, and overtrump when possible.
            </p>
            <p>
              <strong className="text-[#efe9dc] font-semibold">Scoring:</strong>{' '}
              152 card points + 10 for the last trick (+20 for King &amp; Queen of trump). If the taker fails to outscore the defender, the defender wins all 162 points (<em>dedans</em>). First to 1,000 wins.
            </p>
          </div>
        </details>
      </div>
    </main>
  );
}

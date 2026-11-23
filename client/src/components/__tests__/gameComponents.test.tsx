// @vitest-environment jsdom
import type { ReactNode, HTMLAttributes } from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';

vi.mock('framer-motion', () => ({
  AnimatePresence: ({ children }: { children?: ReactNode }) => <>{children}</>,
  motion: {
    div: ({
      children,
      initial: _initial,
      animate: _animate,
      exit: _exit,
      transition: _transition,
      ...rest
    }: HTMLAttributes<HTMLDivElement> & {
      initial?: unknown;
      animate?: unknown;
      exit?: unknown;
      transition?: unknown;
    }) => {
      void _initial;
      void _animate;
      void _exit;
      void _transition;
      return <div {...rest}>{children}</div>;
    },
  },
  useReducedMotion: () => true,
}));

vi.mock('../../networking/peer', () => ({
  sendPeerMessage: vi.fn(() => true),
}));

vi.mock('../../telemetry', () => ({
  captureException: vi.fn(),
  addGameBreadcrumb: vi.fn(),
  setGameContext: vi.fn(),
}));

import { createInitialState, applyAction } from '../../game/engine';
import { getPlayableCards } from '../../game/validation';
import { cardToString, type RoundScore } from '../../game/types';
import { REACTION_COOLDOWN_MS, REACTION_DISPLAY_MS } from '../../game/reactions';
import { captureException } from '../../telemetry';
import { useGameStore } from '../../store/gameStore';
import { PlayArea } from '../PlayArea';
import { ReactionPopoverButton, ReactionPill } from '../TableReactions';
import { RulesModal } from '../RulesModal';
import { ScoreLedgerModal } from '../ScoreLedgerModal';
import { ErrorBoundary } from '../ErrorBoundary';

function makeCompletedTrickState() {
  let state = createInitialState('play-area-dom-test', 0);
  state = applyAction(state, state.currentPlayer, { type: 'bid-take' });
  const c1 = getPlayableCards(state)[0];
  state = applyAction(state, state.currentPlayer, { type: 'play-card', card: cardToString(c1) });
  const c2 = getPlayableCards(state)[0];
  state = applyAction(state, state.currentPlayer, { type: 'play-card', card: cardToString(c2) });
  return state;
}

function ThrowingChild({ shouldThrow }: { shouldThrow: boolean }) {
  if (shouldThrow) {
    throw new Error('Boom render failure');
  }
  return <div data-testid="healthy-child">All good</div>;
}

describe('PlayArea component', () => {
  beforeEach(() => {
    useGameStore.getState().resetConnection();
  });

  afterEach(() => {
    cleanup();
    useGameStore.getState().resetConnection();
  });

  it('shows last-trick peek only once trick 2 lead is played and closes on Escape or outside click', () => {
    const afterTrick1 = makeCompletedTrickState();
    useGameStore.setState({
      gameMode: 'p2p',
      connectionStatus: 'connected',
      localPlayer: 0,
      gameState: afterTrick1,
    });

    const { rerender } = render(<PlayArea />);
    // While Trick 1 is still displayed on the baize, last-trick-toggle is hidden
    expect(screen.getByTestId('trick-counter').textContent).toContain('Trick 1/16');
    expect(screen.queryByTestId('last-trick-toggle')).toBeNull();

    // Lead the first card of Trick 2 -> last-trick-toggle appears
    const lead2 = getPlayableCards(afterTrick1)[0];
    const trick2Lead = applyAction(afterTrick1, afterTrick1.currentPlayer, {
      type: 'play-card',
      card: cardToString(lead2),
    });
    useGameStore.setState({ gameState: trick2Lead });
    rerender(<PlayArea />);

    expect(screen.getByTestId('trick-counter').textContent).toContain('Trick 2/16');
    const toggle = screen.getByTestId('last-trick-toggle');
    fireEvent.click(toggle);
    expect(screen.getByTestId('last-trick-popover')).toBeTruthy();

    // Escape closes the popover
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByTestId('last-trick-popover')).toBeNull();

    // Re-open and close via outside mousedown
    fireEvent.click(toggle);
    expect(screen.getByTestId('last-trick-popover')).toBeTruthy();
    fireEvent.mouseDown(document.body);
    expect(screen.queryByTestId('last-trick-popover')).toBeNull();
  });

  it('displays Belote! and Rebelote! badges when declared', () => {
    const state = makeCompletedTrickState();
    state.beloteDeclared = [true, false];
    useGameStore.setState({
      gameMode: 'p2p',
      connectionStatus: 'connected',
      localPlayer: 0,
      gameState: state,
    });

    const { rerender } = render(<PlayArea />);
    expect(screen.getByText('Belote!')).toBeTruthy();

    const rebeloteState = structuredClone(state);
    rebeloteState.rebeloteDeclared = [true, false];
    useGameStore.setState({ gameState: rebeloteState });
    rerender(<PlayArea />);
    expect(screen.getByText('Rebelote!')).toBeTruthy();
  });
});

describe('TableReactions components', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useGameStore.getState().resetConnection();
    useGameStore.setState({
      gameMode: 'p2p',
      connectionStatus: 'connected',
      localPlayer: 0,
      gameState: createInitialState('reactions-dom-test', 0),
    });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    useGameStore.getState().resetConnection();
  });

  it('opens menu via click or ArrowDown, navigates options, sends reaction, enforces cooldown, and auto-clears pill', () => {
    render(
      <div>
        <ReactionPopoverButton />
        <ReactionPill player={0} side="bottom" />
      </div>,
    );

    const trigger = screen.getByTestId('reaction-button');

    // Open with ArrowDown and check focus moves to first menu item
    fireEvent.keyDown(trigger, { key: 'ArrowDown' });
    expect(screen.getByTestId('reaction-menu')).toBeTruthy();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(document.activeElement).toBe(screen.getByTestId('reaction-option-bien-joue'));

    // Navigate with End / Home / ArrowDown
    const menu = screen.getByTestId('reaction-menu');
    fireEvent.keyDown(menu, { key: 'End' });
    expect(document.activeElement).toBe(screen.getByTestId('reaction-option-merci'));
    fireEvent.keyDown(menu, { key: 'Home' });
    expect(document.activeElement).toBe(screen.getByTestId('reaction-option-bien-joue'));

    // Escape closes menu and returns focus to trigger
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(trigger);
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(screen.queryByTestId('reaction-menu')).toBeNull();

    // Click to open and select "Bien joué !"
    fireEvent.click(trigger);
    fireEvent.click(screen.getByTestId('reaction-option-bien-joue'));
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(screen.getByTestId('reaction-pill-bottom').textContent).toBe('Bien joué !');

    // Advance past AnimatePresence exit and cooldown start timer
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(screen.queryByTestId('reaction-menu')).toBeNull();

    // Re-opening during cooldown marks options aria-disabled="true"
    fireEvent.click(trigger);
    expect(
      screen.getByTestId('reaction-option-merci').getAttribute('aria-disabled'),
    ).toBe('true');

    // After cooldown expires, aria-disabled becomes false; after display expires, pill clears
    act(() => {
      vi.advanceTimersByTime(REACTION_COOLDOWN_MS + 10);
    });
    expect(
      screen.getByTestId('reaction-option-merci').getAttribute('aria-disabled'),
    ).toBe('false');

    act(() => {
      vi.advanceTimersByTime(REACTION_DISPLAY_MS);
    });
    expect(useGameStore.getState().activeReactions[0]).toBeNull();
  });
});

describe('RulesModal and ScoreLedgerModal', () => {
  afterEach(() => {
    cleanup();
  });

  it('RulesModal renders custom rules and closes via Escape, close button, and backdrop', () => {
    const onClose = vi.fn();
    render(
      <RulesModal
        open={true}
        onClose={onClose}
        options={{ targetScore: 500, capotEnabled: true }}
      />,
    );

    const dialog = screen.getByTestId('rules-modal');
    expect(dialog.textContent).toContain('500');
    expect(dialog.textContent).toContain('Capot');

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByLabelText('Close rules'));
    expect(onClose).toHaveBeenCalledTimes(2);

    fireEvent.mouseDown(dialog, { button: 0 });
    expect(onClose).toHaveBeenCalledTimes(3);
  });

  it('ScoreLedgerModal renders empty state and populated round rows', () => {
    const onClose = vi.fn();
    const { rerender } = render(
      <ScoreLedgerModal open={true} onClose={onClose} roundScores={[]} localPlayer={0} />,
    );
    expect(screen.getByTestId('score-ledger-modal').textContent).toContain(
      'No completed rounds yet.',
    );

    const round: RoundScore = {
      trickPoints: [102, 50],
      beloteBonus: [20, 0],
      lastTrickBonus: [10, 0],
      dedans: false,
      taker: 0,
      trumpSuit: 'hearts',
      finalPoints: [132, 50],
    };
    rerender(
      <ScoreLedgerModal
        open={true}
        onClose={onClose}
        roundScores={[round]}
        localPlayer={0}
        targetScore={500}
        myLabel="Claire"
        oppLabel="Marc"
      />,
    );

    const modal = screen.getByTestId('score-ledger-modal');
    expect(modal.textContent).toContain('Claire');
    expect(modal.textContent).toContain('Marc');
    expect(modal.textContent).toContain('132');

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('ErrorBoundary', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('catches render errors, reports to telemetry, and recovers when Try Again is clicked', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});

    let shouldThrow = true;
    const { rerender } = render(
      <ErrorBoundary>
        <ThrowingChild shouldThrow={shouldThrow} />
      </ErrorBoundary>,
    );

    expect(screen.getByText('Something went wrong')).toBeTruthy();
    expect(screen.getByText(/Boom render failure/)).toBeTruthy();
    expect(captureException).toHaveBeenCalledTimes(1);

    shouldThrow = false;
    rerender(
      <ErrorBoundary>
        <ThrowingChild shouldThrow={shouldThrow} />
      </ErrorBoundary>,
    );
    fireEvent.click(screen.getByText('Try Again'));
    expect(screen.getByTestId('healthy-child').textContent).toBe('All good');
  });
});

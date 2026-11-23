// @vitest-environment jsdom
import { useRef } from 'react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useFocusTrap } from '../useFocusTrap';
import { useKeyboardShortcuts } from '../useKeyboardShortcuts';
import type { Phase, Rank } from '../../game/types';

function FocusTrapHarness({
  open,
  empty = false,
}: {
  open: boolean;
  empty?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useFocusTrap(ref, open);

  return (
    <div>
      <button type="button" data-testid="outside-trigger">
        Open
      </button>
      {open && (
        <div ref={ref} tabIndex={-1} data-testid="modal-container" role="dialog" aria-modal="true">
          {!empty && (
            <>
              <button type="button" data-testid="first-btn">
                First
              </button>
              <button type="button" data-testid="last-btn">
                Last
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function ShortcutHarness({
  phase = 'bidding-round1',
  trumpCardRank = 'A',
  isMyTurn = true,
  isModalOpen = false,
  hasSelectedCard = false,
  withDialogInDom = false,
  onBidTake = vi.fn(),
  onBidPass = vi.fn(),
  onClearSelection = vi.fn(),
}: {
  phase?: Phase | null;
  trumpCardRank?: Rank | null;
  isMyTurn?: boolean;
  isModalOpen?: boolean;
  hasSelectedCard?: boolean;
  withDialogInDom?: boolean;
  onBidTake?: () => void;
  onBidPass?: () => void;
  onClearSelection?: () => void;
}) {
  useKeyboardShortcuts({
    phase,
    trumpCardRank,
    isMyTurn,
    isModalOpen,
    hasSelectedCard,
    onBidTake,
    onBidPass,
    onClearSelection,
  });

  return (
    <div>
      <input data-testid="text-input" />
      <div role="menu" data-testid="reaction-menu">
        <button type="button" role="menuitem" data-testid="menu-item">
          Merci !
        </button>
      </div>
      {withDialogInDom && <div role="dialog" aria-modal="true" />}
      <button type="button" data-playable="true" data-testid="card-1">
        Card 1
      </button>
      <button type="button" data-playable="true" data-testid="card-2">
        Card 2
      </button>
      <button type="button" data-playable="true" disabled data-testid="card-disabled">
        Disabled
      </button>
    </div>
  );
}

describe('useFocusTrap (mounted DOM)', () => {
  afterEach(() => {
    cleanup();
  });

  it('focuses first element on open, wraps Tab and Shift+Tab, and restores focus on close', () => {
    const { rerender } = render(<FocusTrapHarness open={false} />);
    const trigger = screen.getByTestId('outside-trigger');
    trigger.focus();
    expect(document.activeElement).toBe(trigger);

    rerender(<FocusTrapHarness open={true} />);
    const first = screen.getByTestId('first-btn');
    const last = screen.getByTestId('last-btn');
    expect(document.activeElement).toBe(first);

    // Shift+Tab from first wraps to last
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(last);

    // Tab from last wraps to first
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: false });
    expect(document.activeElement).toBe(first);

    // Closing restores focus to the previously focused trigger
    rerender(<FocusTrapHarness open={false} />);
    expect(document.activeElement).toBe(trigger);
  });

  it('focuses the container itself when no focusable children exist', () => {
    render(<FocusTrapHarness open={true} empty={true} />);
    const container = screen.getByTestId('modal-container');
    expect(document.activeElement).toBe(container);

    fireEvent.keyDown(document, { key: 'Tab' });
    expect(document.activeElement).toBe(container);
  });
});

describe('useKeyboardShortcuts (mounted DOM)', () => {
  afterEach(() => {
    cleanup();
  });

  it('invokes bidTake on t and bidPass on p during bidding-round1', () => {
    const onBidTake = vi.fn();
    const onBidPass = vi.fn();
    render(<ShortcutHarness onBidTake={onBidTake} onBidPass={onBidPass} />);

    fireEvent.keyDown(document, { key: 't' });
    fireEvent.keyDown(document, { key: 'p' });

    expect(onBidTake).toHaveBeenCalledTimes(1);
    expect(onBidPass).toHaveBeenCalledTimes(1);
  });

  it('suppresses shortcuts when modifier keys, modals, inputs, or menus are active', () => {
    const onBidTake = vi.fn();
    const onBidPass = vi.fn();
    const { rerender } = render(
      <ShortcutHarness onBidTake={onBidTake} onBidPass={onBidPass} />,
    );

    // Modifier keys ignored
    fireEvent.keyDown(document, { key: 't', ctrlKey: true });
    fireEvent.keyDown(document, { key: 'p', metaKey: true });

    // Editable input target ignored
    fireEvent.keyDown(screen.getByTestId('text-input'), { key: 't' });

    // Menuitem target ignored
    fireEvent.keyDown(screen.getByTestId('menu-item'), { key: 'p' });

    // Repeat events ignored
    fireEvent.keyDown(document, { key: 't', repeat: true });

    expect(onBidTake).not.toHaveBeenCalled();
    expect(onBidPass).not.toHaveBeenCalled();

    // Open modal prop or aria-modal dialog in DOM suppresses shortcuts
    rerender(<ShortcutHarness isModalOpen={true} onBidTake={onBidTake} onBidPass={onBidPass} />);
    fireEvent.keyDown(document, { key: 't' });
    expect(onBidTake).not.toHaveBeenCalled();

    rerender(
      <ShortcutHarness withDialogInDom={true} onBidTake={onBidTake} onBidPass={onBidPass} />,
    );
    fireEvent.keyDown(document, { key: 't' });
    expect(onBidTake).not.toHaveBeenCalled();
  });

  it('clears 2-tap card selection on Escape and cycles playable card focus with Arrow keys', () => {
    const onClearSelection = vi.fn();
    render(
      <ShortcutHarness
        phase="playing"
        hasSelectedCard={true}
        onClearSelection={onClearSelection}
      />,
    );

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClearSelection).toHaveBeenCalledTimes(1);

    const card1 = screen.getByTestId('card-1');
    const card2 = screen.getByTestId('card-2');

    fireEvent.keyDown(document, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(card1);

    fireEvent.keyDown(document, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(card2);

    // Wraps around and skips disabled button[data-playable]
    fireEvent.keyDown(document, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(card1);

    fireEvent.keyDown(document, { key: 'ArrowLeft' });
    expect(document.activeElement).toBe(card2);
  });
});

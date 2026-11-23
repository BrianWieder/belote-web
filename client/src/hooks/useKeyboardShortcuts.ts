import { useEffect } from 'react';
import type { Phase, Rank } from '../game/types';

export type BiddingShortcutAction = 'bid-take' | 'bid-pass';

interface EditableTargetLike {
  tagName?: string;
  isContentEditable?: boolean;
  getAttribute?: (name: string) => string | null;
  closest?: (selector: string) => unknown;
}

const EDITABLE_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT']);

export function isEditableTarget(target: unknown): boolean {
  if (!target || typeof target !== 'object') return false;
  const el = target as EditableTargetLike;
  if (el.isContentEditable) return true;
  if (typeof el.tagName === 'string' && EDITABLE_TAGS.has(el.tagName.toUpperCase())) {
    return true;
  }
  return false;
}

export function isMenuTarget(target: unknown): boolean {
  if (!target || typeof target !== 'object') return false;
  const el = target as EditableTargetLike;
  const role = typeof el.getAttribute === 'function' ? el.getAttribute('role') : null;
  if (role === 'menu' || role === 'menuitem') {
    return true;
  }
  if (typeof el.closest === 'function') {
    return Boolean(el.closest('[role="menu"], [data-testid="reaction-menu"]'));
  }
  return false;
}

export function resolveBiddingShortcut(
  key: string,
  phase: Phase,
  trumpCardRank: Rank | null,
): BiddingShortcutAction | null {
  const normalized = key.toLowerCase();
  if (normalized === 't') {
    return phase === 'bidding-round1' ? 'bid-take' : null;
  }
  if (normalized === 'p') {
    if (phase === 'bidding-round1') {
      return trumpCardRank === 'J' ? null : 'bid-pass';
    }
    if (phase === 'bidding-round2') {
      return 'bid-pass';
    }
    return null;
  }
  return null;
}

export function getNextPlayableIndex(
  currentIndex: number,
  count: number,
  direction: 'prev' | 'next',
): number {
  if (count <= 0) return -1;
  if (currentIndex < 0 || currentIndex >= count) {
    return direction === 'next' ? 0 : count - 1;
  }
  return direction === 'next'
    ? (currentIndex + 1) % count
    : (currentIndex - 1 + count) % count;
}

interface UseKeyboardShortcutsOptions {
  phase: Phase | null;
  trumpCardRank: Rank | null;
  isMyTurn: boolean;
  isModalOpen: boolean;
  hasSelectedCard: boolean;
  onBidTake: () => void;
  onBidPass: () => void;
  onClearSelection: () => void;
}

export function useKeyboardShortcuts({
  phase,
  trumpCardRank,
  isMyTurn,
  isModalOpen,
  hasSelectedCard,
  onBidTake,
  onBidPass,
  onClearSelection,
}: UseKeyboardShortcutsOptions): void {
  useEffect(() => {
    if (!phase) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (isModalOpen) return;
      if (document.querySelector('[role="dialog"][aria-modal="true"]')) return;
      if (isEditableTarget(event.target)) return;
      if (isMenuTarget(event.target) || isMenuTarget(document.activeElement)) return;

      if (event.key === 'Escape' && hasSelectedCard) {
        event.preventDefault();
        onClearSelection();
        return;
      }

      if (!isMyTurn) return;

      if (
        phase === 'bidding-round1' ||
        phase === 'bidding-round2' ||
        phase === 'bidding-forced'
      ) {
        if (event.repeat) return;
        const action = resolveBiddingShortcut(event.key, phase, trumpCardRank);
        if (action === 'bid-take') {
          event.preventDefault();
          onBidTake();
        } else if (action === 'bid-pass') {
          event.preventDefault();
          onBidPass();
        }
        return;
      }

      if (phase === 'playing' && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
        const playableButtons = Array.from(
          document.querySelectorAll<HTMLButtonElement>('button[data-playable]:not(:disabled)'),
        );
        if (playableButtons.length === 0) return;

        const currentIndex = playableButtons.indexOf(
          document.activeElement as HTMLButtonElement,
        );
        const nextIndex = getNextPlayableIndex(
          currentIndex,
          playableButtons.length,
          event.key === 'ArrowRight' ? 'next' : 'prev',
        );
        if (nextIndex >= 0) {
          event.preventDefault();
          playableButtons[nextIndex].focus();
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [
    phase,
    trumpCardRank,
    isMyTurn,
    isModalOpen,
    hasSelectedCard,
    onBidTake,
    onBidPass,
    onClearSelection,
  ]);
}

import { useEffect, type RefObject } from 'react';

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'textarea:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

export type FocusTrapTarget = number | 'container' | null;

export function getFocusTrapTarget(options: {
  count: number;
  currentIndex: number;
  isFocusInside: boolean;
  shiftKey: boolean;
}): FocusTrapTarget {
  const { count, currentIndex, isFocusInside, shiftKey } = options;
  if (count <= 0) {
    return 'container';
  }
  if (shiftKey) {
    if (!isFocusInside || currentIndex <= 0) {
      return count - 1;
    }
    return null;
  }
  if (!isFocusInside || currentIndex < 0 || currentIndex >= count - 1) {
    return 0;
  }
  return null;
}

function getFocusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (el) => !el.hasAttribute('hidden') && el.getAttribute('aria-hidden') !== 'true',
  );
}

export function useFocusTrap(
  containerRef: RefObject<HTMLElement | null>,
  active: boolean,
): void {
  useEffect(() => {
    if (!active) return;
    const container = containerRef.current;
    if (!container) return;

    const previouslyFocused =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;

    if (!container.contains(document.activeElement)) {
      const focusables = getFocusableElements(container);
      const initialTarget = focusables[0] ?? container;
      initialTarget.focus();
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;
      const currentContainer = containerRef.current;
      if (!currentContainer) return;

      const focusables = getFocusableElements(currentContainer);
      const activeElement = document.activeElement as HTMLElement | null;
      const isFocusInside = Boolean(activeElement && currentContainer.contains(activeElement));
      const currentIndex = activeElement ? focusables.indexOf(activeElement) : -1;

      const target = getFocusTrapTarget({
        count: focusables.length,
        currentIndex,
        isFocusInside,
        shiftKey: event.shiftKey,
      });

      if (target === null) return;
      event.preventDefault();
      if (target === 'container') {
        currentContainer.focus();
      } else {
        focusables[target]?.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      if (previouslyFocused && previouslyFocused.isConnected) {
        previouslyFocused.focus();
      }
    };
  }, [containerRef, active]);
}

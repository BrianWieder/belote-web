import { describe, it, expect } from 'vitest';
import { getFocusTrapTarget } from '../useFocusTrap';

describe('getFocusTrapTarget', () => {
  it('returns container when no focusable children exist', () => {
    expect(
      getFocusTrapTarget({ count: 0, currentIndex: -1, isFocusInside: false, shiftKey: false }),
    ).toBe('container');
    expect(
      getFocusTrapTarget({ count: 0, currentIndex: -1, isFocusInside: true, shiftKey: true }),
    ).toBe('container');
  });

  it('wraps forward Tab from last element to first element', () => {
    expect(
      getFocusTrapTarget({ count: 3, currentIndex: 2, isFocusInside: true, shiftKey: false }),
    ).toBe(0);
  });

  it('wraps Shift+Tab from first element to last element', () => {
    expect(
      getFocusTrapTarget({ count: 3, currentIndex: 0, isFocusInside: true, shiftKey: true }),
    ).toBe(2);
  });

  it('allows natural tab order for middle focusable elements', () => {
    expect(
      getFocusTrapTarget({ count: 3, currentIndex: 0, isFocusInside: true, shiftKey: false }),
    ).toBeNull();
    expect(
      getFocusTrapTarget({ count: 3, currentIndex: 1, isFocusInside: true, shiftKey: false }),
    ).toBeNull();
    expect(
      getFocusTrapTarget({ count: 3, currentIndex: 1, isFocusInside: true, shiftKey: true }),
    ).toBeNull();
    expect(
      getFocusTrapTarget({ count: 3, currentIndex: 2, isFocusInside: true, shiftKey: true }),
    ).toBeNull();
  });

  it('pulls focus back into the modal when focus is outside or on the container', () => {
    expect(
      getFocusTrapTarget({ count: 2, currentIndex: -1, isFocusInside: false, shiftKey: false }),
    ).toBe(0);
    expect(
      getFocusTrapTarget({ count: 2, currentIndex: -1, isFocusInside: false, shiftKey: true }),
    ).toBe(1);
    expect(
      getFocusTrapTarget({ count: 2, currentIndex: -1, isFocusInside: true, shiftKey: false }),
    ).toBe(0);
    expect(
      getFocusTrapTarget({ count: 2, currentIndex: -1, isFocusInside: true, shiftKey: true }),
    ).toBe(1);
  });

  it('keeps focus trapped on a single button for both Tab and Shift+Tab', () => {
    expect(
      getFocusTrapTarget({ count: 1, currentIndex: 0, isFocusInside: true, shiftKey: false }),
    ).toBe(0);
    expect(
      getFocusTrapTarget({ count: 1, currentIndex: 0, isFocusInside: true, shiftKey: true }),
    ).toBe(0);
  });
});

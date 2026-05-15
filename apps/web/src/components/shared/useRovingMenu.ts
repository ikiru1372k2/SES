import { useEffect, type RefObject } from 'react';

/**
 * Wires WAI-ARIA menu keyboard semantics onto an open popup container.
 *
 * Behaviour while `open`:
 *  - On open, focus moves to the first menu item.
 *  - ArrowDown / ArrowUp move focus between items (wrapping).
 *  - Home / End jump to first / last.
 *  - Escape closes and returns focus to the trigger.
 *  - Tab is allowed to leave naturally (also closes the menu).
 *
 * "Items" = focusable elements inside `containerRef` matching
 * `[role="menuitem"], a[href], button:not([disabled])`. Non-interactive
 * `role="menuitem"` labels are skipped.
 */
export function useRovingMenu(
  open: boolean,
  containerRef: RefObject<HTMLElement>,
  triggerRef: RefObject<HTMLElement>,
  close: () => void,
) {
  useEffect(() => {
    if (!open) return;
    const container = containerRef.current;
    if (!container) return;

    const getItems = (): HTMLElement[] =>
      Array.from(
        container.querySelectorAll<HTMLElement>(
          'a[href],button:not([disabled]),[role="menuitem"]:not([aria-disabled="true"])',
        ),
      ).filter((el) => el.offsetParent !== null || el === document.activeElement);

    // Move initial focus into the menu.
    const items = getItems();
    items[0]?.focus();

    function focusAt(list: HTMLElement[], index: number) {
      if (list.length === 0) return;
      const i = ((index % list.length) + list.length) % list.length;
      list[i]?.focus();
    }

    function onKeyDown(e: KeyboardEvent) {
      const list = getItems();
      const active = document.activeElement as HTMLElement | null;
      const idx = active ? list.indexOf(active) : -1;
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          focusAt(list, idx + 1);
          break;
        case 'ArrowUp':
          e.preventDefault();
          focusAt(list, idx - 1);
          break;
        case 'Home':
          e.preventDefault();
          focusAt(list, 0);
          break;
        case 'End':
          e.preventDefault();
          focusAt(list, list.length - 1);
          break;
        case 'Escape':
          e.preventDefault();
          close();
          triggerRef.current?.focus();
          break;
        case 'Tab':
          // Allow natural tab-out, but collapse the menu.
          close();
          break;
        default:
          break;
      }
    }

    container.addEventListener('keydown', onKeyDown);
    return () => container.removeEventListener('keydown', onKeyDown);
  }, [open, containerRef, triggerRef, close]);
}

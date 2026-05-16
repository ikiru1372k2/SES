import { useEffect, useId, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';

// A focus-trapping modal with ESC-to-close, overlay-click-to-close,
// body scroll lock, and ARIA wiring. Deliberately not portal-mounted — we
// render into the document directly so TanStack Query devtools / toasters
// still stack.
//
// Usage:
//   <Modal open={isOpen} title="Acknowledge findings" onClose={close}>
//     ...form...
//   </Modal>
const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function Modal({
  open,
  title,
  description,
  onClose,
  children,
  footer,
  size = 'md',
  dismissOnOverlayClick = true,
}: {
  open: boolean;
  title: ReactNode;
  description?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  dismissOnOverlayClick?: boolean;
}) {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  // Stable IDs so the dialog can point aria-labelledby/-describedby at its
  // own title/description nodes (audit U-01 / gap G-6).
  const reactId = useId();
  const titleId = `modal-title-${reactId}`;
  const descId = `modal-desc-${reactId}`;

  useEffect(() => {
    if (!open) return;
    const dialog = dialogRef.current;

    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
        return;
      }
      if (event.key !== 'Tab' || !dialog) return;
      // Focus-trap loop: keep Tab / Shift+Tab cycling inside the dialog.
      const focusables = Array.from(
        dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
      ).filter((el) => el.offsetParent !== null || el === document.activeElement);
      if (focusables.length === 0) {
        // Nothing focusable inside — keep focus on the dialog container.
        event.preventDefault();
        dialog.focus();
        return;
      }
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (!first || !last) return;
      const active = document.activeElement as HTMLElement | null;
      if (event.shiftKey) {
        if (active === first || active === dialog || !dialog.contains(active)) {
          event.preventDefault();
          last.focus();
        }
      } else if (active === last) {
        event.preventDefault();
        first.focus();
      }
    };

    window.addEventListener('keydown', onKey);
    const previouslyFocused = document.activeElement as HTMLElement | null;

    // Lock background scroll while the modal is open; restore the prior
    // value on cleanup so nested/stacked modals don't clobber each other.
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    // Focus the first focusable element after a paint so the form is
    // instantly keyboard-actionable. Fallback: focus the container.
    requestAnimationFrame(() => {
      const node = dialogRef.current;
      if (!node) return;
      const focusable = node.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
      (focusable ?? node).focus();
    });

    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = previousOverflow;
      previouslyFocused?.focus?.();
    };
  }, [open, onClose]);

  if (!open) return null;

  const sizeClass = {
    sm: 'max-w-sm',
    md: 'max-w-md',
    lg: 'max-w-2xl',
    xl: 'max-w-5xl',
  }[size];

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 pt-16 backdrop-blur-sm"
      onMouseDown={(event) => {
        if (dismissOnOverlayClick && event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descId : undefined}
        tabIndex={-1}
        className={`w-full ${sizeClass} rounded-xl border border-gray-200 bg-white shadow-modal outline-none dark:border-gray-700 dark:bg-gray-900`}
      >
        <header className="flex items-start justify-between gap-3 px-5 pb-2 pt-4">
          <div>
            <h2 id={titleId} className="text-base font-semibold text-gray-900 dark:text-white">
              {title}
            </h2>
            {description ? (
              <p id={descId} className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                {description}
              </p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-md p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-gray-800 dark:hover:text-gray-100"
          >
            <X size={18} />
          </button>
        </header>
        <div className="px-5 pb-4">{children}</div>
        {footer ? (
          <footer className="flex items-center justify-end gap-2 border-t border-gray-100 px-5 py-3 dark:border-gray-800">
            {footer}
          </footer>
        ) : null}
      </div>
    </div>
  );
}

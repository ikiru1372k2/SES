import { useEffect, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';

// A small focus-trapping modal with ESC-to-close, overlay-click-to-close,
// and opinionated layout. Deliberately not portal-mounted — we render into
// the document directly so TanStack Query devtools / toasters still stack.
//
// Usage:
//   <Modal open={isOpen} title="Acknowledge findings" onClose={close}>
//     ...form...
//   </Modal>
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
  const firstFieldRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    const previouslyFocused = document.activeElement as HTMLElement | null;
    // Focus the first focusable element after a paint so the form is
    // instantly keyboard-actionable. Fallback: focus the container.
    requestAnimationFrame(() => {
      const node = firstFieldRef.current;
      if (!node) return;
      const focusable = node.querySelector<HTMLElement>(
        'input, textarea, select, button, [tabindex]:not([tabindex="-1"])',
      );
      (focusable ?? node).focus();
    });
    return () => {
      window.removeEventListener('keydown', onKey);
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
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 pt-16 backdrop-blur-sm"
      onMouseDown={(event) => {
        if (dismissOnOverlayClick && event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={firstFieldRef}
        tabIndex={-1}
        className={`w-full ${sizeClass} rounded-2xl border border-gray-200 bg-white shadow-2xl outline-none dark:border-gray-700 dark:bg-gray-900`}
      >
        <header className="flex items-start justify-between gap-3 px-5 pb-2 pt-4">
          <div>
            <h2 className="text-base font-semibold text-gray-900 dark:text-white">{title}</h2>
            {description ? (
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{description}</p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-lg p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-gray-800 dark:hover:text-gray-100"
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

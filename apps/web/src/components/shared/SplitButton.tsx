import { ChevronDown } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';

// Split-button: primary action + caret-opened menu of secondary actions.
// Primary stays clickable while the menu is open (Gmail Send behaviour).

export type SplitButtonMenuItem = {
  label: string;
  description?: string;
  onClick: () => void;
  disabled?: boolean;
};

type SplitButtonVariant = 'primary' | 'secondary';

const variantStyles: Record<SplitButtonVariant, { primary: string; caret: string }> = {
  primary: {
    primary: 'bg-brand text-white hover:bg-brand-hover',
    caret: 'bg-brand text-white hover:bg-brand-hover border-brand-hover/60',
  },
  secondary: {
    primary:
      'border border-gray-300 bg-white text-gray-900 hover:border-brand hover:text-brand hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800',
    caret:
      'border border-gray-300 bg-white text-gray-900 hover:border-brand hover:text-brand hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800',
  },
};

export function SplitButton({
  primaryLabel,
  onPrimary,
  leading,
  menu,
  disabled,
  primaryTitle,
  menuTitle,
  variant = 'primary',
}: {
  primaryLabel: ReactNode;
  onPrimary: () => void;
  leading?: ReactNode;
  menu: SplitButtonMenuItem[];
  disabled?: boolean;
  primaryTitle?: string;
  menuTitle?: string;
  variant?: SplitButtonVariant;
}) {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const styles = variantStyles[variant];

  useEffect(() => {
    if (!open) return undefined;
    function onDocClick(event: MouseEvent) {
      if (!wrapperRef.current) return;
      if (!wrapperRef.current.contains(event.target as Node)) setOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={wrapperRef} className="relative inline-flex">
      <button
        type="button"
        disabled={disabled}
        onClick={onPrimary}
        title={primaryTitle}
        className={`inline-flex items-center gap-2 rounded-l-lg px-4 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${styles.primary}`}
      >
        {leading}
        {primaryLabel}
      </button>
      <button
        type="button"
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={menuTitle ?? 'More save options'}
        title={menuTitle ?? 'More save options'}
        onClick={() => setOpen((prev) => !prev)}
        className={`inline-flex items-center justify-center rounded-r-lg px-2 py-2 text-sm font-medium transition-colors border-l disabled:cursor-not-allowed disabled:opacity-40 ${styles.caret} ${
          variant === 'primary' ? 'border-l-white/20' : ''
        }`}
      >
        <ChevronDown size={15} />
      </button>
      {open ? (
        <div
          role="menu"
          className="absolute right-0 top-full z-20 mt-1 w-56 rounded-lg border border-gray-200 bg-white p-1 text-sm shadow-lg dark:border-gray-700 dark:bg-gray-900"
        >
          {menu.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              disabled={item.disabled}
              onClick={() => {
                if (item.disabled) return;
                setOpen(false);
                item.onClick();
              }}
              className="flex w-full flex-col items-start gap-0.5 rounded-md px-3 py-2 text-left hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40 dark:hover:bg-gray-800"
            >
              <span className="font-medium text-gray-900 dark:text-gray-100">{item.label}</span>
              {item.description ? (
                <span className="text-xs text-gray-500 dark:text-gray-400">{item.description}</span>
              ) : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

import { Loader2, MoreHorizontal } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useHeaderFlag } from './PageHeaderContext';
import type { HeaderAction } from './pageHeader.types';
import { Z } from './pageHeader.types';

export function OverflowMenu({
  actions,
  compact = false,
}: {
  actions: Omit<HeaderAction, 'disabled' | 'loading'>[];
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    function onDoc(event: MouseEvent) {
      if (!wrapRef.current) return;
      if (!wrapRef.current.contains(event.target as Node)) setOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (!actions.length) return null;

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        aria-label="More actions"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className={`inline-flex h-9 items-center justify-center rounded-lg border border-gray-200 text-gray-600 hover:border-gray-300 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800 ${
          compact ? 'w-9' : 'w-9'
        }`}
      >
        <MoreHorizontal size={16} />
      </button>
      {open ? (
        <div
          role="menu"
          style={{ zIndex: Z.headerPopover }}
          className="absolute right-0 top-full mt-2 w-64 overflow-hidden rounded-lg border border-gray-200 bg-white p-1 shadow-xl dark:border-gray-700 dark:bg-gray-900"
        >
          {actions.map((a) => (
            <OverflowMenuItem key={a.id} action={a} onClose={() => setOpen(false)} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function OverflowMenuItem({
  action,
  onClose,
}: {
  action: Omit<HeaderAction, 'disabled' | 'loading'>;
  onClose: () => void;
}) {
  const flag = useHeaderFlag(action.id);
  const Icon = action.icon;
  const disabled = flag.disabled || flag.loading;
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      aria-disabled={disabled || undefined}
      aria-busy={flag.loading || undefined}
      title={flag.disabled ? action.tooltip : undefined}
      onClick={() => {
        if (disabled) return;
        onClose();
        action.onClick();
      }}
      className="flex w-full items-center justify-between gap-2 rounded-md px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 dark:text-gray-200 dark:hover:bg-gray-800"
    >
      <span className="flex items-center gap-2">
        {Icon ? <Icon size={14} /> : null}
        {action.label}
      </span>
      {flag.loading ? <Loader2 size={14} className="animate-spin text-gray-400" /> : null}
    </button>
  );
}

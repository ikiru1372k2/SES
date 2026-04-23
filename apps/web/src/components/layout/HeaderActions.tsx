import { ChevronDown, Loader2 } from 'lucide-react';
import { memo, useEffect, useRef, useState } from 'react';
import { useHeaderFlag } from './PageHeaderContext';
import type { HeaderAction, HeaderActionVariant } from './pageHeader.types';
import { Z } from './pageHeader.types';

const variantStyles: Record<HeaderActionVariant, { primary: string; caret: string }> = {
  primary: {
    primary: 'bg-brand text-white hover:bg-brand-hover',
    caret: 'bg-brand text-white hover:bg-brand-hover border-l-white/20',
  },
  secondary: {
    primary:
      'border border-gray-300 bg-white text-gray-900 hover:border-brand hover:text-brand hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800',
    caret:
      'border border-gray-300 bg-white text-gray-900 hover:border-brand hover:text-brand hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800',
  },
  danger: {
    primary: 'bg-red-600 text-white hover:bg-red-700',
    caret: 'bg-red-600 text-white hover:bg-red-700 border-l-white/20',
  },
};

type ShapeAction = Omit<HeaderAction, 'disabled' | 'loading'>;

export const PrimaryHeaderAction = memo(function PrimaryHeaderAction({
  action,
  iconOnly = false,
}: {
  action: ShapeAction;
  iconOnly?: boolean;
}) {
  const flag = useHeaderFlag(action.id);
  const variant = action.variant ?? 'primary';
  const Icon = action.icon;
  const disabled = flag.disabled || flag.loading;
  const baseBtn =
    'inline-flex h-9 items-center gap-2 rounded-lg text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50';
  const hasSplit = Boolean(action.splitMenu && action.splitMenu.length > 0);

  if (hasSplit) {
    return <SplitHeaderAction action={action} iconOnly={iconOnly} />;
  }

  const title = flag.disabled ? action.tooltip : action.tooltip;
  return (
    <button
      type="button"
      disabled={disabled}
      aria-disabled={disabled || undefined}
      aria-busy={flag.loading || undefined}
      aria-label={iconOnly ? action.label : undefined}
      title={iconOnly ? action.label : title}
      onClick={action.onClick}
      className={`${baseBtn} ${variantStyles[variant].primary} ${iconOnly ? 'w-9 justify-center px-0' : 'px-4'}`}
    >
      {flag.loading ? (
        <Loader2 size={15} className="animate-spin" />
      ) : Icon ? (
        <Icon size={15} />
      ) : null}
      {!iconOnly ? <span>{action.label}</span> : null}
    </button>
  );
});

const SplitHeaderAction = memo(function SplitHeaderAction({
  action,
  iconOnly,
}: {
  action: ShapeAction;
  iconOnly: boolean;
}) {
  const flag = useHeaderFlag(action.id);
  const disabled = flag.disabled || flag.loading;
  const loading = flag.loading;
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const variant = action.variant ?? 'primary';
  const Icon = action.icon;
  const styles = variantStyles[variant === 'danger' ? 'primary' : variant];

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

  const primaryCls = `inline-flex h-9 items-center gap-2 rounded-l-lg text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${styles.primary} ${
    iconOnly ? 'w-9 justify-center px-0' : 'px-4'
  }`;
  const caretCls = `inline-flex h-9 items-center justify-center rounded-r-lg border-l px-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${styles.caret}`;

  return (
    <div ref={wrapRef} className="relative inline-flex">
      <button
        type="button"
        disabled={disabled}
        aria-disabled={disabled || undefined}
        aria-busy={loading || undefined}
        aria-label={iconOnly ? action.label : undefined}
        title={iconOnly ? action.label : action.tooltip}
        onClick={action.onClick}
        className={primaryCls}
      >
        {loading ? <Loader2 size={15} className="animate-spin" /> : Icon ? <Icon size={15} /> : null}
        {!iconOnly ? <span>{action.label}</span> : null}
      </button>
      <button
        type="button"
        disabled={flag.disabled}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`${action.label} options`}
        title={`${action.label} options`}
        onClick={() => setOpen((v) => !v)}
        className={caretCls}
      >
        <ChevronDown size={15} />
      </button>
      {open ? (
        <div
          role="menu"
          style={{ zIndex: Z.headerPopover }}
          className="absolute right-0 top-full mt-2 w-64 rounded-lg border border-gray-200 bg-white p-1 shadow-lg dark:border-gray-700 dark:bg-gray-900"
        >
          {(action.splitMenu ?? []).map((item) => (
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
              className="flex w-full flex-col items-start gap-0.5 rounded-md px-3 py-2 text-left hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 dark:hover:bg-gray-800"
            >
              <span className="text-sm font-medium text-gray-900 dark:text-gray-100">{item.label}</span>
              {item.description ? (
                <span className="text-xs text-gray-500 dark:text-gray-400">{item.description}</span>
              ) : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
});

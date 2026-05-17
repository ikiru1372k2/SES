import { ChevronRight } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useRovingMenu } from '../shared/useRovingMenu';
import type { Crumb } from './pageHeader.types';
import { Z } from './pageHeader.types';

export function Breadcrumb({
  crumbs,
  onNavigate,
}: {
  crumbs: Crumb[];
  onNavigate?: (event: React.MouseEvent<HTMLAnchorElement>, to: string) => void;
}) {
  const [expandOpen, setExpandOpen] = useState(false);
  const expandRef = useRef<HTMLDivElement | null>(null);
  const expandMenuRef = useRef<HTMLDivElement | null>(null);
  const expandTriggerRef = useRef<HTMLButtonElement | null>(null);
  const closeExpand = useCallback(() => setExpandOpen(false), []);

  useEffect(() => {
    if (!expandOpen) return;
    function onDoc(event: MouseEvent) {
      if (!expandRef.current) return;
      if (!expandRef.current.contains(event.target as Node)) setExpandOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [expandOpen]);

  useRovingMenu(expandOpen, expandMenuRef, expandTriggerRef, closeExpand);

  if (!crumbs.length) return null;

  const tailFirst = crumbs[0]!;
  const tailLast = crumbs[crumbs.length - 1]!;
  const middle = crumbs.slice(1, -1);

  return (
    <nav aria-label="Breadcrumb" className="hidden min-w-0 items-center gap-1 text-sm md:flex">
      <CrumbLink crumb={tailFirst} onNavigate={onNavigate} />
      {middle.length === 0 && crumbs.length > 1 ? (
        <>
          <Separator />
          <CrumbLink crumb={tailLast} onNavigate={onNavigate} />
        </>
      ) : null}
      {/* Short trail (≤3 crumbs → at most 1 middle): render it inline so
          'Dashboard › Process › Function' is fully visible. Only collapse
          into the '…' menu for longer trails (≥4 crumbs). */}
      {middle.length > 0 && middle.length <= 1 ? (
        <>
          {middle.map((c) => (
            <span key={`${c.label}-${c.to ?? ''}`} className="flex items-center gap-1">
              <Separator />
              <CrumbLink crumb={c} onNavigate={onNavigate} />
            </span>
          ))}
          <Separator />
          <CrumbLink crumb={tailLast} onNavigate={onNavigate} />
        </>
      ) : null}
      {middle.length > 1 ? (
        <>
          <Separator />
          <div ref={expandRef} className="relative">
            <button
              ref={expandTriggerRef}
              type="button"
              aria-label={`Show ${middle.length} hidden breadcrumb segment${middle.length === 1 ? '' : 's'}`}
              aria-haspopup="menu"
              aria-expanded={expandOpen}
              onClick={() => setExpandOpen((v) => !v)}
              className="rounded px-1.5 py-0.5 text-gray-500 hover:bg-gray-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand dark:text-gray-400 dark:hover:bg-gray-800"
            >
              …
            </button>
            {expandOpen ? (
              <div
                ref={expandMenuRef}
                role="menu"
                aria-label="Hidden breadcrumb segments"
                style={{ zIndex: Z.headerPopover }}
                className="absolute left-0 top-full mt-1 min-w-[200px] rounded-lg border border-gray-200 bg-white p-1 shadow-lg dark:border-gray-700 dark:bg-gray-900"
              >
                {middle.map((c) => (
                  <CrumbMenuItem key={`${c.label}-${c.to ?? ''}`} crumb={c} onNavigate={onNavigate} onClose={() => setExpandOpen(false)} />
                ))}
              </div>
            ) : null}
          </div>
          <Separator />
          <CrumbLink crumb={tailLast} onNavigate={onNavigate} />
        </>
      ) : null}
    </nav>
  );
}

export function BreadcrumbMobile({
  crumbs,
  onNavigate,
}: {
  crumbs: Crumb[];
  onNavigate?: (event: React.MouseEvent<HTMLAnchorElement>, to: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return;
    function onDoc(event: MouseEvent) {
      if (!wrapRef.current) return;
      if (!wrapRef.current.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  useRovingMenu(open, menuRef, triggerRef, close);

  if (!crumbs.length) return null;
  const last = crumbs[crumbs.length - 1]!;
  return (
    <div ref={wrapRef} className="relative min-w-0 md:hidden">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="inline-flex max-w-[18ch] items-center gap-1 truncate rounded px-1.5 py-0.5 text-sm font-medium text-gray-900 hover:bg-gray-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand dark:text-gray-100 dark:hover:bg-gray-800"
        title={last.label}
      >
        <span className="truncate">{last.label}</span>
      </button>
      {open ? (
        <div
          ref={menuRef}
          role="menu"
          aria-label="Breadcrumb navigation"
          style={{ zIndex: Z.headerPopover }}
          className="absolute left-0 top-full mt-1 w-max min-w-[200px] max-w-[320px] rounded-lg border border-gray-200 bg-white p-1 shadow-lg dark:border-gray-700 dark:bg-gray-900"
        >
          {crumbs.map((c, i) => (
            <CrumbMenuItem
              key={`${c.label}-${i}`}
              crumb={c}
              onNavigate={onNavigate}
              onClose={() => setOpen(false)}
              current={i === crumbs.length - 1}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function CrumbLink({
  crumb,
  onNavigate,
}: {
  crumb: Crumb;
  onNavigate: ((event: React.MouseEvent<HTMLAnchorElement>, to: string) => void) | undefined;
}) {
  const isCurrent = !crumb.to;
  const commonCls = 'inline-block max-w-[24ch] truncate text-sm';
  if (isCurrent) {
    return (
      <span
        aria-current="page"
        title={crumb.label}
        className={`${commonCls} font-medium text-gray-900 dark:text-gray-100`}
      >
        {crumb.label}
      </span>
    );
  }
  return (
    <Link
      to={crumb.to!}
      onClick={(e) => onNavigate?.(e, crumb.to!)}
      title={crumb.label}
      className={`${commonCls} text-gray-500 hover:text-gray-900 hover:underline dark:text-gray-400 dark:hover:text-gray-100`}
    >
      {crumb.label}
    </Link>
  );
}

function CrumbMenuItem({
  crumb,
  onNavigate,
  onClose,
  current = false,
}: {
  crumb: Crumb;
  onNavigate: ((event: React.MouseEvent<HTMLAnchorElement>, to: string) => void) | undefined;
  onClose: () => void;
  current?: boolean;
}) {
  if (!crumb.to || current) {
    return (
      <div className="px-3 py-2 text-sm font-medium text-gray-900 dark:text-gray-100" role="menuitem" aria-current={current ? 'page' : undefined}>
        {crumb.label}
      </div>
    );
  }
  return (
    <Link
      to={crumb.to}
      role="menuitem"
      onClick={(e) => {
        onNavigate?.(e, crumb.to!);
        onClose();
      }}
      className="block rounded px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 dark:text-gray-200 dark:hover:bg-gray-800"
    >
      {crumb.label}
    </Link>
  );
}

function Separator() {
  return <ChevronRight size={14} className="shrink-0 text-gray-300 dark:text-gray-600" aria-hidden="true" />;
}

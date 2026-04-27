/**
 * TopBar — unified application top navigation bar.
 *
 * TopBarLegacy.tsx and TopBarNew.tsx have been merged into this single file.
 * The process-aware legacy bar is retained as `TopBarProcess` for internal
 * use by backward-compatible consumers; external consumers should use `TopBar`.
 */
import { AlertTriangle, Menu, X } from 'lucide-react';
import { useCallback, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import toast from 'react-hot-toast';
import { Link, useNavigate } from 'react-router-dom';
import { BrandMark } from '../shared/BrandMark';
import { useKeyboardShortcut } from '../../hooks/useKeyboardShortcut';
import { AvatarMenu } from './AvatarMenu';
import { Breadcrumb, BreadcrumbMobile } from './Breadcrumb';
import { PrimaryHeaderAction } from './HeaderActions';
import { NotificationBell } from './NotificationBell';
import { OverflowMenu } from './OverflowMenu';
import { useHeaderFlag, useHeaderShape } from './PageHeaderContext';
import { RealtimeStatusPill } from './RealtimeStatusPill';
import { Z } from './pageHeader.types';

type ShapeAction = ReturnType<typeof useHeaderShape>['primary'][number];

export function TopBar({ sidebarToggle }: { sidebarToggle?: ReactNode }) {
  const shape = useHeaderShape();
  const navigate = useNavigate();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [collapseSecondary, setCollapseSecondary] = useState(false);

  const leaveGuard = shape.leaveGuard;
  const guardNavigate = useCallback(
    (event: React.MouseEvent<HTMLAnchorElement>, to: string) => {
      if (!leaveGuard) return;
      if (leaveGuard()) return;
      event.preventDefault();
      toast(
        (t) => (
          <div className="flex items-center gap-3">
            <AlertTriangle size={16} className="shrink-0 text-amber-500" />
            <span className="text-sm">Leave without saving this audit as a version?</span>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => {
                  toast.dismiss(t.id);
                  void navigate(to);
                }}
                className="rounded-md bg-gray-900 px-2 py-1 text-xs font-medium text-white hover:bg-gray-800"
              >
                Leave
              </button>
              <button
                type="button"
                onClick={() => toast.dismiss(t.id)}
                className="rounded-md border border-gray-300 px-2 py-1 text-xs font-medium hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800"
              >
                Stay
              </button>
            </div>
          </div>
        ),
        { duration: 6000 },
      );
    },
    [navigate, leaveGuard],
  );

  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width ?? el.clientWidth;
      setCollapseSecondary(width < 720);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const [primariesVisible, primariesToOverflow] =
    collapseSecondary && shape.primary.length > 1
      ? [shape.primary.slice(0, 1), shape.primary.slice(1)]
      : [shape.primary, [] as typeof shape.primary];

  const overflow = [...primariesToOverflow, ...shape.overflow];
  const shortcutBindings = shape.primary.filter((a) => a.shortcut);

  return (
    <header
      ref={containerRef}
      style={{ zIndex: Z.header }}
      className="sticky top-0 flex h-12 items-center gap-2 border-b border-gray-200 bg-white/90 px-3 shadow-sm backdrop-blur supports-[backdrop-filter]:bg-white/75 sm:h-[52px] sm:px-5 dark:border-gray-800 dark:bg-gray-950/90 dark:supports-[backdrop-filter]:bg-gray-950/75"
    >
      <div className="flex min-w-0 shrink-0 items-center gap-2">
        {sidebarToggle ?? null}
        <Link
          to="/"
          onClick={(e) => guardNavigate(e, '/')}
          className="flex shrink-0 items-center rounded-md outline-none focus-visible:ring-2 focus-visible:ring-brand"
          title="Back to dashboard"
        >
          <BrandMark compact />
        </Link>
      </div>

      <div className="mx-1 flex min-w-0 flex-1 items-center gap-1 sm:mx-2">
        <Breadcrumb crumbs={shape.breadcrumbs ?? []} onNavigate={guardNavigate} />
        <BreadcrumbMobile crumbs={shape.breadcrumbs ?? []} onNavigate={guardNavigate} />
      </div>

      <div className="flex shrink-0 items-center gap-1 sm:gap-2">
        {primariesVisible.length > 0 ? (
          <div className="hidden items-center gap-2 sm:flex">
            {primariesVisible.map((a) => (
              <PrimaryHeaderAction key={a.id} action={a} />
            ))}
          </div>
        ) : null}
        {primariesVisible.length > 0 ? (
          <div className="flex items-center gap-1 sm:hidden">
            {primariesVisible.map((a) => (
              <PrimaryHeaderAction key={a.id} action={a} iconOnly />
            ))}
          </div>
        ) : null}
        <OverflowMenu actions={overflow} />
        {shape.showRealtime ? <RealtimeStatusPill /> : null}
        {shape.showNotifications ? <NotificationBell /> : null}
        <AvatarMenu onBeforeNavigate={guardNavigate} />
      </div>
      {shortcutBindings.map((a) => (
        <ShortcutBinding key={a.id} action={a} />
      ))}
    </header>
  );
}

function ShortcutBinding({ action }: { action: ShapeAction }) {
  const flag = useHeaderFlag(action.id);
  const enabled = Boolean(action.shortcut) && !flag.disabled && !flag.loading;
  useKeyboardShortcut(action.shortcut ?? '', () => action.onClick(), enabled);
  return null;
}

export function MobileSidebarToggle({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label={open ? 'Close navigation' : 'Open navigation'}
      aria-expanded={open}
      className="inline-flex h-9 w-9 items-center justify-center rounded-md text-gray-600 hover:bg-gray-100 md:hidden dark:text-gray-300 dark:hover:bg-gray-800"
    >
      {open ? <X size={18} /> : <Menu size={18} />}
    </button>
  );
}

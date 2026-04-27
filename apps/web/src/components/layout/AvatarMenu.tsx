import { LogOut, Bug, Users, FileText } from 'lucide-react';
import { ThemeToggle } from './ThemeToggle';
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useCurrentUser, type SessionUserInfo } from '../auth/authContext';
import { Z } from './pageHeader.types';

async function signOutAndRedirect(navigate: ReturnType<typeof useNavigate>) {
  try {
    await fetch('/api/v1/auth/logout', { method: 'POST', credentials: 'include' });
  } catch {
    // Ignore network errors — we still want the user to end up on /login.
  }
  void navigate('/login');
}

function getInitials(user: SessionUserInfo | null): string {
  if (!user) return '?';
  const emailLocal = user.email?.split('@')[0] ?? '';
  const source = (user.displayName?.trim() || emailLocal) ?? '';
  if (!source) return '?';
  const parts = source.split(/[\s._-]+/).filter(Boolean);
  if (parts.length >= 2) {
    const first = parts[0]?.[0] ?? '';
    const last = parts[parts.length - 1]?.[0] ?? '';
    return (first + last).toUpperCase() || '?';
  }
  return source.slice(0, 2).toUpperCase();
}

export function AvatarMenu({
  onBeforeNavigate,
}: {
  onBeforeNavigate?: ((e: React.MouseEvent<HTMLAnchorElement>, to: string) => void) | undefined;
}) {
  const user = useCurrentUser();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const initials = getInitials(user);
  const isAdmin = user?.role === 'admin';
  const isDev = import.meta.env.DEV;

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

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={user ? `Account menu for ${user.displayName || user.email}` : 'Account menu'}
        onClick={() => setOpen((v) => !v)}
        className="flex h-9 w-9 items-center justify-center rounded-full bg-brand text-xs font-semibold text-white ring-1 ring-brand-hover/40 hover:bg-brand-hover focus:outline-none focus:ring-2 focus:ring-brand focus:ring-offset-1"
      >
        {initials}
      </button>
      {open ? (
        <div
          role="menu"
          style={{ zIndex: Z.headerPopover }}
          className="absolute right-0 top-full mt-2 w-64 overflow-hidden rounded-lg border border-gray-200 bg-white shadow-xl dark:border-gray-700 dark:bg-gray-900"
        >
          {user ? (
            <div className="border-b border-gray-100 px-3 py-2 dark:border-gray-800">
              <div className="truncate text-sm font-semibold text-gray-900 dark:text-gray-100">{user.displayName || user.email}</div>
              <div className="truncate text-xs text-gray-500 dark:text-gray-400">{user.email}</div>
              {user.tenantDisplayCode ? (
                <div className="mt-0.5 text-[10px] uppercase tracking-wide text-gray-400">{user.tenantDisplayCode}</div>
              ) : null}
            </div>
          ) : null}
          <div className="py-1">
            {isAdmin ? (
              <MenuLink to="/admin/directory" icon={<Users size={14} />} label="Manager directory" onNavigate={onBeforeNavigate} onClose={() => setOpen(false)} />
            ) : null}
            {isAdmin ? (
              <MenuLink to="/admin/templates" icon={<FileText size={14} />} label="Escalation templates" onNavigate={onBeforeNavigate} onClose={() => setOpen(false)} />
            ) : null}
            {isDev ? (
              <MenuLink to="/debug" icon={<Bug size={14} />} label="Debug log" onNavigate={onBeforeNavigate} onClose={() => setOpen(false)} />
            ) : null}
          </div>
          <div className="border-t border-gray-100 py-1 dark:border-gray-800">
            <ThemeToggle />
          </div>
          <div className="border-t border-gray-100 py-1 dark:border-gray-800">
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                void signOutAndRedirect(navigate);
              }}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-50 dark:text-gray-200 dark:hover:bg-gray-800"
            >
              <LogOut size={14} />
              Sign out
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function MenuLink({
  to,
  icon,
  label,
  onNavigate,
  onClose,
}: {
  to: string;
  icon: React.ReactNode;
  label: string;
  onNavigate: ((e: React.MouseEvent<HTMLAnchorElement>, to: string) => void) | undefined;
  onClose: () => void;
}) {
  return (
    <Link
      to={to}
      role="menuitem"
      onClick={(e) => {
        onNavigate?.(e, to);
        onClose();
      }}
      className="flex items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 dark:text-gray-200 dark:hover:bg-gray-800"
    >
      {icon}
      {label}
    </Link>
  );
}

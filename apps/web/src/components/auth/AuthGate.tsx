import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { applySessionUserForLocalWorkspace } from '../../lib/sessionWorkspace';
import { fetchProcessesFromApi } from '../../lib/api/processesApi';
import { useAppStore } from '../../store/useAppStore';

/**
 * Guard a tree of routes behind the backend session, and expose the session
 * user via React context so downstream components don't all refetch /auth/me.
 *
 * On mount: call /api/v1/auth/me. If 200 → authed, provide user. If 401 →
 * redirect to /login with a 'from' state. When the signed-in user changes,
 * clear browser-only workspace data so a second account can't inherit the
 * first account's local cache.
 */

export interface SessionUserInfo {
  displayCode: string;
  displayName: string;
  email: string;
  role: 'admin' | 'auditor' | 'viewer';
}

type SessionState =
  | { phase: 'checking' }
  | { phase: 'authed'; user: SessionUserInfo }
  | { phase: 'unauthed' };

const CurrentUserContext = createContext<SessionUserInfo | null>(null);

export function useCurrentUser(): SessionUserInfo | null {
  return useContext(CurrentUserContext);
}

/** Non-null variant for code paths that are only mounted inside AuthGate. */
export function useCurrentUserOrThrow(): SessionUserInfo {
  const user = useContext(CurrentUserContext);
  if (!user) throw new Error('useCurrentUserOrThrow called outside AuthGate');
  return user;
}

export function AuthGate({ children }: { children: ReactNode }) {
  const location = useLocation();
  const [session, setSession] = useState<SessionState>({ phase: 'checking' });
  const reconcileProcessesFromServer = useAppStore((state) => state.reconcileProcessesFromServer);
  const lastFocusRefreshAt = useRef(0);

  async function refreshProcesses() {
    try {
      const remote = await fetchProcessesFromApi();
      if (remote !== null) reconcileProcessesFromServer(remote);
    } catch {
      // Network issue — keep local state as-is.
    }
  }

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch('/api/v1/auth/me', { credentials: 'include' });
        if (!res.ok) {
          if (!cancelled) setSession({ phase: 'unauthed' });
          return;
        }
        const body = (await res.json()) as { user: SessionUserInfo };
        if (!cancelled) {
          applySessionUserForLocalWorkspace(body.user.email);
          setSession({ phase: 'authed', user: body.user });
          void refreshProcesses();
        }
      } catch {
        if (!cancelled) setSession({ phase: 'unauthed' });
      }
    })();
    return () => {
      cancelled = true;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (session.phase !== 'authed') return;
    function onFocus() {
      if (Date.now() - lastFocusRefreshAt.current < 30_000) return;
      lastFocusRefreshAt.current = Date.now();
      void refreshProcesses();
    }
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.phase]);

  if (session.phase === 'checking') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 text-sm text-gray-500 dark:bg-gray-950">
        Checking session…
      </div>
    );
  }
  if (session.phase === 'unauthed') {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }
  return <CurrentUserContext.Provider value={session.user}>{children}</CurrentUserContext.Provider>;
}

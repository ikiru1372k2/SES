import { useEffect, useState, type ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';

/**
 * Guard a tree of routes behind the backend session.
 *
 * We call /api/v1/auth/me on mount. If it 200s we have a cookie and render
 * the children. If it 401s we redirect to /login, remembering where the user
 * was trying to go so we can bounce them back after sign-in.
 *
 * Zero state management beyond this — TanStack Query isn't wired in yet and
 * the app already has its own Zustand store for process data; adding another
 * auth store would overlap. A plain fetch + state is enough at this scale.
 */

type SessionState =
  | { phase: 'checking' }
  | { phase: 'authed'; user: { displayCode: string; displayName: string; email: string; role: string } }
  | { phase: 'unauthed' };

export function AuthGate({ children }: { children: ReactNode }) {
  const location = useLocation();
  const [session, setSession] = useState<SessionState>({ phase: 'checking' });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/v1/auth/me', { credentials: 'include' });
        if (!res.ok) {
          if (!cancelled) setSession({ phase: 'unauthed' });
          return;
        }
        const body = (await res.json()) as {
          user: { displayCode: string; displayName: string; email: string; role: string };
        };
        if (!cancelled) setSession({ phase: 'authed', user: body.user });
      } catch {
        if (!cancelled) setSession({ phase: 'unauthed' });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

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
  return <>{children}</>;
}

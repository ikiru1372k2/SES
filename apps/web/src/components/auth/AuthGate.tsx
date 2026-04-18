import { useEffect, useState, type ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { applySessionUserForLocalWorkspace } from '../../lib/sessionWorkspace';

/**
 * Guard a tree of routes behind the backend session.
 *
 * We call /api/v1/auth/me on mount. If it 200s we have a cookie and render
 * the children. If it 401s we redirect to /login, remembering where the user
 * was trying to go so we can bounce them back after sign-in.
 *
 * When the signed-in user changes, `applySessionUserForLocalWorkspace` clears
 * browser-only process data so another account cannot see or delete the
 * previous user's local workspace (same profile / non-incognito).
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
        if (!cancelled) {
          applySessionUserForLocalWorkspace(body.user.email);
          setSession({ phase: 'authed', user: body.user });
        }
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

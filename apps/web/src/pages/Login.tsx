import { FormEvent, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { applySessionUserForLocalWorkspace } from '../lib/sessionWorkspace';
import { BrandMark } from '../components/shared/BrandMark';
import { Button } from '../components/shared/Button';

/**
 * Minimal dev-login page.
 *
 * This exists so a developer (or a tester on a fresh install) can get an
 * authenticated cookie without running OIDC. It calls /api/v1/auth/dev-login
 * which the backend only honours when SES_ALLOW_DEV_LOGIN=true in .env.
 *
 * The page deliberately lists the two seeded users with one-click buttons so
 * you can open two browser profiles / incognito windows and be logged in as
 * two different users in under 30 seconds. That's the setup required to see
 * the realtime collaboration features work.
 *
 * When OIDC is wired up later, this page becomes a fallback and the real
 * login form replaces the email input.
 */

const SEEDED_USERS = [
  { email: 'admin@ses.local', label: 'SES Admin', role: 'admin' },
  { email: 'auditor@ses.local', label: 'SES Auditor', role: 'auditor' },
] as const;

export function Login() {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function loginAs(identifier: string) {
    if (!identifier.trim()) {
      toast.error('Enter an email address first.');
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch('/api/v1/auth/dev-login', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier: identifier.trim() }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ message: 'Login failed' }));
        // 403 → SES_ALLOW_DEV_LOGIN is not true on the server.
        // 401 → unknown identifier.
        toast.error(err.message ?? `Login failed (${res.status})`);
        return;
      }
      const data = (await res.json()) as { user: { displayName: string; email: string } };
      applySessionUserForLocalWorkspace(data.user.email ?? identifier.trim());
      toast.success(`Signed in as ${data.user.displayName}`);
      navigate('/');
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    void loginAs(email);
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-10 dark:bg-gray-950">
      <div className="w-full max-w-md rounded-xl border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-800 dark:bg-gray-900">
        <div className="mb-6">
          <BrandMark />
        </div>
        <h1 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Sign in</h1>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          Development environment — pick a seeded user or enter an email.
        </p>

        <form className="mt-5 space-y-3" onSubmit={onSubmit}>
          <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300">
            Email
          </label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            className="w-full rounded border border-gray-300 px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
            autoComplete="email"
          />
          <Button type="submit" disabled={submitting || !email.trim()}>
            {submitting ? 'Signing in…' : 'Sign in'}
          </Button>
        </form>

        <div className="mt-6 border-t border-gray-200 pt-5 dark:border-gray-700">
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
            Quick login (seeded users)
          </p>
          <div className="mt-3 space-y-2">
            {SEEDED_USERS.map((user) => (
              <button
                key={user.email}
                type="button"
                onClick={() => loginAs(user.email)}
                disabled={submitting}
                className="block w-full rounded-lg border border-gray-200 px-3 py-2 text-left text-sm hover:border-brand hover:bg-brand/5 disabled:opacity-50 dark:border-gray-700 dark:hover:border-brand dark:hover:bg-brand/10"
              >
                <div className="font-medium text-gray-900 dark:text-gray-100">{user.label}</div>
                <div className="text-xs text-gray-500">
                  {user.email} · {user.role}
                </div>
              </button>
            ))}
          </div>
        </div>

        <p className="mt-5 text-[11px] text-gray-400">
          Dev login requires <code className="rounded bg-gray-100 px-1 dark:bg-gray-800">SES_ALLOW_DEV_LOGIN=true</code>{' '}
          in your server <code className="rounded bg-gray-100 px-1 dark:bg-gray-800">.env</code>.
        </p>
      </div>
    </div>
  );
}

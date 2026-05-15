import { FormEvent, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { applySessionUserForLocalWorkspace } from '../lib/sessionWorkspace';
import { BrandMark } from '../components/shared/BrandMark';
import { Button } from '../components/shared/Button';
import { loginOnApi } from '../lib/api/authApi';

const SEEDED_USERS = [
  { email: 'admin@ses.local', label: 'SES Admin', role: 'admin' },
  { email: 'auditor@ses.local', label: 'SES Auditor', role: 'auditor' },
] as const;

export function Login() {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [devSubmitting, setDevSubmitting] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    const trimmed = email.trim();
    if (!trimmed || !password) {
      toast.error('Enter your email and password.');
      return;
    }
    setSubmitting(true);
    try {
      const data = await loginOnApi({ email: trimmed, password });
      applySessionUserForLocalWorkspace(data.user.email);
      toast.success(`Signed in as ${data.user.displayName}`);
      void navigate('/');
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  async function devLoginAs(identifier: string) {
    setDevSubmitting(true);
    try {
      const res = await fetch('/api/v1/auth/dev-login', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier: identifier.trim() }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ message: 'Dev login failed' }));
        toast.error(err.message ?? `Dev login failed (${res.status})`);
        return;
      }
      const data = (await res.json()) as { user: { displayName: string; email: string } };
      applySessionUserForLocalWorkspace(data.user.email ?? identifier.trim());
      toast.success(`Signed in as ${data.user.displayName}`);
      void navigate('/');
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setDevSubmitting(false);
    }
  }

  const busy = submitting || devSubmitting;

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-10 dark:bg-gray-950">
      <div className="w-full max-w-md rounded-xl border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-800 dark:bg-gray-900">
        <div className="mb-6">
          <BrandMark />
        </div>
        <h1 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Sign in</h1>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          Use your email and password.
        </p>

        <form className="mt-5 space-y-3" onSubmit={onSubmit}>
          <div>
            <label htmlFor="login-email" className="block text-xs font-semibold text-gray-700 dark:text-gray-300">
              Email
            </label>
            <input
              id="login-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
              autoComplete="email"
              required
            />
          </div>
          <div>
            <label htmlFor="login-password" className="block text-xs font-semibold text-gray-700 dark:text-gray-300">
              Password
            </label>
            <input
              id="login-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
              autoComplete="current-password"
              required
            />
          </div>
          <Button type="submit" disabled={busy || !email.trim() || !password}>
            {submitting ? 'Signing in…' : 'Sign in'}
          </Button>
        </form>

        <p className="mt-3 text-sm text-gray-500 dark:text-gray-400">
          Don&apos;t have an account?{' '}
          <Link to="/signup" className="font-medium text-brand hover:underline">
            Sign up
          </Link>
        </p>

        {/* Dev-login fallback: only rendered in non-production builds. The
            server-side SES_ALLOW_DEV_LOGIN flag is omitted in deploy.sh
            local/EC2, so even with this block visible the endpoint would
            refuse — hiding it removes the dead UI for end users. */}
        {import.meta.env.PROD ? null : (
          <details className="mt-6 border-t border-gray-200 pt-5 dark:border-gray-700">
            <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wide text-gray-500">
              Dev fallback (seeded users)
            </summary>
            <p className="mt-2 text-[11px] text-gray-400">
              For local development only. Requires{' '}
              <code className="rounded bg-gray-100 px-1 dark:bg-gray-800">SES_ALLOW_DEV_LOGIN=true</code>{' '}
              on the server.
            </p>
            <div className="mt-3 space-y-2">
              {SEEDED_USERS.map((user) => (
                <button
                  key={user.email}
                  type="button"
                  onClick={() => void devLoginAs(user.email)}
                  disabled={busy}
                  className="block w-full rounded-lg border border-gray-200 px-3 py-2 text-left text-sm hover:border-brand hover:bg-brand/5 disabled:opacity-50 dark:border-gray-700 dark:hover:border-brand dark:hover:bg-brand/10"
                >
                  <div className="font-medium text-gray-900 dark:text-gray-100">{user.label}</div>
                  <div className="text-xs text-gray-500">
                    {user.email} · {user.role}
                  </div>
                </button>
              ))}
            </div>
          </details>
        )}
      </div>
    </div>
  );
}

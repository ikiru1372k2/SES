import { FormEvent, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Check, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { applySessionUserForLocalWorkspace } from '../lib/storage/sessionWorkspace';
import { BrandMark } from '../components/shared/BrandMark';
import { Button } from '../components/shared/Button';
import { PasswordInput } from '../components/shared/PasswordInput';
import { signupOnApi } from '../lib/api/authApi';

export function Signup() {
  const navigate = useNavigate();
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);

  // Live password-match indicator: only meaningful once both fields have
  // content. `null` means "don't show anything yet".
  const passwordsMatch =
    password.length > 0 && confirmPassword.length > 0 ? password === confirmPassword : null;

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    const trimmedDisplayName = displayName.trim();
    const trimmedEmail = email.trim();

    if (trimmedDisplayName.length < 2) {
      setValidationError('Display name must be at least 2 characters.');
      return;
    }
    if (password.length < 8) {
      setValidationError('Password must be at least 8 characters.');
      return;
    }
    if (password !== confirmPassword) {
      setValidationError('Passwords do not match.');
      return;
    }
    setValidationError(null);
    setSubmitting(true);
    try {
      // Public sign-ups are always auditors. Admin promotion happens via
      // the admin Directory tools, never the public form (audit U-04 / G-2).
      const data = await signupOnApi({
        email: trimmedEmail,
        displayName: trimmedDisplayName,
        password,
        role: 'auditor',
      });
      applySessionUserForLocalWorkspace(data.user.email);
      toast.success(`Account created — signed in as ${data.user.displayName}`);
      void navigate('/');
    } catch (err) {
      const message = (err as Error).message;
      setValidationError(message);
      toast.error(message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-10 dark:bg-gray-950">
      <div className="w-full max-w-md rounded-xl border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-800 dark:bg-gray-900">
        <div className="mb-6">
          <BrandMark />
        </div>
        <h1 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Create account</h1>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          Sign up with your email and a password.
        </p>

        <form className="mt-5 space-y-3" onSubmit={onSubmit} noValidate>
          <div>
            <label htmlFor="signup-displayName" className="block text-xs font-semibold text-gray-700 dark:text-gray-300">
              Display name
            </label>
            <input
              id="signup-displayName"
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Jane Doe"
              className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus-visible:border-brand focus-visible:ring-2 focus-visible:ring-brand dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
              autoComplete="name"
              minLength={2}
              maxLength={120}
              required
            />
          </div>
          <div>
            <label htmlFor="signup-email" className="block text-xs font-semibold text-gray-700 dark:text-gray-300">
              Email
            </label>
            <input
              id="signup-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus-visible:border-brand focus-visible:ring-2 focus-visible:ring-brand dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
              autoComplete="email"
              required
            />
          </div>
          <div>
            <label htmlFor="signup-password" className="block text-xs font-semibold text-gray-700 dark:text-gray-300">
              Password
            </label>
            <div className="mt-1">
              <PasswordInput
                id="signup-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="At least 8 characters"
                autoComplete="new-password"
                minLength={8}
                required
              />
            </div>
          </div>
          <div>
            <label htmlFor="signup-confirm" className="block text-xs font-semibold text-gray-700 dark:text-gray-300">
              Confirm password
            </label>
            <div className="mt-1">
              <PasswordInput
                id="signup-confirm"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Re-enter your password"
                autoComplete="new-password"
                required
              />
            </div>
            {passwordsMatch !== null ? (
              <p
                role="status"
                className={`mt-1 flex items-center gap-1 text-[11px] font-medium ${
                  passwordsMatch ? 'text-success-700' : 'text-danger-700'
                }`}
              >
                {passwordsMatch ? <Check size={12} /> : <X size={12} />}
                {passwordsMatch ? 'Passwords match.' : 'Passwords do not match.'}
              </p>
            ) : null}
          </div>

          {validationError ? (
            <p role="alert" className="text-xs font-medium text-danger-700 dark:text-red-400">
              {validationError}
            </p>
          ) : null}

          <Button type="submit" loading={submitting}>
            Create account
          </Button>
        </form>

        <p className="mt-5 text-sm text-gray-500 dark:text-gray-400">
          Already have an account?{' '}
          <Link to="/login" className="font-medium text-brand hover:underline">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}

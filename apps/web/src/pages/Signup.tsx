import { FormEvent, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Check, Mail, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { applySessionUserForLocalWorkspace } from '../lib/storage/sessionWorkspace';
import { AuthShell } from '../components/shared/AuthShell';
import { Button } from '../components/shared/Button';
import { Input } from '../components/shared/Input';
import { PasswordInput } from '../components/shared/PasswordInput';
import { scorePassword } from '../lib/passwordStrength';
import { signupOnApi } from '../lib/api/authApi';

const LABEL = 'mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.04em] text-ink-2 dark:text-gray-300';

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

  // Visual-only strength meter (does not gate submit).
  const strength = scorePassword(password);

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
    <AuthShell
      title="Create your account"
      subtitle="Sign up with your work email."
      footer={
        <>
          Already have an account?{' '}
          <Link to="/login" className="font-semibold text-brand hover:underline">
            Sign in
          </Link>
        </>
      }
    >
      <form className="space-y-4" onSubmit={onSubmit} noValidate>
        <div>
          <label htmlFor="signup-displayName" className={LABEL}>
            Display name
          </label>
          <Input
            id="signup-displayName"
            type="text"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="Jane Doe"
            autoComplete="name"
            minLength={2}
            maxLength={120}
            required
          />
        </div>
        <div>
          <label htmlFor="signup-email" className={LABEL}>
            Email
          </label>
          <Input
            id="signup-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            autoComplete="email"
            leading={<Mail size={15} />}
            required
          />
        </div>
        <div>
          <label htmlFor="signup-password" className={LABEL}>
            Password
          </label>
          <PasswordInput
            id="signup-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="At least 8 characters"
            autoComplete="new-password"
            minLength={8}
            required
          />
          {strength.label ? (
            <div className="mt-2 flex items-center gap-2">
              <span
                className="h-1 flex-1 overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700"
                aria-hidden="true"
              >
                <span
                  className={`block h-full rounded-full transition-all duration-300 ${strength.barClass}`}
                  style={{ width: strength.width }}
                />
              </span>
              <span
                role="status"
                className={`text-[11px] font-semibold ${
                  strength.score >= 3
                    ? 'text-success-700'
                    : strength.score === 2
                      ? 'text-warning-700'
                      : 'text-danger-700'
                }`}
              >
                {strength.label}
              </span>
            </div>
          ) : null}
        </div>
        <div>
          <label htmlFor="signup-confirm" className={LABEL}>
            Confirm password
          </label>
          <PasswordInput
            id="signup-confirm"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            placeholder="Re-enter your password"
            autoComplete="new-password"
            required
          />
          {passwordsMatch !== null ? (
            <p
              role="status"
              className={`mt-1.5 flex items-center gap-1 text-[11px] font-medium ${
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

        <Button type="submit" loading={submitting} className="w-full">
          Create account
        </Button>
      </form>
    </AuthShell>
  );
}

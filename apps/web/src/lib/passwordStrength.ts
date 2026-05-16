// Lightweight client-side password-strength heuristic. Visual feedback only —
// it does NOT gate submission (the existing `password.length < 8` rule in
// Signup is the source of truth). No dependencies.

export type PasswordStrength = {
  /** 0 (empty) … 4 (strong). */
  score: 0 | 1 | 2 | 3 | 4;
  /** Human label for the meter. '' when there is nothing to show. */
  label: '' | 'Weak' | 'Fair' | 'Good' | 'Strong';
  /** Tailwind bg-* class for the filled portion of the meter bar. */
  barClass: string;
  /** Filled width as a percentage string, e.g. '75%'. */
  width: string;
};

export function scorePassword(password: string): PasswordStrength {
  if (!password) {
    return { score: 0, label: '', barClass: 'bg-transparent', width: '0%' };
  }

  let points = 0;
  if (password.length >= 8) points += 1;
  if (password.length >= 12) points += 1;
  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) points += 1;
  if (/\d/.test(password)) points += 1;
  if (/[^A-Za-z0-9]/.test(password)) points += 1;

  // Map raw points (0–5) onto a 1–4 score so any non-empty value shows
  // something, and only genuinely strong passwords reach 4.
  const score = (Math.min(4, Math.max(1, points)) as 1 | 2 | 3 | 4);

  const table: Record<1 | 2 | 3 | 4, Omit<PasswordStrength, 'score'>> = {
    1: { label: 'Weak', barClass: 'bg-danger-500', width: '25%' },
    2: { label: 'Fair', barClass: 'bg-warning-500', width: '50%' },
    3: { label: 'Good', barClass: 'bg-success-500', width: '75%' },
    4: { label: 'Strong', barClass: 'bg-success-700', width: '100%' },
  };

  return { score, ...table[score] };
}

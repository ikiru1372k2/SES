import type { ReactNode } from 'react';
import { BrandMark } from './BrandMark';

// Presentational wrapper for public auth surfaces (Login, Signup). Owns the
// warm page background, subtle soft-depth, and the centered premium card so
// the two screens stay visually consistent and DRY. No logic — children are
// the form. Brand identity (logo, colors) is delegated to BrandMark unchanged.
export function AuthShell({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-surface-app px-4 py-10 dark:bg-gray-950">
      {/* Soft radial depth — static, no animation, harmless under
          prefers-reduced-motion. Brand-tinted but very low opacity. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(60rem_40rem_at_50%_-10%,rgba(176,0,32,0.05),transparent)] dark:bg-[radial-gradient(60rem_40rem_at_50%_-10%,rgba(176,0,32,0.12),transparent)]"
      />
      <div className="relative w-full max-w-[400px]">
        <div className="rounded-xl border border-rule bg-white p-7 shadow-panel dark:border-gray-800 dark:bg-gray-900">
          <BrandMark />
          <h1 className="mt-6 text-xl font-bold tracking-tight text-ink dark:text-white">
            {title}
          </h1>
          <p className="mt-1 text-[13px] text-ink-3 dark:text-gray-400">{subtitle}</p>
          <div className="mt-6">{children}</div>
        </div>
        {footer ? (
          <p className="mt-5 text-center text-[12px] text-ink-3 dark:text-gray-400">{footer}</p>
        ) : null}
      </div>
    </div>
  );
}

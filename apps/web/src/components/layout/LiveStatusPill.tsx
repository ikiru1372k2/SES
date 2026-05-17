/** Green "Live" pill shown when the realtime socket is connected. */
export function LiveStatusPill() {
  return (
    <span
      role="status"
      aria-live="polite"
      className="inline-flex items-center gap-1.5 rounded-full border border-success-200 bg-success-50 px-2.5 py-1 text-xs font-medium text-success-800 dark:border-emerald-800/60 dark:bg-emerald-950/40 dark:text-emerald-200"
      title="Connected to live updates"
    >
      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-success-500" aria-hidden />
      Live
    </span>
  );
}

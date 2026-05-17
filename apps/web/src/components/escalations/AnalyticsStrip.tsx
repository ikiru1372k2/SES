import { useMemo } from 'react';
import type { ProcessEscalationManagerRow } from '@ses/domain';

interface Props {
  rows: ProcessEscalationManagerRow[];
  /** Caller-supplied "now" in ms — lets the parent drive ticking via a state
   *  update without this component calling impure `Date.now()` in render. */
  now: number;
}

function slaBucket(now: number, row: ProcessEscalationManagerRow): 'breached' | 'due_soon' | 'ok' {
  const isClosed = row.resolved || row.stage === 'RESOLVED' || Boolean(row.verifiedAt);
  if (isClosed || !row.slaDueAt) return 'ok';
  const t = new Date(row.slaDueAt).getTime();
  if (t < now) return 'breached';
  if (t < now + 48 * 3_600_000) return 'due_soon';
  return 'ok';
}

/**
 * KPI row matching Claude Escalation Center mock (five metric cards).
 */
export function AnalyticsStrip({ rows, now }: Props) {
  const metrics = useMemo(() => {
    let open = 0;
    let breached = 0;
    let dueSoon48h = 0;
    let verified = 0;

    let resolvedRecent = 0;
    const sevenMs = 7 * 24 * 3_600_000;
    const recentCutoff = now - sevenMs;

    for (const row of rows) {
      if (row.verifiedAt) verified += 1;
      // A row is "closed" once it's resolved, sitting at RESOLVED stage, or
      // verified — not just when the `resolved` boolean is set. Resolving in
      // stages alone previously left OPEN stuck because only `resolved` was
      // checked here.
      const isClosed =
        row.resolved || row.stage === 'RESOLVED' || Boolean(row.verifiedAt);
      if (isClosed) {
        // Resolution date: prefer verifiedAt, then the tracking entry's last
        // activity (set by the resolve transition), then lastContactAt as a
        // final fallback. `lastContactAt` alone misses managers resolved
        // without ever being contacted, which left this stuck at 0.
        const resolvedTsRaw = row.verifiedAt ?? row.lastActivityAt ?? row.lastContactAt;
        const ts = resolvedTsRaw ? new Date(resolvedTsRaw).getTime() : null;
        if (ts !== null && ts >= recentCutoff) resolvedRecent += 1;
      } else open += 1;

      const b = slaBucket(now, row);
      if (!isClosed) {
        if (b === 'breached') breached += 1;
        else if (b === 'due_soon') dueSoon48h += 1;
      }
    }

    return { open, breached, dueSoon48h, resolvedRecent, verified };
  }, [now, rows]);

  if (rows.length === 0) return null;

  return (
    <div className="mb-4 grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-5">
      <MetricTile label="Open" value={metrics.open} />
      <MetricTile label="Breached SLA" value={metrics.breached} valueTone={metrics.breached > 0 ? 'danger' : 'neutral'} />
      <MetricTile
        label="Due soon · 48h"
        value={metrics.dueSoon48h}
        valueTone={metrics.dueSoon48h > 0 ? 'warn' : 'neutral'}
      />
      <MetricTile
        label="Resolved · 7d"
        value={metrics.resolvedRecent}
        subtitle="By last activity date"
      />
      <MetricTile
        label="Verified"
        value={metrics.verified}
        valueTone={metrics.verified > 0 ? 'info' : 'neutral'}
        className="col-span-2 sm:col-span-1"
      />
    </div>
  );
}

function MetricTile({
  label,
  value,
  subtitle,
  caption,
  captionTone,
  valueTone = 'neutral',
  className = '',
}: {
  label: string;
  value: number;
  subtitle?: string;
  caption?: string;
  captionTone?: 'bad';
  valueTone?: 'neutral' | 'danger' | 'warn' | 'good' | 'info';
  className?: string;
}) {
  const valueCls =
    valueTone === 'danger'
      ? 'text-danger-700 dark:text-red-300'
      : valueTone === 'warn'
        ? 'text-warning-700 dark:text-amber-300'
        : valueTone === 'good'
          ? 'text-success-700 dark:text-emerald-300'
          : valueTone === 'info'
            ? 'text-brand dark:text-brand'
            : 'text-ink dark:text-white';

  const capCls = captionTone === 'bad' ? 'bg-brand/15 text-brand dark:bg-brand/20 dark:text-brand' : '';

  return (
    <div className={`rounded-xl border border-rule bg-white p-3 shadow-soft dark:border-gray-800 dark:bg-gray-900 ${className}`} aria-label={`${label} metric`}>
      <div className="text-[11px] font-semibold uppercase tracking-wide text-ink-3">{label}</div>
      <div className="mt-2 flex flex-wrap items-end gap-2">
        <span className={`text-2xl font-bold tabular-nums tracking-tight ${valueCls}`}>{value}</span>
        {caption ? (
          <span
            className={`mb-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${capCls || 'bg-gray-100 text-ink-2 dark:bg-gray-800 dark:text-gray-300'}`}
          >
            {caption}
          </span>
        ) : null}
      </div>
      {subtitle ? <div className="mt-2 text-[10px] leading-snug text-ink-3">{subtitle}</div> : null}
    </div>
  );
}

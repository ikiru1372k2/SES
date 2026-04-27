/**
 * AuditSummaryStrip — KPI header row (scanned rows, flagged rows, issues, sheets audited)
 * plus the Escalation Center CTA banner shown when there are flagged issues.
 */
import type { AuditResult, AuditProcess } from '../../../../../lib/types';
import { MetricCard } from '../../../../../components/shared/MetricCard';

export function AuditSummaryStrip({
  result,
  process,
}: {
  result: AuditResult;
  process: AuditProcess;
}) {
  return (
    <>
      <div className="grid gap-3 md:grid-cols-4">
        <MetricCard label="Scanned Rows" value={result.scannedRows} />
        <MetricCard label="Flagged Rows" value={result.flaggedRows} />
        <MetricCard label="Issues" value={result.issues.length} />
        <MetricCard label="Sheets Audited" value={result.sheets.length} />
      </div>

      {result.issues.length > 0 ? (
        <EscalationCenterCta
          processId={process.id}
          processDisplayCode={process.displayCode}
          managerCount={
            new Set(
              result.issues
                .map((issue) => (issue.projectManager ?? '').trim().toLowerCase())
                .filter(Boolean),
            ).size
          }
        />
      ) : null}
    </>
  );
}

function EscalationCenterCta({
  processId,
  processDisplayCode,
  managerCount,
}: {
  processId: string;
  processDisplayCode: string | undefined;
  managerCount: number;
}) {
  const href = `/processes/${encodeURIComponent(processDisplayCode ?? processId)}/escalations`;
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-brand/30 bg-brand/5 p-4 text-sm">
      <div>
        <div className="font-semibold text-gray-900 dark:text-white">
          {managerCount} manager{managerCount === 1 ? '' : 's'} to notify
        </div>
        <div className="mt-1 text-xs text-gray-600 dark:text-gray-300">
          The Escalation Center is where you compose one message per manager, broadcast to everyone,
          track SLA, and walk the escalation ladder.
        </div>
      </div>
      <a
        href={href}
        className="rounded-lg bg-brand px-3 py-2 text-xs font-semibold text-white hover:bg-brand-hover"
      >
        Open Escalation Center →
      </a>
    </div>
  );
}

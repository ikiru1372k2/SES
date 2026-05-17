import type { AuditProcess, AuditResult, WorkbookFile } from '../../lib/domain/types';
import { resolveWorkspaceMetrics } from '../../lib/workbook/auditResultFilter';
import { AiBadge } from '../ai-pilot/AiBadge';

function formatRelative(iso: string | null | undefined): string {
  if (!iso) return 'never';
  const delta = Date.now() - new Date(iso).getTime();
  if (delta < 60_000) return 'just now';
  if (delta < 3_600_000) return `${Math.floor(delta / 60_000)} min ago`;
  if (delta < 86_400_000) return `${Math.floor(delta / 3_600_000)} h ago`;
  return new Date(iso).toLocaleDateString();
}

function StatCell({ label, value }: { label: string; value: number }) {
  return (
    <div className="min-w-0 flex-1 px-4 py-3">
      <div className="eyebrow">{label}</div>
      <div className="mt-1 text-2xl font-bold tabular-nums tracking-tight text-ink dark:text-white">
        {value}
      </div>
    </div>
  );
}

export function WorkspaceStatusCards({
  activeFile,
  sessionResult,
  process,
  onSaveAsNew,
}: {
  activeFile: WorkbookFile | undefined;
  /** Per-session audit result (store `currentAuditResult`); may belong to
   *  another file/process, so metrics are resolved + scoped, never trusted raw. */
  sessionResult: AuditResult | null;
  process: AuditProcess;
  onSaveAsNew: () => void;
}) {
  const selectedSheets = activeFile?.sheets.filter((s) => s.status === 'valid' && s.isSelected).length ?? 0;
  const versions = process.versions;
  // Always resolved + scoped to the active file. Returns all-zeros when there
  // is no active file or no matching result — so a stale version/session
  // result from another file/process can never leak into this bar.
  const metrics = resolveWorkspaceMetrics(process, activeFile, sessionResult);
  const issueCount = metrics.issues;

  return (
    <div className="shrink-0 border-b border-rule-2 bg-surface-app px-4 py-3 sm:px-5 dark:border-gray-800 dark:bg-gray-950/50">
      <div className="flex flex-col divide-y divide-rule overflow-hidden rounded-xl border border-rule bg-white shadow-soft lg:flex-row lg:divide-x lg:divide-y-0 dark:border-gray-800 dark:bg-gray-900">
        {/* LEFT HALF — status: Active workbook | Versions | Status */}
        <div className="flex min-w-0 flex-1 flex-col divide-y divide-rule sm:flex-row sm:divide-x sm:divide-y-0 dark:divide-gray-800">
        {/* Active workbook */}
        <div className="min-w-0 flex-1 px-4 py-3">
          <div className="eyebrow">Active workbook</div>
          <div className="mt-1 truncate text-sm font-bold text-ink dark:text-white">
            {activeFile?.name ?? 'No file selected'}
          </div>
          {activeFile ? (
            <p className="mt-0.5 truncate text-[11.5px] text-ink-3">
              {selectedSheets} sheet{selectedSheets === 1 ? '' : 's'}
              {issueCount > 0 ? ` · ${issueCount} finding${issueCount === 1 ? '' : 's'}` : ''}
              {activeFile.lastAuditedAt ? ` · last run ${formatRelative(activeFile.lastAuditedAt)}` : ''}
            </p>
          ) : null}
        </div>

        {/* Versions */}
        <div className="min-w-0 flex-1 px-4 py-3">
          <div className="eyebrow">Versions</div>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            {versions.length === 0 ? (
              <span className="text-xs text-ink-3">No saved versions yet</span>
            ) : (
              versions.slice(0, 4).map((v, i) => (
                <span
                  key={v.id}
                  className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                    i === 0
                      ? 'bg-brand-subtle text-brand dark:bg-brand/20'
                      : 'bg-surface-app text-ink-2 ring-1 ring-inset ring-rule dark:bg-gray-800 dark:text-gray-300'
                  }`}
                >
                  {v.versionName}
                  {i === 0 ? ' (head)' : ''}
                </span>
              ))
            )}
            <button
              type="button"
              onClick={onSaveAsNew}
              className="ml-auto text-[11px] font-semibold text-brand hover:underline"
            >
              + New
            </button>
          </div>
        </div>
        </div>

        {/* RIGHT HALF — audit metrics: Scanned | Flagged | Issues | Sheets (+ AI).
            Always shown (zeros when no active file/result). */}
        <div className="flex min-w-0 flex-1 flex-col divide-y divide-rule sm:flex-row sm:divide-x sm:divide-y-0 dark:divide-gray-800">
          <StatCell label="Scanned Rows" value={metrics.scannedRows} />
          <StatCell label="Flagged Rows" value={metrics.flaggedRows} />
          <StatCell label="Issues" value={metrics.issues} />
          <StatCell label="Sheets Audited" value={metrics.sheetsAudited} />
          {metrics.aiIssues > 0 ? (
            <div className="min-w-0 flex-1 bg-rose-50 px-4 py-3 dark:bg-rose-950">
              <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-rose-700 dark:text-rose-200">
                <AiBadge />
                AI Issues
              </div>
              <div className="mt-1 text-2xl font-bold tabular-nums tracking-tight text-rose-900 dark:text-rose-100">
                {metrics.aiIssues}
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

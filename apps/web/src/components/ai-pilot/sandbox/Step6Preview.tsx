import { ChevronLeft } from 'lucide-react';
import type { PreviewResult, EscalationLitePreview } from '../../../lib/api/aiPilotApi';
import { EscalationLitePreview as EscalationLitePreviewComponent } from '../EscalationLitePreview';
import { FooterRow, SeverityChip } from './shared';

export interface Step6PreviewProps {
  result: PreviewResult;
  escalation: EscalationLitePreview | null;
  escalationError: string | null;
  onBack: () => void;
  onSave: () => void;
  saveDisabled: boolean;
  busy: boolean;
}

export function Step6Preview({
  result,
  escalation,
  escalationError,
  onBack,
  onSave,
  saveDisabled,
  busy,
}: Step6PreviewProps) {
  const sample = result.issues.slice(0, 50);
  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm dark:border-gray-700 dark:bg-gray-800">
        <p className="font-semibold text-gray-800 dark:text-gray-100">
          {result.flaggedRows} flagged · {result.scannedRows} scanned ·{' '}
          {result.scannedRows > 0
            ? Math.round((result.flaggedRows / result.scannedRows) * 100)
            : 0}
          % flag rate
        </p>
        {result.unknownColumns.length > 0 ? (
          <p className="mt-1 text-xs text-amber-700 dark:text-amber-300">
            ⚠ Columns not found on this sheet: {result.unknownColumns.join(', ')}. Rule may behave
            differently on real workbooks.
          </p>
        ) : null}
      </div>

      <EscalationLitePreviewComponent preview={escalation} errorMessage={escalationError} />

      <div className="max-h-64 overflow-auto rounded-lg border border-gray-200 dark:border-gray-700">
        <table className="min-w-full text-xs">
          <thead className="sticky top-0 bg-gray-100 text-left text-[10px] font-semibold uppercase tracking-wide text-gray-600 dark:bg-gray-800 dark:text-gray-300">
            <tr>
              <th className="px-2 py-1">Row</th>
              <th className="px-2 py-1">Project</th>
              <th className="px-2 py-1">Sheet</th>
              <th className="px-2 py-1">Severity</th>
              <th className="px-2 py-1">Reason</th>
            </tr>
          </thead>
          <tbody>
            {sample.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-2 py-3 text-center text-gray-500">
                  No rows flagged.
                </td>
              </tr>
            ) : (
              sample.map((issue) => (
                <tr key={issue.id} className="border-t border-gray-100 dark:border-gray-800">
                  <td className="px-2 py-1">{issue.rowIndex + 1}</td>
                  <td className="px-2 py-1">
                    <span className="font-medium">{issue.projectNo}</span>{' '}
                    <span className="text-gray-500">{issue.projectName}</span>
                  </td>
                  <td className="px-2 py-1">{issue.sheetName}</td>
                  <td className="px-2 py-1">
                    <SeverityChip s={issue.severity} />
                  </td>
                  <td className="px-2 py-1 text-gray-700 dark:text-gray-200">{issue.reason}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <FooterRow>
        <button
          type="button"
          onClick={onBack}
          className="rounded-lg border border-gray-300 px-3 py-2 text-sm hover:bg-gray-50 dark:border-gray-700"
        >
          <ChevronLeft size={14} className="mr-1 inline" />
          Edit rule
        </button>
        <button
          type="button"
          disabled={saveDisabled || busy}
          onClick={onSave}
          className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-hover disabled:opacity-60"
          title={saveDisabled ? 'Preview must succeed before saving' : undefined}
        >
          {busy ? 'Saving…' : 'Save to engine'}
        </button>
      </FooterRow>
    </div>
  );
}

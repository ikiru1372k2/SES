import type { EscalationLitePreview as EscalationLite } from '../../lib/api/aiPilotApi';
import { AlertCircle } from 'lucide-react';

export function EscalationLitePreview({
  preview,
  errorMessage,
}: {
  preview: EscalationLite | null;
  errorMessage?: string | null;
}) {
  if (errorMessage) {
    return (
      <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 text-xs text-gray-600 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300">
        <div className="flex items-center gap-1.5 text-gray-500">
          <AlertCircle size={12} />
          Couldn&apos;t compute escalation preview ({errorMessage}). Save still allowed.
        </div>
      </div>
    );
  }
  if (!preview) return null;
  if (preview.totalEscalations === 0) {
    return (
      <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 text-xs text-gray-700 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200">
        No escalations would be created — no rows flagged.
      </div>
    );
  }
  return (
    <div className="rounded-lg border border-brand/40 bg-brand-subtle p-3 text-xs dark:border-brand/40 dark:bg-gray-800">
      <p className="font-semibold text-brand">If saved on a real workbook with this profile:</p>
      <p className="mt-1 text-gray-700 dark:text-gray-200">
        {preview.totalEscalations} escalation{preview.totalEscalations === 1 ? '' : 's'} ·{' '}
        {preview.uniqueManagers} manager{preview.uniqueManagers === 1 ? '' : 's'}
        {preview.unassignedCount > 0
          ? ` · ${preview.unassignedCount} unassigned (no email match)`
          : ''}
      </p>
      {preview.perManagerCount.length > 0 ? (
        <ul className="mt-2 space-y-0.5 text-[11px] text-gray-600 dark:text-gray-300">
          {preview.perManagerCount.slice(0, 5).map((m) => (
            <li key={m.email}>
              <span className="font-medium">{m.displayName}</span> — {m.count}
            </li>
          ))}
          {preview.perManagerCount.length > 5 ? (
            <li className="text-gray-500">+ {preview.perManagerCount.length - 5} more</li>
          ) : null}
        </ul>
      ) : null}
    </div>
  );
}

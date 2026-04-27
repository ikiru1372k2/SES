import { ExternalLink } from 'lucide-react';
import type { AuditVersion } from '@ses/domain';

export function VersionCard({
  label,
  version,
  options,
  onChange,
  onOpenWorkspace,
}: {
  label: string;
  version: AuditVersion | undefined;
  options: AuditVersion[];
  onChange: (id: string) => void;
  onOpenWorkspace: () => void;
}) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-900">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">{label}</span>
        <button
          type="button"
          onClick={onOpenWorkspace}
          disabled={!version}
          className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs text-brand hover:bg-brand/5 disabled:opacity-40"
          title="Load this version in the workspace"
        >
          Open <ExternalLink size={11} />
        </button>
      </div>
      <select
        value={version?.versionId ?? version?.id ?? ''}
        onChange={(event) => onChange(event.target.value)}
        className="mt-2 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium dark:border-gray-700 dark:bg-gray-800"
      >
        {options.map((option) => (
          <option key={option.id} value={option.versionId ?? option.id}>
            {option.versionName}
          </option>
        ))}
      </select>
      {version ? (
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-gray-500">
          <span>{new Date(version.createdAt).toLocaleString()}</span>
          <span>·</span>
          <span>{version.result.issues.length} issues</span>
          {version.notes ? (
            <span className="line-clamp-1 text-gray-400" title={version.notes}>
              — {version.notes}
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

import { useEffect, useState } from 'react';
import type { WorkbookFile } from '../../lib/types';
import type { MappingSourceInput, ApiAuditRunListItem } from '../../lib/api/auditsApi';
import { fetchAuditRunsForProcess } from '../../lib/api/auditsApi';

interface Props {
  processId: string;
  processDisplayCode: string;
  auditFileId: string;
  overPlanningFiles: WorkbookFile[];
  value: MappingSourceInput | undefined;
  onChange: (src: MappingSourceInput | undefined) => void;
}

export function MappingSourcePanel({ processId, processDisplayCode, auditFileId, overPlanningFiles, value, onChange }: Props) {
  const type = value?.type ?? 'none';
  const [mdRuns, setMdRuns] = useState<ApiAuditRunListItem[]>([]);
  const [mdRunsLoading, setMdRunsLoading] = useState(false);

  useEffect(() => {
    if (type !== 'master_data_version') return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- loading flag before async fetch
    setMdRunsLoading(true);
    fetchAuditRunsForProcess(processDisplayCode, 'master-data')
      .then(setMdRuns)
      .catch(() => setMdRuns([]))
      .finally(() => setMdRunsLoading(false));
  }, [type, processDisplayCode]);
  function setType(newType: 'none' | 'master_data_version' | 'uploaded_file') {
    if (newType === 'none') {
      onChange(undefined);
    } else {
      onChange({ type: newType, allowUnresolvedFallback: value?.allowUnresolvedFallback ?? true });
    }
  }

  function setMasterDataVersionId(id: string) {
    onChange({ type: 'master_data_version', masterDataVersionId: id, allowUnresolvedFallback: value?.allowUnresolvedFallback ?? true });
  }

  function setUploadId(id: string) {
    onChange({ type: 'uploaded_file', uploadId: id, allowUnresolvedFallback: value?.allowUnresolvedFallback ?? true });
  }

  function setAllowUnresolved(checked: boolean) {
    if (!value || value.type === 'none') return;
    onChange({ ...value, allowUnresolvedFallback: checked });
  }

  const mappingFiles = overPlanningFiles.filter((f) => f.id !== auditFileId);

  return (
    <div className="rounded-xl border border-gray-200 p-4 dark:border-gray-700">
      <h4 className="font-semibold text-sm text-gray-700 dark:text-gray-200">Manager Mapping Source</h4>
      <p className="mt-1 text-xs text-gray-500">How to match project managers to escalation email addresses for this run.</p>

      <div className="mt-3 space-y-2">
        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <input type="radio" name={`mapping-${processId}`} checked={type === 'none'} onChange={() => setType('none')} />
          None <span className="text-xs text-gray-400">(fall through to Manager Directory)</span>
        </label>

        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <input type="radio" name={`mapping-${processId}`} checked={type === 'master_data_version'} onChange={() => setType('master_data_version')} />
          Master Data version
        </label>
        {type === 'master_data_version' && (
          <div className="ml-6">
            <select
              value={value?.masterDataVersionId ?? ''}
              onChange={(e) => setMasterDataVersionId(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-800"
            >
              <option value="">{mdRunsLoading ? 'Loading…' : 'Select a Master Data run…'}</option>
              {mdRuns.map((run) => (
                <option key={run.id} value={run.id}>
                  Run {run.displayCode} — {run.completedAt ? new Date(run.completedAt).toLocaleDateString() : '?'} — {run.flaggedRows} issues
                </option>
              ))}
            </select>
          </div>
        )}

        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <input type="radio" name={`mapping-${processId}`} checked={type === 'uploaded_file'} onChange={() => setType('uploaded_file')} />
          Uploaded mapping file
        </label>
        {type === 'uploaded_file' && (
          <div className="ml-6">
            <select
              value={value?.uploadId ?? ''}
              onChange={(e) => setUploadId(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-800"
            >
              <option value="">Select a mapping file…</option>
              {mappingFiles.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name} — uploaded {f.uploadedAt ? new Date(f.uploadedAt).toLocaleDateString() : '?'}
                </option>
              ))}
            </select>
            {mappingFiles.length === 0 && (
              <p className="mt-1 text-xs text-gray-400">No other over-planning files in this process.</p>
            )}
          </div>
        )}
      </div>

      {type !== 'none' && (
        <label className="mt-3 flex items-center gap-2 text-sm cursor-pointer">
          <input
            type="checkbox"
            checked={value?.allowUnresolvedFallback ?? true}
            onChange={(e) => setAllowUnresolved(e.target.checked)}
          />
          Allow unresolved fallback
          <span className="text-xs text-gray-400">(issues without email are still created)</span>
        </label>
      )}
    </div>
  );
}

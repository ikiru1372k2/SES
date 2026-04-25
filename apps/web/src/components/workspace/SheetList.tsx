import { Lock } from 'lucide-react';
import { useState } from 'react';
import type { AuditProcess, WorkbookFile } from '../../lib/types';
import { useAppStore } from '../../store/useAppStore';
import { Badge } from '../shared/Badge';
import { StatusBadge } from '../shared/StatusBadge';

export function SheetList({
  process,
  file,
  canEdit = true,
  readOnlyReason,
}: {
  process: AuditProcess;
  file: WorkbookFile;
  canEdit?: boolean;
  readOnlyReason?: string | undefined;
}) {
  const [scope, setScope] = useState<'all' | 'selected'>('all');
  const toggleSheet = useAppStore((state) => state.toggleSheet);
  const selectAllValidSheets = useAppStore((state) => state.selectAllValidSheets);
  const clearSheetSelection = useAppStore((state) => state.clearSheetSelection);
  const valid = file.sheets.filter((sheet) => sheet.status === 'valid');
  const skipped = file.sheets.length - valid.length;
  const selected = valid.filter((sheet) => sheet.isSelected).length;

  function changeScope(value: 'all' | 'selected') {
    if (!canEdit) return;
    setScope(value);
    if (value === 'all') selectAllValidSheets(process.id, file.id);
  }

  return (
    <section className="border-t border-gray-200 p-4 dark:border-gray-800">
      <div className="mb-3">
        <h3 className="text-sm font-semibold">Sheets ({file.name})</h3>
        <p className="text-xs text-gray-500">{file.isAudited ? `${selected} audited, ${skipped} skipped` : `${selected} selected, ${skipped} skipped`}</p>
      </div>
      <label className="text-xs font-medium text-gray-500">Scope</label>
      <select value={scope} disabled={!canEdit} title={!canEdit ? readOnlyReason : undefined} onChange={(event) => changeScope(event.target.value as 'all' | 'selected')} className="mt-1 w-full rounded-lg border border-gray-300 px-2 py-2 text-sm disabled:cursor-not-allowed disabled:bg-gray-50 disabled:text-gray-400 dark:border-gray-700 dark:bg-gray-800">
        <option value="all">Audit all valid sheets</option>
        <option value="selected">Audit selected sheets</option>
      </select>
      <div className="mt-4 space-y-2">
        {file.sheets.map((sheet) => {
          const disabled = sheet.status !== 'valid';
          return (
            <div key={sheet.name} className={`rounded-lg border border-gray-200 bg-white p-3 dark:border-gray-700 dark:bg-gray-800 ${disabled ? 'opacity-50' : ''}`}>
              <div className="flex items-start gap-2">
                {scope === 'selected' ? <input type="checkbox" title={!canEdit ? readOnlyReason : undefined} disabled={disabled || !canEdit} checked={sheet.isSelected} onChange={() => toggleSheet(process.id, file.id, sheet.name)} className="mt-1" /> : null}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium">{sheet.name}</span>
                    {disabled ? <Lock size={12} /> : scope === 'all' ? <Badge tone="green">Auto</Badge> : null}
                  </div>
                  <div className="mt-1 flex items-center gap-2 text-xs text-gray-500">
                    <span>{sheet.rowCount} rows</span>
                    <StatusBadge value={sheet.status === 'valid' ? 'Valid' : sheet.status === 'duplicate' ? 'Duplicate' : 'Invalid'} />
                  </div>
                  {disabled && sheet.skipReason ? <p className="mt-1 text-xs text-gray-500">{sheet.skipReason}</p> : null}
                </div>
              </div>
            </div>
          );
        })}
      </div>
      {scope === 'selected' ? (
        <div className="mt-3 flex gap-2">
          <button type="button" title={!canEdit ? readOnlyReason : undefined} disabled={!canEdit} onClick={() => selectAllValidSheets(process.id, file.id)} className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-700">Select Valid</button>
          <button type="button" title={!canEdit ? readOnlyReason : undefined} disabled={!canEdit} onClick={() => clearSheetSelection(process.id, file.id)} className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-700">Clear All</button>
        </div>
      ) : null}
    </section>
  );
}

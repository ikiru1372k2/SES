import { Check, Lock, Sheet } from 'lucide-react';
import { useState } from 'react';
import type { AuditProcess, WorkbookFile } from '../../lib/domain/types';
import { useAppStore } from '../../store/useAppStore';

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
  // Default 'all' to match master: a freshly opened file shows every valid
  // sheet, not an empty "selected only" view (which made audits look like
  // they ran on zero sheets).
  const [scope, setScope] = useState<'all' | 'selected'>('all');
  const toggleSheet = useAppStore((state) => state.toggleSheet);
  const selectAllValidSheets = useAppStore((state) => state.selectAllValidSheets);
  const clearSheetSelection = useAppStore((state) => state.clearSheetSelection);
  const valid = file.sheets.filter((sheet) => sheet.status === 'valid');
  const selected = valid.filter((sheet) => sheet.isSelected).length;
  const total = file.sheets.length;

  function changeScope(value: 'all' | 'selected') {
    if (!canEdit) return;
    setScope(value);
    if (value === 'all') selectAllValidSheets(process.id, file.id);
  }

  function onSheetRowClick(sheetName: string, disabled: boolean) {
    if (disabled || !canEdit) return;
    if (scope === 'all') {
      setScope('selected');
      clearSheetSelection(process.id, file.id);
      selectAllValidSheets(process.id, file.id);
      toggleSheet(process.id, file.id, sheetName);
      return;
    }
    toggleSheet(process.id, file.id, sheetName);
  }

  return (
    <section className="px-3 pb-3 pt-1">
      <div className="mb-2.5 flex items-center justify-between gap-2">
        <span className="text-[11px] font-medium tabular-nums text-ink-3">
          {selected} of {total} selected
        </span>
        <label className="sr-only" htmlFor="sheet-scope">
          Sheet audit scope
        </label>
        <select
          id="sheet-scope"
          value={scope}
          disabled={!canEdit}
          title={!canEdit ? readOnlyReason : 'Choose whether to audit all valid sheets or only selected ones'}
          onChange={(event) => changeScope(event.target.value as 'all' | 'selected')}
          className="max-w-[7.5rem] rounded border-0 bg-transparent py-0 pr-4 text-[10px] font-medium text-brand focus:ring-0"
        >
          <option value="all">All valid</option>
          <option value="selected">Selected only</option>
        </select>
      </div>

      <div className="space-y-0.5">
        {file.sheets.map((sheet) => {
          const disabled = sheet.status !== 'valid';
          const checked = scope === 'all' ? !disabled : sheet.isSelected;

          return (
            <button
              key={sheet.name}
              type="button"
              disabled={disabled || !canEdit}
              title={disabled ? sheet.skipReason ?? 'Invalid sheet' : !canEdit ? readOnlyReason : undefined}
              onClick={() => onSheetRowClick(sheet.name, disabled)}
              className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12px] transition-colors ${
                disabled
                  ? 'cursor-not-allowed opacity-45'
                  : checked
                    ? 'cursor-pointer bg-brand-subtle/50 hover:bg-brand-subtle dark:bg-brand/10'
                    : 'cursor-pointer hover:bg-surface-app dark:hover:bg-gray-900/50'
              }`}
            >
              <span
                className={`flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-[3px] border-[1.5px] ${
                  checked
                    ? 'border-brand bg-brand text-white'
                    : 'border-rule-2 bg-white dark:border-gray-600 dark:bg-gray-900'
                }`}
                aria-hidden
              >
                {checked ? <Check size={9} strokeWidth={3} /> : null}
              </span>
              <Sheet size={12} className="shrink-0 text-ink-3" aria-hidden />
              <span className={`min-w-0 flex-1 truncate ${checked ? 'text-ink-2' : 'text-ink-3'} dark:text-gray-300`}>
                {sheet.name}
              </span>
              {disabled ? <Lock size={11} className="shrink-0 text-ink-3" aria-hidden /> : null}
            </button>
          );
        })}
      </div>

      {scope === 'selected' ? (
        <div className="mt-2 flex gap-3">
          <button
            type="button"
            title={!canEdit ? readOnlyReason : undefined}
            disabled={!canEdit}
            onClick={() => selectAllValidSheets(process.id, file.id)}
            className="text-[11px] font-medium text-brand hover:underline disabled:opacity-50"
          >
            Select all valid
          </button>
          <button
            type="button"
            title={!canEdit ? readOnlyReason : undefined}
            disabled={!canEdit}
            onClick={() => clearSheetSelection(process.id, file.id)}
            className="text-[11px] font-medium text-ink-3 hover:text-ink disabled:opacity-50"
          >
            Clear
          </button>
        </div>
      ) : null}
    </section>
  );
}

/**
 * AuditFilterBar — sheet summary table + filter controls (sheet, severity,
 * category/column, rule, search) and export actions.
 */
import { useRef } from 'react';
import { openAuditReport } from '../../../../../lib/reportExporter';
import { exportIssuesCsv } from '../../../../../lib/auditEngine';
import type { AuditIssue, AuditResult, AuditProcess, WorkbookFile } from '../../../../../lib/types';
import { StatusBadge } from '../../../../../components/shared/StatusBadge';

export type SortKey = keyof Pick<
  AuditIssue,
  'severity' | 'projectNo' | 'projectName' | 'projectManager' | 'email' | 'sheetName' | 'projectState' | 'effort' | 'reason'
>;

export interface AuditFilterBarProps {
  result: AuditResult;
  file?: WorkbookFile | undefined;
  process: AuditProcess;
  filtered: AuditIssue[];
  isMasterData: boolean;
  /** Values for the filter selects */
  sheet: string;
  severity: string;
  category: string;
  status: string;
  search: string;
  categoryFilterOptions: Array<{ value: string; label: string }>;
  ruleFilterOptions: Array<{ value: string; label: string }>;
  sheets: string[];
  /** Change handlers */
  onSheetChange: (v: string) => void;
  onSeverityChange: (v: string) => void;
  onCategoryChange: (v: string) => void;
  onStatusChange: (v: string) => void;
  onSearchChange: (v: string) => void;
  /** Forwarded ref for keyboard shortcut to focus search */
  searchRef: React.RefObject<HTMLInputElement>;
}

export function AuditFilterBar({
  result,
  file,
  process,
  filtered,
  isMasterData,
  sheet,
  severity,
  category,
  status,
  search,
  categoryFilterOptions,
  ruleFilterOptions,
  sheets,
  onSheetChange,
  onSeverityChange,
  onCategoryChange,
  onStatusChange,
  onSearchChange,
  searchRef,
}: AuditFilterBarProps) {
  return (
    <>
      {/* Sheet breakdown table */}
      <div className="overflow-hidden rounded-xl border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800">
        <table className="min-w-full text-left text-sm">
          <thead className="bg-gray-50 dark:bg-gray-700">
            <tr>
              <th scope="col" className="p-3">Sheet</th>
              <th scope="col">Status</th>
              <th scope="col">Rows</th>
              <th scope="col">Flagged</th>
            </tr>
          </thead>
          <tbody>
            {file?.sheets.map((item) => {
              const audited = result.sheets.find((s) => s.sheetName === item.name);
              return (
                <tr
                  key={item.name}
                  className="border-t border-gray-100 even:bg-gray-50/60 dark:border-gray-700 dark:even:bg-gray-900/40"
                >
                  <td className="p-3">{item.name}</td>
                  <td>
                    <StatusBadge
                      value={
                        item.status === 'valid'
                          ? 'Valid'
                          : item.status === 'duplicate'
                            ? 'Duplicate'
                            : 'Invalid'
                      }
                    />
                  </td>
                  <td>{item.rowCount}</td>
                  <td>{audited?.flaggedCount ?? '-'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Filter controls + export */}
      <div className="space-y-3 rounded-xl border border-gray-200 bg-white p-3 dark:border-gray-700 dark:bg-gray-800">
        <div className="flex flex-wrap gap-2">
          <select
            value={sheet}
            onChange={(e) => onSheetChange(e.target.value)}
            className="rounded-lg border border-gray-300 px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900"
          >
            <option value="">Sheet</option>
            {sheets.map((s) => <option key={s}>{s}</option>)}
          </select>
          <select
            value={severity}
            onChange={(e) => onSeverityChange(e.target.value)}
            className="rounded-lg border border-gray-300 px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900"
          >
            <option value="">Severity</option>
            <option>High</option>
            <option>Medium</option>
            <option>Low</option>
          </select>
          <select
            value={category}
            onChange={(e) => onCategoryChange(e.target.value)}
            className="rounded-lg border border-gray-300 px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900"
          >
            <option value="">{isMasterData ? 'All columns' : 'All categories'}</option>
            {categoryFilterOptions.map(({ value, label }) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
          <select
            value={status}
            onChange={(e) => onStatusChange(e.target.value)}
            className="rounded-lg border border-gray-300 px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900"
          >
            <option value="">{isMasterData ? 'All rules' : 'Rule status'}</option>
            {ruleFilterOptions.map(({ value, label }) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
          <input
            ref={searchRef}
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search..."
            className="min-w-52 flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900"
          />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-gray-100 pt-3 text-sm dark:border-gray-700">
          <span className="text-gray-500">
            {filtered.length} of {result.issues.length} issues shown
          </span>
          <div className="flex gap-2">
            <button
              onClick={() => openAuditReport(process, result)}
              className="rounded-lg border border-gray-300 px-3 py-2 text-sm hover:bg-gray-50 dark:border-gray-700"
            >
              PDF Report
            </button>
            <button
              onClick={() => exportIssuesCsv('audit-issues.csv', filtered)}
              className="rounded-lg border border-gray-300 px-3 py-2 text-sm hover:bg-gray-50 dark:border-gray-700"
            >
              Export CSV
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

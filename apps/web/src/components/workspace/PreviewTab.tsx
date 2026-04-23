import { useMemo, useState } from 'react';
import type { AuditProcess, AuditResult, WorkbookFile } from '../../lib/types';
import { EmptyState } from '../shared/EmptyState';
import { StatusBadge } from '../shared/StatusBadge';

export function PreviewTab({ process, file, result }: { process: AuditProcess; file?: WorkbookFile | undefined; result: AuditResult | null }) {
  const [sheetName, setSheetName] = useState(file?.sheets[0]?.name ?? '');
  const activeSheet = useMemo(() => file?.sheets.find((sheet) => sheet.name === sheetName) ?? file?.sheets[0], [file, sheetName]);
  const rows = activeSheet ? (file?.rawData[activeSheet.name] ?? []) : [];
  const headerRowIndex = activeSheet?.headerRowIndex ?? 0;
  const headers = activeSheet?.originalHeaders?.length ? activeSheet.originalHeaders : rows[headerRowIndex] ?? [];
  const validSheetCount = file?.sheets.filter((sheet) => sheet.status === 'valid').length ?? 0;
  const skippedSheetCount = file ? file.sheets.length - validSheetCount : 0;
  const selectedSheetCount = file?.sheets.filter((sheet) => sheet.status === 'valid' && sheet.isSelected).length ?? 0;
  const sampleRows = rows
    .slice(headerRowIndex + 1)
    .map((row, index) => ({ row, rowIndex: headerRowIndex + 1 + index }))
    .filter(({ row }) => row.some((cell) => String(cell ?? '').trim() !== ''))
    .slice(0, 100);
  const issuesByRow = new Map(result?.issues.filter((issue) => issue.sheetName === activeSheet?.name).map((issue) => [issue.rowIndex, issue]) ?? []);
  const blankRows = rows.slice(headerRowIndex + 1, headerRowIndex + 101).filter((row) => row.every((cell) => String(cell ?? '').trim() === '')).length;

  if (!file) {
    return (
      <EmptyState title="Upload a workbook to preview your data">
        <div className="space-y-1 text-sm">
          <p>SES will detect auditable sheets, skip duplicate/reference tabs, and show row counts before you run the audit.</p>
          <p>Use `.xlsx` or `.xlsm` files up to 10 MB.</p>
        </div>
      </EmptyState>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Workbook Preview - {file.name}</h2>
        <p className="text-sm text-gray-500">{process.files.length} workbook{process.files.length === 1 ? '' : 's'} in this process</p>
      </div>
      <div className="flex flex-wrap gap-2">
        {file.sheets.map((sheet) => (
          <button key={sheet.name} onClick={() => setSheetName(sheet.name)} className={`rounded-lg border px-3 py-2 text-sm ${activeSheet?.name === sheet.name ? 'border-brand bg-brand-subtle text-brand dark:bg-red-950/30' : 'border-gray-300 bg-white hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800'}`}>
            {sheet.name} {sheet.status !== 'valid' ? <span className="ml-1 text-xs text-gray-500">({sheet.status})</span> : null}
          </button>
        ))}
      </div>
      {activeSheet ? (
        <div className="flex flex-wrap items-center gap-2 text-sm text-gray-600 dark:text-gray-300">
          <StatusBadge value={activeSheet.status === 'valid' ? 'Ready to audit' : activeSheet.status === 'duplicate' ? 'Skipped duplicate' : 'Needs review'} />
          <span>{activeSheet.rowCount} auditable rows</span>
          <span className="text-gray-300">·</span>
          <span>{selectedSheetCount} of {validSheetCount} valid sheets selected</span>
          {skippedSheetCount ? (
            <>
              <span className="text-gray-300">·</span>
              <span>{skippedSheetCount} sheet{skippedSheetCount === 1 ? '' : 's'} skipped</span>
            </>
          ) : null}
          {blankRows ? (
            <>
              <span className="text-gray-300">·</span>
              <span>{blankRows} blank row{blankRows === 1 ? '' : 's'} ignored in preview</span>
            </>
          ) : null}
        </div>
      ) : null}
      <div className="overflow-auto rounded-xl border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800">
        <table className="min-w-full border-collapse text-left text-sm">
          <thead className="sticky top-0 bg-gray-100 dark:bg-gray-700">
            <tr>{headers.map((header, index) => <th key={index} scope="col" className="whitespace-nowrap border-b border-gray-200 px-3 py-2 font-semibold dark:border-gray-600">{String(header)}</th>)}</tr>
          </thead>
          <tbody>
            {sampleRows.map(({ row, rowIndex }) => {
              const issue = issuesByRow.get(rowIndex);
              const border = issue?.severity === 'High' ? 'border-l-4 border-red-500' : issue?.severity === 'Medium' ? 'border-l-4 border-amber-500' : issue?.severity === 'Low' ? 'border-l-4 border-blue-500' : '';
              return (
                <tr key={rowIndex} className={border}>
                  {headers.map((_header, cellIndex) => <td key={cellIndex} className="whitespace-nowrap border-b border-gray-100 px-3 py-2 dark:border-gray-700">{String(row[cellIndex] ?? '')}</td>)}
                </tr>
              );
            })}
          </tbody>
        </table>
        {!sampleRows.length ? <div className="p-5 text-sm text-gray-500">No preview rows in this sheet.</div> : null}
      </div>
      <p className="text-xs text-gray-500">Showing first 100 rows after detected header</p>
    </div>
  );
}

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { AuditProcess, AuditResult, WorkbookFile } from '../../lib/domain/types';
import { fetchSheetPreviewFromApi } from '../../lib/api/filesApi';
import { EmptyState } from '../shared/EmptyState';
import { StatusBadge } from '../shared/StatusBadge';

export function PreviewTab({ process, file, result }: { process: AuditProcess; file?: WorkbookFile | undefined; result: AuditResult | null }) {
  const [sheetName, setSheetName] = useState(file?.sheets[0]?.name ?? '');
  const activeSheet = useMemo(() => file?.sheets.find((sheet) => sheet.name === sheetName) ?? file?.sheets[0], [file, sheetName]);
  const hasLocalRows = Boolean(activeSheet && file && (file.rawData[activeSheet.name]?.length ?? 0) > 0);
  const previewQ = useQuery({
    queryKey: ['sheet-preview', file?.id, activeSheet?.id, result?.id],
    // Fetch whenever there's a file + sheet but no usable local rows. The
    // `serverBacked` flag was too strict: seeded/imported files have empty
    // local rawData and empty DB sheet.rows, so the preview must hit the
    // API (which now reconstructs rows from MinIO) regardless of that flag.
    enabled: Boolean(file && activeSheet && !hasLocalRows),
    queryFn: () => fetchSheetPreviewFromApi(
      (file as WorkbookFile & { displayCode?: string }).displayCode ?? file!.id,
      (activeSheet as { displayCode?: string }).displayCode ?? activeSheet!.name,
      {
        page: 1,
        pageSize: 100,
        ...(result?.id ? { runIdOrCode: result.id } : {}),
      },
    ),
    // Always re-fetch when the Preview tab (re)mounts so closing and
    // reopening reliably pulls fresh data from MinIO instead of serving a
    // possibly-empty cached result.
    staleTime: 0,
    refetchOnMount: 'always',
    retry: 1,
  });
  const rows = activeSheet
    ? (hasLocalRows
      ? (file?.rawData[activeSheet.name] ?? [])
      : [
          previewQ.data?.headers ?? [],
          ...(previewQ.data?.rows.map((row) => row.values) ?? []),
        ])
    : [];
  const headerRowIndex = activeSheet?.headerRowIndex ?? 0;
  const headers = activeSheet?.originalHeaders?.length
    ? activeSheet.originalHeaders
    : previewQ.data?.headers?.length
      ? previewQ.data.headers
      : rows[headerRowIndex] ?? [];
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
        <h2 className="text-lg font-semibold tracking-tight text-gray-950 dark:text-white">Workbook Preview · {file.name}</h2>
        <p className="text-sm text-gray-500">{process.files.length} workbook{process.files.length === 1 ? '' : 's'} in this process</p>
      </div>
      <div className="flex flex-wrap gap-2">
        {file.sheets.map((sheet) => (
          <button
            key={sheet.name}
            onClick={() => setSheetName(sheet.name)}
            className={`rounded-lg border px-3 py-1.5 text-sm font-medium transition-all ease-soft active:scale-[0.98] ${
              activeSheet?.name === sheet.name
                ? 'border-brand bg-brand-subtle text-brand shadow-soft dark:bg-brand/10'
                : 'border-gray-300 bg-white shadow-soft hover:border-brand/50 hover:shadow-soft-md dark:border-gray-700 dark:bg-gray-900'
            }`}
          >
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
      {/* Bounded height makes THIS div the scroll container, so the sticky
          thead actually pins while the rows scroll under it. */}
      <div className="max-h-[max(420px,calc(100vh-300px))] min-h-[16rem] overflow-auto rounded-xl border border-gray-200 bg-white shadow-soft dark:border-gray-800 dark:bg-gray-900">
        {previewQ.isLoading ? <div className="border-b border-gray-200 px-4 py-3 text-sm text-gray-500 dark:border-gray-800">Loading preview…</div> : null}
        {previewQ.isError ? <div className="border-b border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100">Preview could not be loaded for this shared file.</div> : null}
        <table className="min-w-full border-collapse text-left text-sm">
          <thead className="table-head">
            <tr>{headers.map((header, index) => <th key={index} scope="col" className="whitespace-nowrap border-b border-gray-200 px-3 py-2.5 dark:border-gray-800">{String(header)}</th>)}</tr>
          </thead>
          <tbody>
            {sampleRows.map(({ row, rowIndex }) => {
              const issue = issuesByRow.get(rowIndex);
              const border = issue?.severity === 'High' ? 'border-l-4 border-red-500' : issue?.severity === 'Medium' ? 'border-l-4 border-amber-500' : issue?.severity === 'Low' ? 'border-l-4 border-blue-500' : '';
              return (
                <tr key={rowIndex} className={`border-t border-gray-100 transition-colors even:bg-gray-50/60 hover:bg-gray-50 dark:border-gray-800 dark:even:bg-gray-900/40 dark:hover:bg-gray-900/60 ${border}`}>
                  {headers.map((_header, cellIndex) => <td key={cellIndex} className="whitespace-nowrap px-3 py-2 text-ink-2 dark:text-gray-300">{String(row[cellIndex] ?? '')}</td>)}
                </tr>
              );
            })}
          </tbody>
        </table>
        {!sampleRows.length ? <div className="p-8 text-center text-sm text-gray-500">No preview rows in this sheet.</div> : null}
      </div>
      <p className="text-xs text-gray-500">Showing first 100 rows after detected header</p>
    </div>
  );
}

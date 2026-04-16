import { Trash2, Upload } from 'lucide-react';
import type { KeyboardEvent } from 'react';
import toast from 'react-hot-toast';
import { validateWorkbookFile } from '../../lib/excelParser';
import type { AuditProcess, WorkbookFile } from '../../lib/types';
import { useAppStore } from '../../store/useAppStore';
import { ProgressBar } from '../shared/ProgressBar';
import { SheetList } from './SheetList';

export function FilesSidebar({ process }: { process: AuditProcess }) {
  const uploadFile = useAppStore((state) => state.uploadFile);
  const setActiveFile = useAppStore((state) => state.setActiveFile);
  const deleteFile = useAppStore((state) => state.deleteFile);
  const uploads = useAppStore((state) => state.uploads);
  const activeFile = process.files.find((file) => file.id === process.activeFileId) ?? process.files[0];

  async function upload(files: FileList | null) {
    if (!files?.length) return;
    for (const file of Array.from(files)) {
      try {
        validateWorkbookFile(file);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : `${file.name} is not a supported workbook`);
        continue;
      }
      void uploadFile(process.id, file).then(() => toast.success(`${file.name} uploaded`)).catch(() => toast.error(`${file.name} failed`));
    }
  }

  function confirmDelete(file: WorkbookFile) {
    const ok = window.confirm(`Delete "${file.name}"? This removes the document and its audit data from this browser.`);
    if (!ok) return;
    deleteFile(process.id, file.id);
    toast.success(`${file.name} deleted`);
  }

  return (
    <div className="flex min-h-full flex-col">
      <section className="p-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">Documents</h2>
          <label className="inline-flex cursor-pointer items-center gap-1 rounded-lg bg-brand px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-hover">
            <Upload size={14} />
            Upload
            <input type="file" multiple accept=".xlsx,.xlsm" onChange={(event) => { void upload(event.target.files); }} className="hidden" />
          </label>
        </div>
        <label onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); void upload(event.dataTransfer.files); }} className="mt-3 flex cursor-pointer flex-col items-center rounded-lg border border-dashed border-gray-300 bg-white p-4 text-center text-xs text-gray-500 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:hover:bg-gray-700">
          Drag documents here or pick multiple files
          <input type="file" multiple accept=".xlsx,.xlsm" onChange={(event) => { void upload(event.target.files); }} className="hidden" />
        </label>
        <div className="mt-4 space-y-2">
          {Object.entries(uploads).map(([key, item]) => (
            <div key={key} className="rounded-lg border border-gray-200 bg-white p-3 dark:border-gray-700 dark:bg-gray-800">
              <div className="text-sm font-medium">{item.fileName}</div>
              <div className="mt-1 text-xs text-gray-500">{item.status === 'failed' ? item.error : item.status}</div>
              <div className="mt-2"><ProgressBar value={item.progress} /></div>
            </div>
          ))}
          {process.files.map((file) => (
            <DocumentCard
              key={file.id}
              file={file}
              isActive={file.id === process.activeFileId}
              onSelect={() => setActiveFile(process.id, file.id)}
              onDelete={() => confirmDelete(file)}
            />
          ))}
        </div>
      </section>
      {activeFile ? <SheetList process={process} file={activeFile} /> : null}
    </div>
  );
}

function DocumentCard({
  file,
  isActive,
  onSelect,
  onDelete,
}: {
  file: WorkbookFile;
  isActive: boolean;
  onSelect: () => void;
  onDelete: () => void;
}) {
  const valid = file.sheets.filter((sheet) => sheet.status === 'valid').length;
  const skipped = file.sheets.length - valid;

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onSelect();
    }
  }

  return (
    <div
      role="button"
      tabIndex={0}
      aria-pressed={isActive}
      onClick={onSelect}
      onKeyDown={onKeyDown}
      className={`group relative w-full cursor-pointer rounded-lg border p-3 text-left text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand ${
        isActive
          ? 'border-blue-400 bg-blue-50 dark:bg-blue-950'
          : 'border-gray-200 bg-white hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:hover:bg-gray-700'
      }`}
    >
      <div className="flex gap-2 pr-7">
        <span className={isActive ? 'text-green-500' : 'text-gray-300'}>{isActive ? '●' : '○'}</span>
        <div className="min-w-0 flex-1">
          <div className="truncate font-medium">{file.name}</div>
          <div className="mt-1 text-xs text-gray-500">
            {valid} valid · {skipped} skipped · {file.isAudited ? 'Audited' : 'Not audited'}
          </div>
          {file.lastAuditedAt ? (
            <div className="mt-1 text-xs text-gray-500">Last audited: {new Date(file.lastAuditedAt).toLocaleString()}</div>
          ) : null}
        </div>
      </div>
      <button
        type="button"
        aria-label={`Delete ${file.name}`}
        title="Delete document"
        onClick={(event) => {
          event.stopPropagation();
          onDelete();
        }}
        className="absolute right-2 top-2 rounded-md p-1 text-gray-400 opacity-0 transition hover:bg-red-50 hover:text-red-600 focus-visible:opacity-100 group-hover:opacity-100 dark:hover:bg-red-950/30"
      >
        <Trash2 size={14} />
      </button>
    </div>
  );
}

import { Upload } from 'lucide-react';
import toast from 'react-hot-toast';
import { validateWorkbookFile } from '../../lib/excelParser';
import type { AuditProcess } from '../../lib/types';
import { useAppStore } from '../../store/useAppStore';
import { ProgressBar } from '../shared/ProgressBar';
import { SheetList } from './SheetList';

export function FilesSidebar({ process }: { process: AuditProcess }) {
  const uploadFile = useAppStore((state) => state.uploadFile);
  const setActiveFile = useAppStore((state) => state.setActiveFile);
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

  return (
    <div className="flex min-h-full flex-col">
      <section className="p-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">Files</h2>
          <label className="inline-flex cursor-pointer items-center gap-1 rounded-lg bg-brand px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-hover">
            <Upload size={14} />
            Upload
            <input type="file" multiple accept=".xlsx,.xlsm" onChange={(event) => { void upload(event.target.files); }} className="hidden" />
          </label>
        </div>
        <label onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); void upload(event.dataTransfer.files); }} className="mt-3 flex cursor-pointer flex-col items-center rounded-lg border border-dashed border-gray-300 bg-white p-4 text-center text-xs text-gray-500 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:hover:bg-gray-700">
          Drag workbooks here or pick multiple files
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
          {process.files.map((file) => {
            const valid = file.sheets.filter((sheet) => sheet.status === 'valid').length;
            const skipped = file.sheets.length - valid;
            const isActive = file.id === process.activeFileId;
            return (
              <button key={file.id} onClick={() => setActiveFile(process.id, file.id)} className={`w-full rounded-lg border p-3 text-left text-sm ${isActive ? 'border-blue-400 bg-blue-50 dark:bg-blue-950' : 'border-gray-200 bg-white hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:hover:bg-gray-700'}`}>
                <div className="flex gap-2">
                  <span className={isActive ? 'text-green-500' : 'text-gray-300'}>{isActive ? '●' : '○'}</span>
                  <div className="min-w-0">
                    <div className="truncate font-medium">{file.name}</div>
                    <div className="mt-1 text-xs text-gray-500">{valid} valid · {skipped} skipped · {file.isAudited ? 'Audited' : 'Not audited'}</div>
                    {file.lastAuditedAt ? <div className="mt-1 text-xs text-gray-500">Last audited: {new Date(file.lastAuditedAt).toLocaleString()}</div> : null}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </section>
      {activeFile ? <SheetList process={process} file={activeFile} /> : null}
    </div>
  );
}

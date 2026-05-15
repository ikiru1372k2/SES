import { AlertCircle, Download, Eye, RotateCcw, Trash2, Upload } from 'lucide-react';
import type { KeyboardEvent } from 'react';
import toast from 'react-hot-toast';
import { DEFAULT_FUNCTION_ID, type FunctionId } from '@ses/domain';
import { downloadFileToDisk } from '../../lib/api/filesApi';
import { validateWorkbookFile } from '../../lib/excelParser';
import type { AuditProcess, WorkbookFile } from '../../lib/types';
import { useAppStore } from '../../store/useAppStore';
import { useConfirm } from '../shared/ConfirmProvider';
import { ProgressBar } from '../shared/ProgressBar';
import { SheetList } from './SheetList';

/** Map raw server/storage errors to a message an end user can act on.
 * Technical detail is logged to the console, never shown verbatim. */
function humanizeUploadError(raw: string | undefined): string {
  const r = (raw ?? '').toLowerCase();
  if (r.includes('object-storage') || r.includes('object_storage') || r.includes('s3')) {
    return 'Upload failed — file storage is unavailable. Please try again, or contact an administrator if it persists.';
  }
  if (r.includes('413') || r.includes('too large') || r.includes('payload')) {
    return 'Upload failed — the file is too large. Workbooks must be 10 MB or smaller.';
  }
  if (r.includes('network') || r.includes('fetch') || r.includes('timeout')) {
    return 'Upload failed — network problem. Check your connection and try again.';
  }
  if (r.includes('401') || r.includes('403') || r.includes('unauthor')) {
    return 'Upload failed — your session may have expired. Sign in again and retry.';
  }
  return 'Upload failed. Please try again.';
}

interface Props {
  process: AuditProcess;
  functionId?: FunctionId;
  /** When false, upload + delete are disabled with a tooltip explaining why. Defaults to true (backward compat). */
  canEdit?: boolean;
  /** Tooltip text shown on disabled mutating controls. */
  readOnlyReason?: string | undefined;
}

export function FilesSidebar({ process, functionId, canEdit = true, readOnlyReason }: Props) {
  const confirm = useConfirm();
  const uploadFile = useAppStore((state) => state.uploadFile);
  const saveFileDraft = useAppStore((state) => state.saveFileDraft);
  const setActiveFile = useAppStore((state) => state.setActiveFile);
  const setWorkspaceTab = useAppStore((state) => state.setWorkspaceTab);
  const deleteFile = useAppStore((state) => state.deleteFile);
  const uploads = useAppStore((state) => state.uploads);
  const scopedFid: FunctionId = functionId ?? DEFAULT_FUNCTION_ID;
  const activeFile = process.files.find((file) => file.id === process.activeFileId) ?? process.files[0];
  const tooltip = !canEdit ? readOnlyReason : undefined;

  async function upload(files: FileList | null) {
    if (!canEdit) return;
    if (!files?.length) return;
    for (const file of Array.from(files)) {
      try {
        validateWorkbookFile(file);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : `${file.name} is not a supported workbook`);
        continue;
      }
      if (process.serverBacked) {
        await saveFileDraft(process.id, scopedFid, file).catch((error: unknown) => {
          console.warn('[drafts] upload draft save failed', error);
        });
      }
      void uploadFile(process.id, file, scopedFid)
        .then(() => toast.success(`${file.name} uploaded`))
        .catch((error: unknown) => {
          const msg = error instanceof Error ? error.message : undefined;
          toast.error(`${file.name}: ${humanizeUploadError(msg)}`);
        });
    }
  }

  function onView(file: WorkbookFile) {
    setActiveFile(process.id, file.id);
    setWorkspaceTab('preview');
  }

  async function onDownload(file: WorkbookFile) {
    const ref = (file as { displayCode?: string }).displayCode ?? file.id;
    try {
      await downloadFileToDisk(ref, file.name);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : `Could not download ${file.name}`);
    }
  }

  async function confirmDelete(file: WorkbookFile) {
    if (!canEdit) return;
    const ok = await confirm({
      title: `Delete ${file.name}?`,
      description: 'This removes the document and its audit data from this browser.',
      confirmLabel: 'Delete',
      tone: 'destructive',
    });
    if (!ok) return;
    deleteFile(process.id, file.id);
    toast.success(`${file.name} deleted`);
  }

  return (
    <div className="flex min-h-full flex-col">
      <section className="p-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">Documents</h2>
          <label
            aria-disabled={!canEdit}
            title={tooltip}
            className={`inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-medium text-white ${
              canEdit
                ? 'cursor-pointer bg-brand hover:bg-brand-hover'
                : 'cursor-not-allowed bg-gray-300 dark:bg-gray-700'
            }`}
          >
            <Upload size={14} />
            Upload
            <input
              type="file"
              multiple
              accept=".xlsx,.xlsm"
              disabled={!canEdit}
              onChange={(event) => { void upload(event.target.files); }}
              className="hidden"
            />
          </label>
        </div>
        <label
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => {
            event.preventDefault();
            if (!canEdit) return;
            void upload(event.dataTransfer.files);
          }}
          aria-disabled={!canEdit}
          title={tooltip}
          className={`mt-3 flex flex-col items-center rounded-lg border border-dashed border-gray-300 p-4 text-center text-xs ${
            canEdit
              ? 'cursor-pointer bg-white text-gray-500 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:hover:bg-gray-700'
              : 'cursor-not-allowed bg-gray-50 text-gray-400 dark:border-gray-700 dark:bg-gray-900'
          }`}
        >
          {canEdit ? 'Drag documents here or pick multiple files' : 'Read-only — upload disabled'}
          <input
            id="ses-file-reupload-input"
            type="file"
            multiple
            accept=".xlsx,.xlsm"
            disabled={!canEdit}
            onChange={(event) => { void upload(event.target.files); }}
            className="sr-only"
          />
        </label>
        <div className="mt-4 space-y-2">
          {Object.entries(uploads).map(([key, item]) => {
            const failed = item.status === 'failed';
            return (
              <div
                key={key}
                className={`rounded-lg border p-3 ${
                  failed
                    ? 'border-red-300 bg-red-50 dark:border-red-800/60 dark:bg-red-950/30'
                    : 'border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800'
                }`}
              >
                <div className="text-sm font-medium">{item.fileName}</div>
                {failed ? (
                  <>
                    <div
                      className="mt-1 flex items-start gap-1.5 text-xs text-red-700 dark:text-red-300"
                      role="status"
                      aria-live="polite"
                    >
                      <AlertCircle size={14} className="mt-px shrink-0" aria-hidden="true" />
                      <span>{humanizeUploadError(item.error)}</span>
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        document.getElementById('ses-file-reupload-input')?.click()
                      }
                      disabled={!canEdit}
                      className="mt-2 inline-flex min-h-[32px] items-center gap-1 rounded-md border border-red-300 bg-white px-2.5 py-1 text-xs font-medium text-red-700 hover:bg-red-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500 disabled:cursor-not-allowed disabled:opacity-50 dark:border-red-800/60 dark:bg-gray-900 dark:text-red-300"
                    >
                      <RotateCcw size={12} aria-hidden="true" /> Upload again
                    </button>
                  </>
                ) : (
                  <>
                    <div className="mt-1 text-xs text-gray-500" role="status" aria-live="polite">
                      {item.status === 'uploading' ? 'Uploading…' : 'Uploaded'}
                    </div>
                    <div className="mt-2"><ProgressBar value={item.progress} /></div>
                  </>
                )}
              </div>
            );
          })}
          {process.files.map((file) => (
            <DocumentCard
              key={file.id}
              file={file}
              isActive={file.id === process.activeFileId}
              serverBacked={Boolean(process.serverBacked)}
              canDelete={canEdit}
              deleteTooltip={tooltip}
              onSelect={() => setActiveFile(process.id, file.id)}
              onView={() => onView(file)}
              onDownload={() => void onDownload(file)}
              onDelete={() => void confirmDelete(file)}
            />
          ))}
        </div>
      </section>
      {activeFile ? <SheetList process={process} file={activeFile} canEdit={canEdit} readOnlyReason={readOnlyReason} /> : null}
    </div>
  );
}

function DocumentCard({
  file,
  isActive,
  serverBacked,
  canDelete,
  deleteTooltip,
  onSelect,
  onView,
  onDownload,
  onDelete,
}: {
  file: WorkbookFile;
  isActive: boolean;
  serverBacked: boolean;
  canDelete: boolean;
  deleteTooltip?: string | undefined;
  onSelect: () => void;
  onView: () => void;
  onDownload: () => void;
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
      <div className="flex gap-2 pr-24">
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
      <div className="absolute right-2 top-2 flex gap-0.5 opacity-0 transition focus-within:opacity-100 group-hover:opacity-100">
        <button
          type="button"
          aria-label={`View ${file.name}`}
          title="View preview"
          onClick={(event) => {
            event.stopPropagation();
            onView();
          }}
          className="rounded-md p-1 text-gray-500 hover:bg-gray-100 hover:text-gray-900 dark:hover:bg-gray-700"
        >
          <Eye size={14} />
        </button>
        {serverBacked ? (
          <button
            type="button"
            aria-label={`Download ${file.name}`}
            title="Download original file"
            onClick={(event) => {
              event.stopPropagation();
              onDownload();
            }}
            className="rounded-md p-1 text-gray-500 hover:bg-gray-100 hover:text-gray-900 dark:hover:bg-gray-700"
          >
            <Download size={14} />
          </button>
        ) : null}
        <button
          type="button"
          aria-label={`Delete ${file.name}`}
          title={canDelete ? 'Delete document' : deleteTooltip}
          disabled={!canDelete}
          onClick={(event) => {
            event.stopPropagation();
            onDelete();
          }}
          className={`rounded-md p-1 ${
            canDelete
              ? 'text-gray-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/30'
              : 'cursor-not-allowed text-gray-300 dark:text-gray-600'
          }`}
        >
          <Trash2 size={14} />
        </button>
      </div>
    </div>
  );
}

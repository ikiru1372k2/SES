import { AlertCircle, ChevronDown, Download, Eye, FileText, PanelLeftClose, RotateCcw, Trash2, Upload } from 'lucide-react';
import { useState, type DragEvent, type KeyboardEvent, type ReactNode } from 'react';
import toast from 'react-hot-toast';
import { DEFAULT_FUNCTION_ID, type FunctionId } from '@ses/domain';
import { downloadFileToDisk } from '../../lib/api/filesApi';
import { validateWorkbookFile } from '../../lib/workbook/excelParser';
import type { AuditProcess, WorkbookFile } from '../../lib/domain/types';
import { useSidebarCollapsed } from '../../hooks/useSidebarCollapsed';
import { useAppStore } from '../../store/useAppStore';
import { useConfirm } from '../shared/ConfirmProvider';
import { ProgressBar } from '../shared/ProgressBar';
import { SheetList } from './SheetList';

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
  canEdit?: boolean;
  readOnlyReason?: string | undefined;
}

export function FilesSidebar({ process, functionId, canEdit = true, readOnlyReason }: Props) {
  const confirm = useConfirm();
  const [, setSidebarCollapsed] = useSidebarCollapsed();
  const [dragActive, setDragActive] = useState(false);
  const uploadFile = useAppStore((state) => state.uploadFile);
  const saveFileDraft = useAppStore((state) => state.saveFileDraft);
  const setActiveFile = useAppStore((state) => state.setActiveFile);
  const setWorkspaceTab = useAppStore((state) => state.setWorkspaceTab);
  const deleteFile = useAppStore((state) => state.deleteFile);
  const uploads = useAppStore((state) => state.uploads);
  const scopedFid: FunctionId = functionId ?? DEFAULT_FUNCTION_ID;
  const activeFile = process.files.find((file) => file.id === process.activeFileId) ?? process.files[0];
  const tooltip = !canEdit ? readOnlyReason : undefined;
  const uploadInputId = 'ses-workspace-upload-input';

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

  function onDragOver(event: DragEvent) {
    event.preventDefault();
    event.stopPropagation();
    if (canEdit) setDragActive(true);
  }

  function onDragLeave(event: DragEvent) {
    event.preventDefault();
    event.stopPropagation();
    setDragActive(false);
  }

  function onDrop(event: DragEvent) {
    event.preventDefault();
    event.stopPropagation();
    setDragActive(false);
    if (!canEdit) return;
    void upload(event.dataTransfer.files);
  }

  const activeUploads = Object.entries(uploads);

  return (
    <div className="flex h-full min-h-0 flex-col bg-white dark:bg-gray-950">
      <div className="flex shrink-0 items-center gap-2 border-b border-rule px-3 py-2.5 dark:border-gray-800">
        <FileText size={13} className="shrink-0 text-brand" aria-hidden />
        <h2 className="flex-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-2 dark:text-gray-200">
          Documents
        </h2>
        <span className="rounded-full bg-surface-2 px-1.5 py-0.5 text-[10px] font-bold tabular-nums text-ink-3 dark:bg-gray-800">
          {process.files.length}
        </span>
        <button
          type="button"
          onClick={() => setSidebarCollapsed(true)}
          aria-label="Collapse documents sidebar"
          title="Collapse sidebar"
          className="rounded-md p-1 text-ink-3 transition-colors hover:bg-surface-app hover:text-ink dark:hover:bg-gray-800"
        >
          <PanelLeftClose size={14} />
        </button>
      </div>

      <SidebarSection
        title="Files"
        count={process.files.length}
        defaultOpen
        scrollable
      >
      <div className="space-y-1.5 px-3 pb-2 pt-2">
        {activeUploads.map(([key, item]) => {
          const failed = item.status === 'failed';
          return (
            <div
              key={key}
              className={`rounded-lg border p-2.5 ${
                failed
                  ? 'border-red-300 bg-red-50 dark:border-red-800/60 dark:bg-red-950/30'
                  : 'border-rule bg-white dark:border-gray-700 dark:bg-gray-900'
              }`}
            >
              <div className="text-[12.5px] font-semibold text-ink">{item.fileName}</div>
              {failed ? (
                <>
                  <div className="mt-1 flex items-start gap-1.5 text-[11px] text-red-700 dark:text-red-300" role="status" aria-live="polite">
                    <AlertCircle size={12} className="mt-px shrink-0" aria-hidden />
                    <span>{humanizeUploadError(item.error)}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => document.getElementById(uploadInputId)?.click()}
                    disabled={!canEdit}
                    className="mt-2 inline-flex items-center gap-1 rounded-md border border-red-300 bg-white px-2 py-1 text-[11px] font-medium text-red-700 hover:bg-red-50 disabled:opacity-50 dark:border-red-800/60 dark:bg-gray-900 dark:text-red-300"
                  >
                    <RotateCcw size={11} aria-hidden /> Upload again
                  </button>
                </>
              ) : (
                <>
                  <div className="mt-0.5 text-[11px] text-ink-3" role="status" aria-live="polite">
                    {item.status === 'uploading' ? 'Uploading…' : 'Uploaded'}
                  </div>
                  <div className="mt-1.5">
                    <ProgressBar value={item.progress} />
                  </div>
                </>
              )}
            </div>
          );
        })}

        {process.files.length === 0 && activeUploads.length === 0 ? (
          <p className="px-1 py-6 text-center text-[11px] text-ink-3">
            No documents yet. Drop a workbook below to start.
          </p>
        ) : null}

        {process.files.map((file) => (
          <DocumentCard
            key={file.id}
            file={file}
            isActive={file.id === process.activeFileId}
            versionBadge={
              file.id === process.activeFileId && process.versions[0]
                ? process.versions[0].versionName
                : undefined
            }
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
      </SidebarSection>

      <div className="shrink-0 space-y-2 border-t border-rule px-3 py-2.5 dark:border-gray-800">
        <label
          aria-disabled={!canEdit}
          title={tooltip}
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onDrop={onDrop}
          className={`flex flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed px-3 py-4 text-center transition-all ease-soft ${
            dragActive
              ? 'scale-[1.01] border-brand bg-brand-subtle shadow-soft dark:bg-brand/10'
              : 'border-rule-2 bg-surface-app hover:border-brand/50 hover:bg-brand-subtle/40 dark:border-gray-700 dark:bg-gray-900/50'
          } ${canEdit ? 'cursor-pointer' : 'cursor-not-allowed opacity-50'}`}
        >
          <span
            className={`flex h-8 w-8 items-center justify-center rounded-full transition-colors ${
              dragActive ? 'bg-brand text-white' : 'bg-white text-ink-3 shadow-soft dark:bg-gray-800'
            }`}
            aria-hidden
          >
            <Upload size={15} strokeWidth={2} />
          </span>
          <span className="text-[12px] font-semibold text-ink-2 dark:text-gray-200">
            {canEdit ? (dragActive ? 'Drop to upload' : 'Drag & drop or click to upload') : 'Read-only — upload disabled'}
          </span>
          <span className="text-[10px] text-ink-3">.xlsx or .xlsm · up to 10 MB</span>
          <input
            id={uploadInputId}
            type="file"
            multiple
            accept=".xlsx,.xlsm"
            disabled={!canEdit}
            onChange={(event) => {
              void upload(event.target.files);
            }}
            className="sr-only"
          />
        </label>
        {!canEdit && readOnlyReason ? (
          <p className="text-center text-[10px] text-ink-3">{readOnlyReason}</p>
        ) : null}
      </div>

      {activeFile ? (
        <SidebarSection
          title="Sheets"
          count={activeFile.sheets.length}
          defaultOpen
          scrollable
          className="border-t border-rule dark:border-gray-800"
        >
          <SheetList process={process} file={activeFile} canEdit={canEdit} readOnlyReason={readOnlyReason} />
        </SidebarSection>
      ) : null}
    </div>
  );
}

/**
 * Collapsible, optionally-scrollable sidebar section. Header toggles open;
 * when `scrollable`, the body flexes and scrolls internally so a long list
 * (many uploaded documents / sheets) never pushes the dropzone or other
 * sections off-screen.
 */
function SidebarSection({
  title,
  count,
  defaultOpen = true,
  scrollable = false,
  className = '',
  children,
}: {
  title: string;
  count?: number;
  defaultOpen?: boolean;
  scrollable?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div
      className={`flex min-h-0 flex-col ${open && scrollable ? 'flex-1' : 'shrink-0'} ${className}`}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex shrink-0 items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-surface-app dark:hover:bg-gray-900/50"
      >
        <ChevronDown
          size={13}
          className={`shrink-0 text-ink-3 transition-transform duration-150 ease-soft ${open ? '' : '-rotate-90'}`}
          aria-hidden
        />
        <span className="flex-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-3">
          {title}
        </span>
        {typeof count === 'number' ? (
          <span className="rounded-full bg-surface-2 px-1.5 py-0.5 text-[10px] font-bold tabular-nums text-ink-3 dark:bg-gray-800">
            {count}
          </span>
        ) : null}
      </button>
      {open ? (
        <div className={scrollable ? 'min-h-0 flex-1 overflow-y-auto' : ''}>{children}</div>
      ) : null}
    </div>
  );
}

function formatDocMeta(file: WorkbookFile, isActive: boolean): string {
  const sheetCount = file.sheets.length;
  if (file.lastAuditedAt) {
    const delta = Date.now() - new Date(file.lastAuditedAt).getTime();
    const ago =
      delta < 60_000
        ? 'just now'
        : delta < 3_600_000
          ? `${Math.floor(delta / 60_000)} min ago`
          : `${Math.floor(delta / 3_600_000)} h ago`;
    return `${sheetCount} sheet${sheetCount === 1 ? '' : 's'} · audited ${ago}`;
  }
  if (!isActive) return `${sheetCount} sheet${sheetCount === 1 ? '' : 's'} · archived`;
  return `${sheetCount} sheet${sheetCount === 1 ? '' : 's'}`;
}

function shortVersionLabel(name: string): string {
  const trimmed = name.trim();
  if (/^v\d+/i.test(trimmed)) return trimmed.toUpperCase();
  return trimmed;
}

function DocumentCard({
  file,
  isActive,
  versionBadge,
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
  versionBadge?: string | undefined;
  serverBacked: boolean;
  canDelete: boolean;
  deleteTooltip?: string | undefined;
  onSelect: () => void;
  onView: () => void;
  onDownload: () => void;
  onDelete: () => void;
}) {
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
      className={`group relative w-full cursor-pointer rounded-xl border px-3 py-2.5 text-left transition-all ease-soft focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand ${
        isActive
          ? 'border-brand/40 bg-brand-subtle shadow-soft ring-1 ring-inset ring-brand/15 dark:border-brand/45 dark:bg-brand/10'
          : 'border-rule bg-white shadow-soft hover:-translate-y-0.5 hover:border-brand/40 hover:shadow-soft-md dark:border-gray-800 dark:bg-gray-900 dark:hover:border-brand/40'
      }`}
    >
      <div className="flex items-start gap-2 pr-16">
        <FileText size={12} className={`mt-0.5 shrink-0 ${isActive ? 'text-brand' : 'text-ink-3'}`} aria-hidden />
        <div className="min-w-0 flex-1">
          <div className={`truncate text-[12.5px] font-semibold leading-snug ${isActive ? 'text-brand' : 'text-ink dark:text-gray-100'}`}>
            {file.name}
          </div>
          <div className="mt-0.5 text-[11px] leading-snug text-ink-3">{formatDocMeta(file, isActive)}</div>
        </div>
      </div>
      {versionBadge ? (
        <span className="absolute right-2 top-2 rounded-full bg-brand-subtle px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-brand ring-1 ring-inset ring-brand/20 dark:bg-brand/20">
          {shortVersionLabel(versionBadge)}
        </span>
      ) : null}
      <div className="absolute bottom-1.5 right-1.5 flex gap-0.5 opacity-0 transition group-focus-within:opacity-100 group-hover:opacity-100">
        <button
          type="button"
          aria-label={`View ${file.name}`}
          title="View preview"
          onClick={(event) => {
            event.stopPropagation();
            onView();
          }}
          className="rounded-md p-1 text-ink-3 transition-colors hover:bg-surface-2 hover:text-ink dark:hover:bg-gray-800"
        >
          <Eye size={13} />
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
            className="rounded-md p-1 text-ink-3 transition-colors hover:bg-surface-2 hover:text-ink dark:hover:bg-gray-800"
          >
            <Download size={13} />
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
          className={`rounded p-0.5 ${canDelete ? 'text-ink-3 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/40' : 'cursor-not-allowed opacity-40'}`}
        >
          <Trash2 size={13} />
        </button>
      </div>
    </div>
  );
}

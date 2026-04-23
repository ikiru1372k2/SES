import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState, type ChangeEvent, type DragEvent } from 'react';
import toast from 'react-hot-toast';
import { Download, FileText, Image as ImageIcon, Mail, Paperclip, Trash2, Upload } from 'lucide-react';
import {
  attachmentDownloadUrl,
  deleteAttachment,
  listAttachments,
  patchAttachmentComment,
  uploadAttachment,
  type TrackingAttachmentMeta,
} from '../../lib/api/trackingAttachmentsApi';
import { useCurrentUser } from '../auth/authContext';
import { Button } from '../shared/Button';
import { useConfirm } from '../shared/ConfirmProvider';

const MAX_BYTES = 10 * 1024 * 1024;
const MAX_COUNT = 20;
const ACCEPT =
  '.pdf,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg,.txt,.eml,.msg';

function iconFor(mime: string) {
  if (mime.startsWith('image/')) return <ImageIcon size={16} className="text-gray-500" />;
  if (mime === 'message/rfc822' || mime === 'application/vnd.ms-outlook') {
    return <Mail size={16} className="text-gray-500" />;
  }
  return <FileText size={16} className="text-gray-500" />;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function AttachmentsTab({ trackingIdOrCode }: { trackingIdOrCode: string | null }) {
  const qc = useQueryClient();
  const user = useCurrentUser();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  const q = useQuery({
    queryKey: ['tracking-attachments', trackingIdOrCode],
    queryFn: () => listAttachments(trackingIdOrCode!),
    enabled: Boolean(trackingIdOrCode),
    staleTime: 15_000,
  });

  const uploadMut = useMutation({
    mutationFn: ({ file, comment }: { file: File; comment: string }) =>
      uploadAttachment(trackingIdOrCode!, file, comment),
    onSuccess: () => {
      toast.success('Attachment uploaded.');
      void qc.invalidateQueries({ queryKey: ['tracking-attachments', trackingIdOrCode] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (!trackingIdOrCode) {
    return <p className="text-sm text-gray-500">No tracking record for this manager.</p>;
  }

  const rows = q.data ?? [];
  const atLimit = rows.length >= MAX_COUNT;

  function handleFile(file: File, comment = '') {
    if (file.size > MAX_BYTES) {
      toast.error(`${file.name} exceeds the 10 MB limit.`);
      return;
    }
    if (atLimit) {
      toast.error(`Attachment limit reached (${MAX_COUNT} per entry).`);
      return;
    }
    uploadMut.mutate({ file, comment });
  }

  function onPickChange(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (f) handleFile(f);
    // Reset so the same file can be re-selected after a failure.
    if (inputRef.current) inputRef.current.value = '';
  }

  function onDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files?.[0];
    if (f) handleFile(f);
  }

  return (
    <div className="space-y-4">
      <div
        role="button"
        tabIndex={0}
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            inputRef.current?.click();
          }
        }}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        aria-label="Upload attachment"
        className={`flex cursor-pointer flex-col items-center gap-1 rounded-lg border-2 border-dashed px-4 py-6 text-center text-sm transition ${
          dragOver
            ? 'border-brand bg-brand/5 text-brand'
            : 'border-gray-300 bg-gray-50 text-gray-600 hover:border-gray-400 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300'
        } ${atLimit ? 'pointer-events-none opacity-60' : ''}`}
      >
        <Upload size={18} />
        <div>
          <span className="font-medium">Drag & drop</span> a file, or click to browse
        </div>
        <div className="text-[11px] text-gray-500">
          PDF · DOCX · XLSX · PNG · JPG · TXT · EML · MSG — up to 10 MB, max {MAX_COUNT} per entry
          {atLimit ? ' (limit reached)' : ''}
        </div>
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT}
          className="hidden"
          onChange={onPickChange}
        />
      </div>

      {q.isLoading ? (
        <div className="text-sm text-gray-500">Loading attachments…</div>
      ) : null}
      {q.isError ? (
        <div className="text-sm text-red-600">{(q.error as Error).message}</div>
      ) : null}

      {rows.length === 0 && !q.isLoading ? (
        <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 text-sm text-gray-600 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300">
          <div className="mb-1 flex items-center gap-1 font-medium">
            <Paperclip size={14} /> No attachments yet.
          </div>
          <div className="text-xs">
            Examples: screenshots of corrections, forwarded emails from the manager, supporting policy docs.
          </div>
        </div>
      ) : null}

      <ul className="space-y-2">
        {rows.map((att) => (
          <AttachmentCard
            key={att.id}
            att={att}
            trackingIdOrCode={trackingIdOrCode}
            canDelete={att.uploadedById === user?.id || user?.role === 'admin'}
          />
        ))}
      </ul>
    </div>
  );
}

function AttachmentCard({
  att,
  trackingIdOrCode,
  canDelete,
}: {
  att: TrackingAttachmentMeta;
  trackingIdOrCode: string;
  canDelete: boolean;
}) {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const [editing, setEditing] = useState(false);
  const [comment, setComment] = useState(att.comment);

  const patchMut = useMutation({
    mutationFn: (next: string) => patchAttachmentComment(trackingIdOrCode, att.id, next),
    onSuccess: () => {
      setEditing(false);
      void qc.invalidateQueries({ queryKey: ['tracking-attachments', trackingIdOrCode] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const delMut = useMutation({
    mutationFn: () => deleteAttachment(trackingIdOrCode, att.id),
    onSuccess: () => {
      toast.success('Attachment removed.');
      void qc.invalidateQueries({ queryKey: ['tracking-attachments', trackingIdOrCode] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <li className="rounded-lg border border-gray-200 p-3 dark:border-gray-700">
      <div className="flex items-start gap-2">
        <div className="pt-0.5">{iconFor(att.mimeType)}</div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <a
              href={attachmentDownloadUrl(trackingIdOrCode, att.id)}
              className="truncate text-sm font-medium text-gray-900 hover:underline dark:text-white"
              title={att.fileName}
            >
              {att.fileName}
            </a>
            <span className="text-[11px] text-gray-500">{formatSize(att.sizeBytes)}</span>
          </div>
          <div className="text-[11px] text-gray-500">
            Uploaded by {att.uploadedByName || 'unknown'} · {new Date(att.createdAt).toLocaleString()}
          </div>
          {editing ? (
            <div className="mt-2 flex gap-2">
              <input
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                className="min-w-0 flex-1 rounded border border-gray-300 px-2 py-1 text-sm dark:border-gray-600 dark:bg-gray-900"
                placeholder="What is this file?"
              />
              <Button
                type="button"
                onClick={() => patchMut.mutate(comment)}
                disabled={patchMut.isPending}
              >
                Save
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  setComment(att.comment);
                  setEditing(false);
                }}
                disabled={patchMut.isPending}
              >
                Cancel
              </Button>
            </div>
          ) : (
            <button
              type="button"
              className="mt-1 block w-full text-left text-sm text-gray-700 hover:bg-gray-50 dark:text-gray-200 dark:hover:bg-gray-800/60"
              onClick={() => setEditing(true)}
              title="Click to edit the comment"
            >
              {att.comment || <span className="italic text-gray-400">Click to add a comment</span>}
            </button>
          )}
        </div>
        <div className="flex flex-col items-end gap-1">
          <a
            href={attachmentDownloadUrl(trackingIdOrCode, att.id)}
            className="inline-flex items-center gap-1 rounded border border-gray-300 px-2 py-1 text-xs text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300"
            title="Download"
          >
            <Download size={12} /> Download
          </a>
          {canDelete ? (
            <button
              type="button"
              className="inline-flex items-center gap-1 rounded border border-red-200 px-2 py-1 text-xs text-red-600 hover:bg-red-50 disabled:opacity-60 dark:border-red-900 dark:hover:bg-red-950"
              disabled={delMut.isPending}
              onClick={async () => {
                const ok = await confirm({
                  title: 'Remove attachment?',
                  description: att.fileName,
                  confirmLabel: 'Remove',
                  tone: 'destructive',
                });
                if (!ok) return;
                delMut.mutate();
              }}
            >
              <Trash2 size={12} /> Delete
            </button>
          ) : null}
        </div>
      </div>
    </li>
  );
}

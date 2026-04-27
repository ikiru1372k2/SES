import { PreviewPane } from '../PreviewPane';

export interface EditPaneProps {
  viewMode: 'preview' | 'edit';
  subject: string;
  body: string;
  readOnly: boolean;
  resolvedPreview: { subject: string; body: string; bodyHtml?: string } | null;
  previewLoading: boolean;
  deadlineAt: string;
  onSubjectChange: (value: string) => void;
  onBodyChange: (value: string) => void;
}

export function EditPane({
  viewMode,
  subject,
  body,
  readOnly,
  resolvedPreview,
  previewLoading,
  deadlineAt,
  onSubjectChange,
  onBodyChange,
}: EditPaneProps) {
  if (viewMode === 'edit') {
    return (
      <>
        <div>
          <label className="text-xs font-medium text-gray-500">Subject</label>
          <input
            disabled={readOnly}
            value={subject}
            onChange={(e) => onSubjectChange(e.target.value)}
            className="mt-1 w-full rounded border border-gray-300 px-2 py-1.5 text-sm dark:border-gray-600 dark:bg-gray-900"
          />
        </div>
        <div>
          <label className="text-xs font-medium text-gray-500">Body (markdown)</label>
          <textarea
            disabled={readOnly}
            value={body}
            onChange={(e) => onBodyChange(e.target.value)}
            rows={10}
            className="mt-1 w-full rounded border border-gray-300 px-2 py-1.5 font-mono text-sm dark:border-gray-600 dark:bg-gray-900"
          />
        </div>
      </>
    );
  }

  return (
    <div className="space-y-2">
      <div className="text-[11px] uppercase tracking-wide text-gray-500">
        Preview (what the manager will see)
      </div>
      <PreviewPane
        subject={resolvedPreview?.subject ?? (previewLoading ? 'Loading…' : subject)}
        body={resolvedPreview?.body ?? (previewLoading ? 'Loading…' : body)}
        {...(resolvedPreview?.bodyHtml ? { bodyHtml: resolvedPreview.bodyHtml } : {})}
        deadlineAt={deadlineAt || null}
      />
    </div>
  );
}

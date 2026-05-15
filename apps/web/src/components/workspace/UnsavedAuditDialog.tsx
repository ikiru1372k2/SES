import { AlertTriangle } from 'lucide-react';
import toast from 'react-hot-toast';
import type { AuditProcess, AuditResult } from '../../lib/domain/types';
import { anchorResultForFile, formatDiffChips, summarizeDiff } from '../../lib/workbook/versionDiff';
import { useAppStore } from '../../store/useAppStore';
import { Button } from '../shared/Button';
import { Modal } from '../shared/Modal';

// Shown when the user tries to navigate away from a workspace that has an
// audit whose findings aren't reflected in any saved version. Three
// choices to mirror the Save split-button mental model:
//   • Update V3 — silent overwrite of versions[0] with the latest run.
//   • Save as V4… — open the full Save-as-new modal (we drive this via
//     setSaveAsNewOpen lifted by the parent, because navigation has to
//     un-block first).
//   • Leave — proceed with navigation, accept data loss.
export function UnsavedAuditDialog({
  open,
  process,
  latestResult,
  activeFileId,
  onUpdate,
  onSaveAsNew,
  onLeave,
  onCancel,
}: {
  open: boolean;
  process: AuditProcess;
  latestResult: AuditResult | null;
  activeFileId: string | undefined;
  onUpdate: () => void;
  onSaveAsNew: () => void;
  onLeave: () => void;
  onCancel: () => void;
}) {
  const saveOverCurrentVersion = useAppStore((state) => state.saveOverCurrentVersion);
  const anchor = anchorResultForFile(process.versions, activeFileId ?? latestResult?.fileId);
  const headVersion = process.versions.find((v) => v.result.fileId === (activeFileId ?? latestResult?.fileId)) ?? process.versions[0];
  const diff = summarizeDiff(anchor, latestResult);
  const headLabel = headVersion?.versionName ?? 'current version';

  function update() {
    const updated = saveOverCurrentVersion(process.id);
    if (updated) {
      toast.success(`Saved to ${updated.versions[0]?.versionName ?? headLabel}`);
    }
    onUpdate();
  }

  return (
    <Modal
      open={open}
      onClose={onCancel}
      size="md"
      title={
        <span className="inline-flex items-center gap-2">
          <AlertTriangle size={16} className="text-amber-500" />
          Unsaved audit changes
        </span>
      }
      description="Your latest audit produced findings that aren't in any saved version. Pick one before leaving."
      dismissOnOverlayClick={false}
      footer={
        <div className="flex w-full flex-wrap items-center justify-end gap-2">
          <Button variant="ghost" onClick={onLeave}>
            Leave anyway
          </Button>
          <Button variant="secondary" onClick={onSaveAsNew}>
            Save as new version…
          </Button>
          <Button onClick={update}>Update {headLabel}</Button>
        </div>
      }
    >
      <dl className="space-y-3 text-sm">
        {headVersion ? (
          <div className="rounded-lg border border-gray-200 p-3 dark:border-gray-700">
            <dt className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">
              Current saved version
            </dt>
            <dd className="mt-1 font-medium text-gray-900 dark:text-gray-100">{headVersion.versionName}</dd>
            <dd className="text-xs text-gray-500">
              {new Date(headVersion.createdAt).toLocaleString()} · {headVersion.result.issues.length} issues
            </dd>
          </div>
        ) : (
          <div className="rounded-lg border border-dashed border-gray-200 p-3 text-xs text-gray-500 dark:border-gray-700">
            No version saved yet — the first save creates V1.
          </div>
        )}
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 dark:border-amber-900 dark:bg-amber-950/30">
          <dt className="text-[11px] font-semibold uppercase tracking-wide text-amber-800 dark:text-amber-200">
            Latest run (unsaved)
          </dt>
          <dd className="mt-1 font-medium text-gray-900 dark:text-gray-100">
            {latestResult ? new Date(latestResult.runAt).toLocaleString() : '—'} ·{' '}
            {latestResult?.issues.length ?? 0} issues
          </dd>
          {diff && !diff.identical ? (
            <dd className="mt-1 text-xs text-amber-900 dark:text-amber-200">
              {formatDiffChips(diff)}
              {diff.severityBumps > 0 ? ` · ${diff.severityBumps} severity bump${diff.severityBumps === 1 ? '' : 's'}` : ''}
            </dd>
          ) : null}
        </div>
      </dl>
    </Modal>
  );
}

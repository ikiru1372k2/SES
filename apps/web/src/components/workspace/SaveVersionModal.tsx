import { FormEvent, useState } from 'react';
import toast from 'react-hot-toast';
import { Button } from '../shared/Button';
import { displayName } from '../../lib/storage';
import { isAuditDueSoon, nextDueDateAfterSave } from '../../lib/scheduleHelpers';
import type { AuditProcess } from '../../lib/types';
import { useAppStore } from '../../store/useAppStore';
import { formatDiffChips, summarizeDiff, suggestVersionName } from '../../lib/versionDiff';

export function SaveVersionModal({ process, onClose }: { process: AuditProcess; onClose: () => void }) {
  const saveVersion = useAppStore((state) => state.saveVersion);
  const updateProcess = useAppStore((state) => state.updateProcess);
  const setWorkspaceTab = useAppStore((state) => state.setWorkspaceTab);
  const latestResult = useAppStore((state) => state.currentAuditResult) ?? process.latestAuditResult ?? null;
  const nextVersion = process.versions.length + 1;
  const headVersion = process.versions[0];
  const diff = summarizeDiff(headVersion?.result ?? null, latestResult);
  const suggested = suggestVersionName(displayName(process.name), nextVersion, diff);
  const [versionName, setVersionName] = useState(suggested);
  const [notes, setNotes] = useState('');
  const [confirmedIdentical, setConfirmedIdentical] = useState(false);
  const identicalGuardActive = Boolean(diff?.identical && headVersion);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (identicalGuardActive && !confirmedIdentical) {
      setConfirmedIdentical(true);
      return;
    }
    const updated = saveVersion(process.id, { versionName, notes });
    const savedName = updated?.versions[0]?.versionName ?? versionName;
    if (updated && isAuditDueSoon(updated)) {
      const nextDue = nextDueDateAfterSave(updated);
      const previousDue = process.nextAuditDue;
      void updateProcess(process.id, { nextAuditDue: nextDue }).catch(() =>
        toast.error('Could not schedule next audit date'),
      );
      const prettyDate = new Date(`${nextDue}T00:00:00`).toLocaleDateString();
      toast.success(
        (t) => (
          <div className="flex items-center gap-3">
            <span>
              {savedName} saved. Next audit: <strong>{prettyDate}</strong>.
            </span>
            <button
              type="button"
              onClick={() => {
                toast.dismiss(t.id);
                void updateProcess(process.id, { nextAuditDue: previousDue ?? null }).catch(() =>
                  toast.error('Could not undo schedule change'),
                );
              }}
              className="rounded-md border border-gray-300 px-2 py-1 text-xs font-medium hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800"
            >
              Undo
            </button>
          </div>
        ),
        { duration: 6000 },
      );
    } else {
      toast.success(`${savedName} saved`);
    }
    setWorkspaceTab('results');
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <form onSubmit={submit} className="w-full max-w-lg rounded-xl border border-gray-200 bg-white p-5 shadow-xl dark:border-gray-700 dark:bg-gray-900">
        <h2 className="text-lg font-semibold">Save as new version</h2>
        <p className="mt-1 text-sm text-gray-500">
          Creates a new named checkpoint. Use the main Save button when you just want to refresh the current version in place.
        </p>
        {diff && headVersion ? (
          <div className="mt-4 rounded-lg border border-gray-200 bg-gray-50 p-3 text-xs dark:border-gray-700 dark:bg-gray-800">
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium text-gray-700 dark:text-gray-200">Since {headVersion.versionName}</span>
              <span className="text-gray-500">{formatDiffChips(diff)}</span>
            </div>
            {diff.severityBumps > 0 || diff.managerReassignments > 0 ? (
              <div className="mt-1 text-gray-500">
                {diff.severityBumps > 0 ? `${diff.severityBumps} severity bump${diff.severityBumps === 1 ? '' : 's'}` : null}
                {diff.severityBumps > 0 && diff.managerReassignments > 0 ? ' · ' : ''}
                {diff.managerReassignments > 0 ? `${diff.managerReassignments} manager reassignment${diff.managerReassignments === 1 ? '' : 's'}` : null}
              </div>
            ) : null}
          </div>
        ) : null}
        {identicalGuardActive ? (
          <div
            className={`mt-3 rounded-lg border p-3 text-xs ${
              confirmedIdentical
                ? 'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-100'
                : 'border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200'
            }`}
          >
            This audit's findings are identical to {headVersion?.versionName ?? 'the current version'}.{' '}
            {confirmedIdentical
              ? `Press Save again to create V${nextVersion} anyway, or Cancel to skip.`
              : 'Saving will create a duplicate-content version.'}
          </div>
        ) : null}
        <label className="mt-5 block text-sm font-medium">Version name</label>
        <input
          value={versionName}
          onChange={(event) => setVersionName(event.target.value)}
          required
          className="mt-2 w-full rounded-lg border border-gray-300 px-3 py-2 dark:border-gray-700 dark:bg-gray-800"
        />
        <p className="mt-1 text-xs text-gray-500">Suggested from the diff — edit freely.</p>
        <label className="mt-4 block text-sm font-medium">Notes</label>
        <textarea
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          placeholder="Optional audit context, workbook changes, or escalation notes"
          className="mt-2 h-24 w-full rounded-lg border border-gray-300 px-3 py-2 dark:border-gray-700 dark:bg-gray-800"
        />
        <div className="mt-5 rounded-lg bg-gray-50 p-3 text-xs text-gray-600 dark:bg-gray-800 dark:text-gray-300">
          Version ID will be {process.id}-v{nextVersion}.
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit">
            {identicalGuardActive && confirmedIdentical ? `Save V${nextVersion} anyway` : 'Save Version'}
          </Button>
        </div>
      </form>
    </div>
  );
}

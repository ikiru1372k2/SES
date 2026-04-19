import { ArrowDownToLine, ArrowLeft, Loader2, LogOut, Play, Save } from 'lucide-react';
import { FormEvent, useState, type ReactNode } from 'react';
import toast from 'react-hot-toast';
import { Link, useNavigate } from 'react-router-dom';
import { useKeyboardShortcut } from '../../hooks/useKeyboardShortcut';
import { downloadAuditedWorkbook } from '../../lib/excelParser';
import { isAuditDueSoon, nextDueDateAfterSave } from '../../lib/scheduleHelpers';
import { displayName } from '../../lib/storage';
import type { AuditProcess } from '../../lib/types';
import { selectCorrectionCount, selectHasUnsavedAudit, selectLatestAuditResult } from '../../store/selectors';
import { useAppStore } from '../../store/useAppStore';
import { BrandMark } from '../shared/BrandMark';
import { Button } from '../shared/Button';

async function signOutAndRedirect(navigate: ReturnType<typeof useNavigate>) {
  try {
    await fetch('/api/v1/auth/logout', { method: 'POST', credentials: 'include' });
  } catch {
    // Network errors shouldn't block the user from leaving.
  }
  void navigate('/login');
}

export function TopBar({ process, accessory }: { process?: AuditProcess | undefined; accessory?: ReactNode }) {
  const navigate = useNavigate();
  const currentAuditResult = useAppStore((state) => state.currentAuditResult);
  const isAuditRunning = useAppStore((state) => state.isAuditRunning);
  const runAudit = useAppStore((state) => state.runAudit);
  const [versionModalOpen, setVersionModalOpen] = useState(false);
  const activeFile = process?.files.find((file) => file.id === process.activeFileId);
  const selectedSheets = activeFile?.sheets.filter((sheet) => sheet.status === 'valid' && sheet.isSelected).length ?? 0;
  const hasSavedVersion = (process?.versions.length ?? 0) > 0;
  const latestResult = currentAuditResult ?? (process ? selectLatestAuditResult(process) : null);
  const correctionCount = process ? selectCorrectionCount(process) : 0;
  const hasUnsavedAudit = process ? selectHasUnsavedAudit(process) : false;
  const canRun = Boolean(process && activeFile && selectedSheets > 0 && !isAuditRunning);
  const canSave = Boolean(process && latestResult && hasUnsavedAudit && !isAuditRunning);
  const canDownload = Boolean(process && activeFile && latestResult && hasSavedVersion && !isAuditRunning);

  async function onRunAudit() {
    if (!process || !activeFile || !canRun) return;
    await runAudit(process.id, activeFile.id);
    const result = useAppStore.getState().currentAuditResult;
    if (result) toast.success(`Audit complete - ${result.scannedRows} rows scanned, ${result.issues.length} issues found`);
  }

  function onDownload() {
    if (!activeFile || !latestResult) return;
    downloadAuditedWorkbook(activeFile, latestResult).catch(() => toast.error('Could not download audited workbook'));
  }

  function onDownloadCorrected() {
    if (!activeFile || !latestResult || !process) return;
    downloadAuditedWorkbook(activeFile, latestResult, process.corrections).catch(() => toast.error('Could not download corrected workbook'));
  }
  useKeyboardShortcut('r', () => { void onRunAudit(); }, canRun);
  useKeyboardShortcut('s', () => setVersionModalOpen(true), canSave);

  if (!process) {
    return (
      <header className="flex h-[52px] items-center justify-between border-b border-gray-200 bg-white px-5 shadow-sm dark:border-gray-800 dark:bg-gray-950">
        <Link to="/" className="min-w-0">
          <BrandMark />
        </Link>
        <div className="flex items-center gap-2">
          <Link to="/compare" className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-800 hover:border-brand hover:text-brand dark:border-gray-700 dark:text-gray-100 dark:hover:bg-gray-900">Compare Processes</Link>
          <button
            type="button"
            onClick={() => void signOutAndRedirect(navigate)}
            title="Sign out"
            className="flex items-center gap-1 rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-700 hover:border-gray-300 dark:border-gray-700 dark:text-gray-300 dark:hover:border-gray-600"
          >
            <LogOut size={14} />
            <span className="hidden sm:inline">Sign out</span>
          </button>
        </div>
      </header>
    );
  }

  return (
    <header className="flex h-[52px] items-center justify-between gap-4 border-b border-gray-200 bg-white px-5 shadow-sm dark:border-gray-800 dark:bg-gray-950">
      <div className="flex min-w-0 items-center gap-5">
        <Link
          to="/"
          onClick={(event) => {
            if (hasUnsavedAudit && !window.confirm('This audit has not been saved as a version. Go back to the dashboard anyway?')) {
              event.preventDefault();
            }
          }}
          className="flex items-center gap-2 text-sm font-medium text-gray-700 hover:text-gray-950 dark:text-gray-300 dark:hover:text-white"
          title="Back to process dashboard"
        >
          <ArrowLeft size={16} />
          <span className="shrink-0 underline-offset-4 hover:underline">Dashboard</span>
        </Link>
        <span className="min-w-0 truncate text-sm font-medium text-gray-900 dark:text-gray-100">/ {displayName(process.name)}</span>
        <div className="hidden lg:block">
          <BrandMark compact />
        </div>
      </div>
      <div className="flex items-center gap-2">
        {accessory ? <div className="mr-2">{accessory}</div> : null}
        <div className="text-right">
          <Button
            title={!activeFile ? 'Upload a file first' : selectedSheets === 0 ? 'Select at least one valid sheet' : ''}
            disabled={!canRun}
            onClick={onRunAudit}
            leading={isAuditRunning ? <Loader2 size={15} className="animate-spin" /> : <Play size={15} />}
          >
            {activeFile?.isAudited ? 'Re-run Audit' : 'Run Audit'}
          </Button>
          {activeFile?.lastAuditedAt ? <div className="mt-0.5 text-[11px] text-gray-500">Last run: {new Date(activeFile.lastAuditedAt).toLocaleString()}</div> : null}
        </div>
        <Button
          title={canSave ? '' : latestResult ? 'No new audit to save.' : 'Run an audit first to save a version.'}
          disabled={!canSave}
          onClick={() => setVersionModalOpen(true)}
          variant="secondary"
          leading={<Save size={15} />}
        >
          Save Version
        </Button>
        {correctionCount === 0 ? (
          <Button
            title={!hasSavedVersion ? 'Save a version first to download audited workbook.' : ''}
            disabled={!canDownload}
            onClick={onDownload}
            variant="secondary"
            leading={<ArrowDownToLine size={15} />}
          >
            Download
          </Button>
        ) : null}
        <Button
          title={!correctionCount ? 'Add inline corrections before downloading a corrected workbook.' : ''}
          disabled={!canDownload || correctionCount === 0}
          onClick={onDownloadCorrected}
          variant={correctionCount ? 'primary' : 'secondary'}
          leading={<ArrowDownToLine size={15} />}
        >
          Download Corrected
        </Button>
        {correctionCount ? (
          <button onClick={onDownload} disabled={!canDownload} className="rounded-lg border border-gray-300 px-3 py-2 text-sm hover:bg-gray-50 disabled:opacity-40 dark:border-gray-700 dark:hover:bg-gray-800">
            Original
          </button>
        ) : null}
        <button
          type="button"
          onClick={() => void signOutAndRedirect(navigate)}
          title="Sign out"
          className="ml-1 flex items-center gap-1 rounded-lg border border-gray-200 px-2 py-2 text-sm text-gray-500 hover:border-gray-300 hover:text-gray-700 dark:border-gray-700 dark:text-gray-400 dark:hover:border-gray-600 dark:hover:text-gray-200"
        >
          <LogOut size={14} />
        </button>
      </div>
      {versionModalOpen && process && latestResult ? <SaveVersionModal process={process} onClose={() => setVersionModalOpen(false)} /> : null}
    </header>
  );
}

function SaveVersionModal({ process, onClose }: { process: AuditProcess; onClose: () => void }) {
  const saveVersion = useAppStore((state) => state.saveVersion);
  const updateProcess = useAppStore((state) => state.updateProcess);
  const setWorkspaceTab = useAppStore((state) => state.setWorkspaceTab);
  const nextVersion = process.versions.length + 1;
  const [versionName, setVersionName] = useState(`${displayName(process.name)} - V${nextVersion}`);
  const [notes, setNotes] = useState('');

  function submit(event: FormEvent) {
    event.preventDefault();
    const updated = saveVersion(process.id, { versionName, notes });
    if (updated && isAuditDueSoon(updated)) {
      const nextDue = nextDueDateAfterSave(updated);
      if (window.confirm(`Schedule the next audit for ${new Date(`${nextDue}T00:00:00`).toLocaleDateString()}?`)) {
        void updateProcess(process.id, { nextAuditDue: nextDue }).catch(() => toast.error('Could not update next audit date'));
      }
    }
    toast.success(`${updated?.versions[0]?.versionName ?? versionName} saved`);
    setWorkspaceTab('notifications');
    onClose();
  }

  function close() {
    const changed = versionName !== `${displayName(process.name)} - V${nextVersion}` || notes.trim() !== '';
    if (changed && !window.confirm('Discard unsaved version details?')) return;
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <form onSubmit={submit} className="w-full max-w-lg rounded-xl border border-gray-200 bg-white p-5 shadow-xl dark:border-gray-700 dark:bg-gray-900">
        <h2 className="text-lg font-semibold">Save Version</h2>
        <p className="mt-1 text-sm text-gray-500">Name this audit snapshot so it is easier to compare across processes.</p>
        <label className="mt-5 block text-sm font-medium">Version name</label>
        <input value={versionName} onChange={(event) => setVersionName(event.target.value)} required className="mt-2 w-full rounded-lg border border-gray-300 px-3 py-2 dark:border-gray-700 dark:bg-gray-800" />
        <label className="mt-4 block text-sm font-medium">Notes</label>
        <textarea value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Optional audit context, workbook changes, or escalation notes" className="mt-2 h-24 w-full rounded-lg border border-gray-300 px-3 py-2 dark:border-gray-700 dark:bg-gray-800" />
        <div className="mt-5 rounded-lg bg-gray-50 p-3 text-xs text-gray-600 dark:bg-gray-800 dark:text-gray-300">
          Version ID will be {process.id}-v{nextVersion}.
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="secondary" onClick={close}>Cancel</Button>
          <Button type="submit">Save Version</Button>
        </div>
      </form>
    </div>
  );
}

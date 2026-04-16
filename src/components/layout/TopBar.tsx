import { ArrowDownToLine, ArrowLeft, Loader2, Play, Save } from 'lucide-react';
import { FormEvent, useState } from 'react';
import toast from 'react-hot-toast';
import { Link } from 'react-router-dom';
import { downloadAuditedWorkbook } from '../../lib/excelParser';
import { displayName } from '../../lib/storage';
import type { AuditProcess } from '../../lib/types';
import { useAppStore } from '../../store/useAppStore';
import { BrandMark } from '../shared/BrandMark';

export function TopBar({ process }: { process?: AuditProcess }) {
  const currentAuditResult = useAppStore((state) => state.currentAuditResult);
  const isAuditRunning = useAppStore((state) => state.isAuditRunning);
  const runAudit = useAppStore((state) => state.runAudit);
  const [versionModalOpen, setVersionModalOpen] = useState(false);
  const activeFile = process?.files.find((file) => file.id === process.activeFileId);
  const selectedSheets = activeFile?.sheets.filter((sheet) => sheet.status === 'valid' && sheet.isSelected).length ?? 0;
  const hasSavedVersion = (process?.versions.length ?? 0) > 0;
  const latestResult = currentAuditResult ?? process?.versions[0]?.result ?? null;
  const canRun = Boolean(process && activeFile && selectedSheets > 0 && !isAuditRunning);
  const canSave = Boolean(currentAuditResult && !isAuditRunning);
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

  if (!process) {
    return (
      <header className="flex h-[52px] items-center justify-between border-b border-gray-200 bg-white px-5 shadow-sm dark:border-gray-800 dark:bg-gray-950">
        <Link to="/" className="min-w-0">
          <BrandMark />
        </Link>
        <Link to="/compare" className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-800 hover:border-[#b00020] hover:text-[#b00020] dark:border-gray-700 dark:text-gray-100 dark:hover:bg-gray-900">Compare Processes</Link>
      </header>
    );
  }

  return (
    <header className="flex h-[52px] items-center justify-between gap-4 border-b border-gray-200 bg-white px-5 shadow-sm dark:border-gray-800 dark:bg-gray-950">
      <div className="flex min-w-0 items-center gap-5">
        <Link to="/" className="flex items-center gap-2 text-sm font-medium text-gray-700 hover:text-gray-950 dark:text-gray-300 dark:hover:text-white" title="Back to process dashboard">
          <ArrowLeft size={16} />
          <span className="shrink-0 underline-offset-4 hover:underline">Dashboard</span>
        </Link>
        <span className="min-w-0 truncate text-sm font-medium text-gray-900 dark:text-gray-100">/ {displayName(process.name)}</span>
        <div className="hidden lg:block">
          <BrandMark compact />
        </div>
      </div>
      <div className="flex items-center gap-2">
        <div className="text-right">
          <button
            title={!activeFile ? 'Upload a file first' : selectedSheets === 0 ? 'Select at least one valid sheet' : ''}
            disabled={!canRun}
            onClick={onRunAudit}
            className="inline-flex items-center gap-2 rounded-lg bg-[#b00020] px-4 py-2 text-sm font-medium text-white hover:bg-[#8f001a] disabled:cursor-not-allowed disabled:opacity-40"
          >
            {isAuditRunning ? <Loader2 size={15} className="animate-spin" /> : <Play size={15} />}
            {activeFile?.isAudited ? 'Re-run Audit' : 'Run Audit'}
          </button>
          {activeFile?.lastAuditedAt ? <div className="mt-0.5 text-[11px] text-gray-500">Last run: {new Date(activeFile.lastAuditedAt).toLocaleString()}</div> : null}
        </div>
        <button
          title={!currentAuditResult ? 'Run an audit first to save a version.' : ''}
          disabled={!canSave}
          onClick={() => setVersionModalOpen(true)}
          className="inline-flex items-center gap-2 rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium hover:border-[#b00020] hover:text-[#b00020] disabled:cursor-not-allowed disabled:opacity-40 dark:border-gray-700 dark:text-gray-100 dark:hover:bg-gray-900"
        >
          <Save size={15} />
          Save Version
        </button>
        <button
          title={!hasSavedVersion ? 'Save a version first to download audited workbook.' : ''}
          disabled={!canDownload}
          onClick={onDownload}
          className="inline-flex items-center gap-2 rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium hover:border-[#b00020] hover:text-[#b00020] disabled:cursor-not-allowed disabled:opacity-40 dark:border-gray-700 dark:text-gray-100 dark:hover:bg-gray-900"
        >
          <ArrowDownToLine size={15} />
          Download
        </button>
      </div>
      {versionModalOpen && process && currentAuditResult ? <SaveVersionModal process={process} onClose={() => setVersionModalOpen(false)} /> : null}
    </header>
  );
}

function SaveVersionModal({ process, onClose }: { process: AuditProcess; onClose: () => void }) {
  const saveVersion = useAppStore((state) => state.saveVersion);
  const nextVersion = process.versions.length + 1;
  const [versionName, setVersionName] = useState(`${displayName(process.name)} - V${nextVersion}`);
  const [notes, setNotes] = useState('');

  function submit(event: FormEvent) {
    event.preventDefault();
    const updated = saveVersion(process.id, { versionName, notes });
    toast.success(`${updated?.versions[0]?.versionName ?? versionName} saved`);
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
          <button type="button" onClick={onClose} className="rounded-lg border border-gray-300 px-4 py-2 text-sm hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800">Cancel</button>
          <button type="submit" className="rounded-lg bg-[#b00020] px-4 py-2 text-sm font-medium text-white hover:bg-[#8f001a]">Save Version</button>
        </div>
      </form>
    </div>
  );
}

import { AlertTriangle, ArrowDownToLine, ArrowLeft, LayoutGrid, Loader2, LogOut, Play, Save } from 'lucide-react';
import { FormEvent, useEffect, useState, type ReactNode } from 'react';
import toast from 'react-hot-toast';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useKeyboardShortcut } from '../../hooks/useKeyboardShortcut';
import { useCurrentUser } from '../auth/authContext';
import { downloadAuditedWorkbook } from '../../lib/excelParser';
import { escalationCenterPath, processDashboardPath } from '../../lib/processRoutes';
import { isAuditDueSoon, nextDueDateAfterSave } from '../../lib/scheduleHelpers';
import { displayName } from '../../lib/storage';
import type { AuditProcess } from '../../lib/types';
import { selectCorrectionCount, selectHasUnsavedAudit, selectLatestAuditResult } from '../../store/selectors';
import { useAppStore } from '../../store/useAppStore';
import { anchorResultForFile, formatDiffChips, summarizeDiff, suggestVersionName } from '../../lib/versionDiff';
import { BrandMark } from '../shared/BrandMark';
import { Button } from '../shared/Button';
import { SplitButton } from '../shared/SplitButton';
import { NotificationBell } from './NotificationBell';
import { RealtimeStatusPill } from './RealtimeStatusPill';

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
  const location = useLocation();
  const sessionUser = useCurrentUser();
  const currentAuditResult = useAppStore((state) => state.currentAuditResult);
  const isAuditRunning = useAppStore((state) => state.isAuditRunning);
  const runAudit = useAppStore((state) => state.runAudit);
  const saveOverCurrentVersion = useAppStore((state) => state.saveOverCurrentVersion);
  const saveAsNewRequestCount = useAppStore((state) => state.saveAsNewRequestCount);
  const [versionModalOpen, setVersionModalOpen] = useState(false);

  // The UnsavedAuditDialog lives in Workspace, but the Save-as-new modal
  // lives here. Bumping saveAsNewRequestCount from the store is how the
  // dialog tells us to open the modal without shared component refs. This
  // is an intentional cross-component signal — re-opening on every bump
  // is the whole point, so we can't replace it with derived state.
  useEffect(() => {
    if (saveAsNewRequestCount === 0 || !process) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- deliberate cross-component signal; see comment above
    setVersionModalOpen(true);
  }, [saveAsNewRequestCount, process]);
  const activeFile = process?.files.find((file) => file.id === process.activeFileId);
  const selectedSheets = activeFile?.sheets.filter((sheet) => sheet.status === 'valid' && sheet.isSelected).length ?? 0;
  const hasSavedVersion = (process?.versions.length ?? 0) > 0;
  const latestResult = currentAuditResult ?? (process ? selectLatestAuditResult(process) : null);
  const correctionCount = process ? selectCorrectionCount(process) : 0;
  const hasUnsavedAudit = process ? selectHasUnsavedAudit(process) : false;
  const canRun = Boolean(process && activeFile && selectedSheets > 0 && !isAuditRunning);
  // The split button stays interactive whenever a run exists — even if the
  // findings are identical to head. Primary action becomes a quiet no-op
  // (toast "already saved") and the dropdown still lets the user force a
  // new named checkpoint. canSave = "would this click do anything visible".
  const canSave = Boolean(process && latestResult && !isAuditRunning);
  const canDownload = Boolean(process && activeFile && latestResult && hasSavedVersion && !isAuditRunning);
  const headVersion = process?.versions[0];
  const headVersionName = headVersion?.versionName ?? '';
  const nextVersionNumber = (process?.versions.length ?? 0) + 1;

  async function onRunAudit() {
    if (!process || !activeFile || !canRun) return;
    // Capture the pre-run anchor for the same file — diff-aware toasts need
    // it before runAudit swaps latestAuditResult in the store.
    const priorAnchor = anchorResultForFile(process.versions, activeFile.id);
    await runAudit(process.id, activeFile.id);
    const result = useAppStore.getState().currentAuditResult;
    if (!result) return;
    const diff = summarizeDiff(priorAnchor, result);
    if (diff && !diff.identical) {
      const chips = formatDiffChips(diff);
      toast.success(`Audit complete - ${result.issues.length} findings (${chips})`);
    } else if (diff?.identical && priorAnchor) {
      toast.success(`Audit complete - no change from last run (${result.issues.length} findings)`);
    } else {
      toast.success(`Audit complete - ${result.scannedRows} rows scanned, ${result.issues.length} issues found`);
    }
  }

  function onQuickSave() {
    if (!process || !latestResult) return;
    // Fast path 1: no head version yet → silently write V1. Matches the
    // user's mental model of "save" as "persist my current findings".
    if (!headVersion) {
      const updated = saveOverCurrentVersion(process.id);
      if (updated) toast.success(`Saved as ${updated.versions[0]?.versionName ?? 'V1'}`);
      return;
    }
    // Fast path 2: findings identical to head → tell the user and bail out
    // rather than silently bumping updatedAt for no reason.
    const diff = summarizeDiff(headVersion.result, latestResult);
    if (diff?.identical) {
      toast(`No change since ${headVersionName}`, { icon: 'ℹ️' });
      return;
    }
    const updated = saveOverCurrentVersion(process.id);
    if (!updated) return;
    const chips = diff ? formatDiffChips(diff) : '';
    toast.success(chips ? `Saved to ${headVersionName} · ${chips}` : `Saved to ${headVersionName}`);
  }

  function onSaveAsNew() {
    setVersionModalOpen(true);
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
    const isAdmin = sessionUser?.role === 'admin';
    return (
      <header className="flex h-[52px] items-center justify-between gap-4 border-b border-gray-200 bg-white px-5 shadow-sm dark:border-gray-800 dark:bg-gray-950">
        <div className="flex min-w-0 items-center gap-5">
          <Link to="/" className="min-w-0">
            <BrandMark />
          </Link>
          <nav className="hidden items-center gap-1 md:flex" aria-label="Primary">
            <GlobalNavLink to="/" end label="Dashboard" />
            <GlobalNavLink to="/compare" label="Compare" />
            {isAdmin ? <GlobalNavLink to="/admin/directory" label="Directory" /> : null}
            {isAdmin ? <GlobalNavLink to="/admin/templates" label="Templates" /> : null}
          </nav>
        </div>
        <div className="flex items-center gap-2">
          <RealtimeStatusPill />
          <NotificationBell />
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

  const tilesPath = processDashboardPath(process.displayCode ?? process.id);
  const escalationsPath = escalationCenterPath(process.displayCode ?? process.id);
  const onTiles = location.pathname === tilesPath;
  const onEscalations = location.pathname === escalationsPath;

  function confirmLeave(event: React.MouseEvent<HTMLAnchorElement>) {
    if (!hasUnsavedAudit) return;
    event.preventDefault();
    const href = (event.currentTarget as HTMLAnchorElement).getAttribute('href') ?? '/';
    toast((t) => (
      <div className="flex items-center gap-3">
        <AlertTriangle size={16} className="shrink-0 text-amber-500" />
        <span className="text-sm">Leave without saving this audit as a version?</span>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => {
              toast.dismiss(t.id);
              void navigate(href);
            }}
            className="rounded-md bg-gray-900 px-2 py-1 text-xs font-medium text-white hover:bg-gray-800"
          >
            Leave
          </button>
          <button
            type="button"
            onClick={() => toast.dismiss(t.id)}
            className="rounded-md border border-gray-300 px-2 py-1 text-xs font-medium hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800"
          >
            Stay
          </button>
        </div>
      </div>
    ), { duration: 6000 });
  }

  return (
    <header className="flex h-[52px] items-center justify-between gap-4 border-b border-gray-200 bg-white px-5 shadow-sm dark:border-gray-800 dark:bg-gray-950">
      <div className="flex min-w-0 items-center gap-4">
        <Link
          to="/"
          onClick={confirmLeave}
          className="flex items-center gap-2 text-sm font-medium text-gray-700 hover:text-gray-950 dark:text-gray-300 dark:hover:text-white"
          title="Back to all processes"
        >
          <ArrowLeft size={16} />
          <span className="hidden shrink-0 underline-offset-4 hover:underline sm:inline">Processes</span>
        </Link>
        <span className="min-w-0 truncate text-sm font-medium text-gray-900 dark:text-gray-100">
          {displayName(process.name)}
        </span>
        <nav className="hidden items-center gap-1 lg:flex" aria-label="Process sections">
          <ProcessNavLink to={tilesPath} active={onTiles} onClick={confirmLeave} icon={<LayoutGrid size={13} />} label="Tiles" />
          <ProcessNavLink to={escalationsPath} active={onEscalations} onClick={confirmLeave} icon={<AlertTriangle size={13} />} label="Escalations" />
        </nav>
        <div className="hidden xl:block">
          <BrandMark compact />
        </div>
      </div>
      <div className="flex items-center gap-2">
        <RealtimeStatusPill />
        <NotificationBell />
        {sessionUser?.role === 'admin' ? (
          <Link
            to="/admin/directory"
            onClick={confirmLeave}
            className="hidden rounded-lg border border-gray-300 px-2 py-1.5 text-xs font-medium text-gray-800 hover:border-brand hover:text-brand dark:border-gray-700 dark:text-gray-100 md:inline-block"
          >
            Directory
          </Link>
        ) : null}
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
        <SplitButton
          variant="secondary"
          disabled={!canSave}
          leading={<Save size={15} />}
          primaryLabel={headVersion ? `Save to ${headVersionName}` : 'Save'}
          primaryTitle={
            !latestResult
              ? 'Run an audit first to save a version.'
              : headVersion
              ? `Update ${headVersionName} in place with the latest findings. Use the caret to create a new named version instead.`
              : 'Save the current audit findings as V1.'
          }
          menuTitle="Save options"
          onPrimary={onQuickSave}
          menu={[
            {
              label: 'Save as new version…',
              description: headVersion
                ? `Keeps ${headVersionName} as-is and creates V${nextVersionNumber} with a new name.`
                : `Name this save before writing V1.`,
              onClick: onSaveAsNew,
            },
          ]}
        />
        {hasUnsavedAudit ? (
          <span
            className="hidden items-center gap-1 text-[11px] font-medium text-amber-700 md:inline-flex"
            title="Latest audit run isn't reflected in any saved version"
          >
            <span className="h-1.5 w-1.5 rounded-full bg-amber-500" aria-hidden="true" />
            Unsaved
          </span>
        ) : null}
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

function GlobalNavLink({ to, label, end = false }: { to: string; label: string; end?: boolean }) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        `rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
          isActive
            ? 'bg-brand/10 text-brand dark:bg-brand/20'
            : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-300 dark:hover:bg-gray-800'
        }`
      }
    >
      {label}
    </NavLink>
  );
}

function ProcessNavLink({
  to,
  label,
  icon,
  active,
  onClick,
}: {
  to: string;
  label: string;
  icon: ReactNode;
  active: boolean;
  onClick: (event: React.MouseEvent<HTMLAnchorElement>) => void;
}) {
  return (
    <Link
      to={to}
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-medium transition-colors ${
        active
          ? 'bg-brand/10 text-brand dark:bg-brand/20'
          : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-300 dark:hover:bg-gray-800'
      }`}
    >
      {icon}
      {label}
    </Link>
  );
}

function SaveVersionModal({ process, onClose }: { process: AuditProcess; onClose: () => void }) {
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
      // Require a second click — the first Save press flips the guard,
      // the second actually writes the new version. Prevents accidental
      // "V2 identical to V1" proliferation after a no-op rerun.
      setConfirmedIdentical(true);
      return;
    }
    const updated = saveVersion(process.id, { versionName, notes });
    const savedName = updated?.versions[0]?.versionName ?? versionName;
    if (updated && isAuditDueSoon(updated)) {
      const nextDue = nextDueDateAfterSave(updated);
      // Auto-schedule the next audit and let the user undo. Previously we
      // blocked with window.confirm on every save — far more friction than
      // value, since almost everyone accepts the suggested date anyway.
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
    // Post-save, keep users on Audit Results. The old flow sent them to a
    // per-tile Notifications tab that no longer exists — notifications now
    // live in the Escalation Center, which has its own dedicated route.
    setWorkspaceTab('results');
    onClose();
  }

  function close() {
    // Silent close: modal details are low-effort to re-enter and the
    // window.confirm was surprising and blocked power-users who hit Esc.
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
              <span className="font-medium text-gray-700 dark:text-gray-200">
                Since {headVersion.versionName}
              </span>
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
          <Button variant="secondary" onClick={close}>
            Cancel
          </Button>
          <Button type="submit">
            {identicalGuardActive && confirmedIdentical
              ? `Save V${nextVersion} anyway`
              : 'Save Version'}
          </Button>
        </div>
      </form>
    </div>
  );
}

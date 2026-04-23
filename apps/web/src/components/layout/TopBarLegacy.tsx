import { AlertTriangle, ArrowDownToLine, ArrowLeft, LayoutGrid, Loader2, LogOut, Menu, Play, Save, X } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import toast from 'react-hot-toast';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useKeyboardShortcut } from '../../hooks/useKeyboardShortcut';
import { useCurrentUser } from '../auth/authContext';
import { downloadAuditedWorkbook } from '../../lib/excelParser';
import { escalationCenterPath, processDashboardPath } from '../../lib/processRoutes';
import { displayName } from '../../lib/storage';
import type { AuditProcess } from '../../lib/types';
import { selectCorrectionCount, selectHasUnsavedAudit, selectLatestAuditResult } from '../../store/selectors';
import { useAppStore } from '../../store/useAppStore';
import { anchorResultForFile, formatDiffChips, summarizeDiff } from '../../lib/versionDiff';
import { BrandMark } from '../shared/BrandMark';
import { Button } from '../shared/Button';
import { SplitButton } from '../shared/SplitButton';
import { SaveVersionModal } from '../workspace/SaveVersionModal';
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

export function TopBarLegacy({ process, accessory }: { process?: AuditProcess | undefined; accessory?: ReactNode }) {
  const navigate = useNavigate();
  const location = useLocation();
  const sessionUser = useCurrentUser();
  const currentAuditResult = useAppStore((state) => state.currentAuditResult);
  const isAuditRunning = useAppStore((state) => state.isAuditRunning);
  const runAudit = useAppStore((state) => state.runAudit);
  const saveOverCurrentVersion = useAppStore((state) => state.saveOverCurrentVersion);
  const saveAsNewRequestCount = useAppStore((state) => state.saveAsNewRequestCount);
  const [versionModalOpen, setVersionModalOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  useEffect(() => {
    if (saveAsNewRequestCount === 0 || !process) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- deliberate cross-component signal
    setVersionModalOpen(true);
  }, [saveAsNewRequestCount, process]);
  const activeFile = process?.files.find((file) => file.id === process.activeFileId);
  const selectedSheets = activeFile?.sheets.filter((sheet) => sheet.status === 'valid' && sheet.isSelected).length ?? 0;
  const hasSavedVersion = (process?.versions.length ?? 0) > 0;
  const latestResult = currentAuditResult ?? (process ? selectLatestAuditResult(process) : null);
  const correctionCount = process ? selectCorrectionCount(process) : 0;
  const hasUnsavedAudit = process ? selectHasUnsavedAudit(process) : false;
  const canRun = Boolean(process && activeFile && selectedSheets > 0 && !isAuditRunning);
  const canSave = Boolean(process && latestResult && !isAuditRunning);
  const canDownload = Boolean(process && activeFile && latestResult && hasSavedVersion && !isAuditRunning);
  const headVersion = process?.versions[0];
  const headVersionName = headVersion?.versionName ?? '';
  const nextVersionNumber = (process?.versions.length ?? 0) + 1;

  async function onRunAudit() {
    if (!process || !activeFile || !canRun) return;
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
    if (!headVersion) {
      const updated = saveOverCurrentVersion(process.id);
      if (updated) toast.success(`Saved as ${updated.versions[0]?.versionName ?? 'V1'}`);
      return;
    }
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
      <header className="relative flex min-h-[52px] flex-wrap items-center justify-between gap-3 border-b border-gray-200 bg-white px-4 py-2 shadow-sm sm:px-5 dark:border-gray-800 dark:bg-gray-950">
        <div className="flex min-w-0 items-center gap-3 sm:gap-5">
          <button
            type="button"
            className="rounded-md p-1.5 text-gray-600 hover:bg-gray-100 md:hidden dark:text-gray-300 dark:hover:bg-gray-800"
            aria-label={mobileMenuOpen ? 'Close navigation' : 'Open navigation'}
            aria-expanded={mobileMenuOpen}
            onClick={() => setMobileMenuOpen((v) => !v)}
          >
            {mobileMenuOpen ? <X size={18} /> : <Menu size={18} />}
          </button>
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
            className="flex items-center gap-1 rounded-lg border border-gray-200 px-2 py-2 text-sm text-gray-700 hover:border-gray-300 sm:px-3 dark:border-gray-700 dark:text-gray-300 dark:hover:border-gray-600"
          >
            <LogOut size={14} />
            <span className="hidden sm:inline">Sign out</span>
          </button>
        </div>
        {mobileMenuOpen ? (
          <nav
            className="flex w-full basis-full flex-col gap-1 border-t border-gray-100 pt-2 md:hidden dark:border-gray-800"
            aria-label="Primary mobile"
            onClick={() => setMobileMenuOpen(false)}
          >
            <GlobalNavLink to="/" end label="Dashboard" />
            <GlobalNavLink to="/compare" label="Compare" />
            {isAdmin ? <GlobalNavLink to="/admin/directory" label="Directory" /> : null}
            {isAdmin ? <GlobalNavLink to="/admin/templates" label="Templates" /> : null}
          </nav>
        ) : null}
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
    <header className="relative flex min-h-[52px] flex-wrap items-center justify-between gap-3 border-b border-gray-200 bg-white px-4 py-2 shadow-sm sm:px-5 dark:border-gray-800 dark:bg-gray-950">
      <div className="flex min-w-0 flex-1 items-center gap-3 sm:gap-4">
        <button
          type="button"
          className="rounded-md p-1.5 text-gray-600 hover:bg-gray-100 lg:hidden dark:text-gray-300 dark:hover:bg-gray-800"
          aria-label={mobileMenuOpen ? 'Close sections menu' : 'Open sections menu'}
          aria-expanded={mobileMenuOpen}
          onClick={() => setMobileMenuOpen((v) => !v)}
        >
          {mobileMenuOpen ? <X size={18} /> : <Menu size={18} />}
        </button>
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
      <div className="flex flex-wrap items-center justify-end gap-2">
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
          {activeFile?.lastAuditedAt ? <div className="mt-0.5 hidden text-xs text-gray-500 md:block">Last run: {new Date(activeFile.lastAuditedAt).toLocaleString()}</div> : null}
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
      {mobileMenuOpen ? (
        <nav
          className="flex w-full basis-full flex-col gap-1 border-t border-gray-100 pt-2 lg:hidden dark:border-gray-800"
          aria-label="Process sections mobile"
          onClick={() => setMobileMenuOpen(false)}
        >
          <ProcessNavLink to={tilesPath} active={onTiles} onClick={confirmLeave} icon={<LayoutGrid size={13} />} label="Tiles" />
          <ProcessNavLink to={escalationsPath} active={onEscalations} onClick={confirmLeave} icon={<AlertTriangle size={13} />} label="Escalations" />
          {sessionUser?.role === 'admin' ? (
            <Link
              to="/admin/directory"
              onClick={confirmLeave}
              className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-800"
            >
              Directory
            </Link>
          ) : null}
          {activeFile?.lastAuditedAt ? (
            <div className="px-2.5 text-[11px] text-gray-500">
              Last run: {new Date(activeFile.lastAuditedAt).toLocaleString()}
            </div>
          ) : null}
        </nav>
      ) : null}
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

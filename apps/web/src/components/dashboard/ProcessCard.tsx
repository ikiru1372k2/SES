import { ChevronRight, Edit2, GitCompare, MoreHorizontal, Share2, Trash2, X } from 'lucide-react';
import { FormEvent, KeyboardEvent, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import toast from 'react-hot-toast';
import { Link } from 'react-router-dom';
import { daysUntilDue } from '../../lib/domain/scheduleHelpers';
import { displayName } from '../../lib/storage/storage';
import type { AuditProcess } from '../../lib/domain/types';
import { selectHasUnsavedAudit, selectLatestAuditResult } from '../../store/selectors';
import { processDashboardPath } from '../../lib/processRoutes';
import { useAppStore } from '../../store/useAppStore';
import { useEffectiveAccess } from '../../hooks/useEffectiveAccess';
import { useCurrentUser } from '../auth/authContext';
import { Button } from '../shared/Button';
import { MembersPanel } from '../workspace/MembersPanel';

function severityCounts(process: AuditProcess) {
  const latest = selectLatestAuditResult(process);
  return {
    High: latest?.issues.filter((issue) => issue.severity === 'High').length ?? 0,
    Medium: latest?.issues.filter((issue) => issue.severity === 'Medium').length ?? 0,
    Low: latest?.issues.filter((issue) => issue.severity === 'Low').length ?? 0,
  };
}

function dueChip(process: AuditProcess): { label: string; className: string } {
  if (!process.nextAuditDue) {
    return {
      label: 'completed',
      className: 'border-rule bg-surface-app text-ink-3 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400',
    };
  }
  const days = daysUntilDue(process.nextAuditDue);
  if (days < 0) {
    return {
      label: `overdue ${Math.abs(days)}d`,
      className: 'border-danger-200 bg-danger-50 text-danger-800 dark:border-red-900 dark:bg-red-950/50 dark:text-red-200',
    };
  }
  if (days === 0) {
    return {
      label: 'due today',
      className: 'border-warning-200 bg-warning-50 text-warning-800 dark:border-amber-900 dark:bg-amber-950/50 dark:text-amber-200',
    };
  }
  return {
    label: `in ${days} day${days === 1 ? '' : 's'}`,
    className: 'border-success-200 bg-success-50 text-success-800 dark:border-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-200',
  };
}

export function ProcessCard({ process }: { process: AuditProcess }) {
  const deleteProcess = useAppStore((state) => state.deleteProcess);
  const updateProcess = useAppStore((state) => state.updateProcess);
  const currentUser = useCurrentUser();
  const [menuOpen, setMenuOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [membersOpen, setMembersOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuPanelRef = useRef<HTMLDivElement>(null);
  const [menuPos, setMenuPos] = useState<{ top: number; right: number }>({ top: 0, right: 0 });
  const accessGate = useEffectiveAccess(process.serverBacked ? process.displayCode ?? process.id : null);
  const canManageMembers = process.serverBacked ? accessGate.isOwner : false;
  const latest = selectLatestAuditResult(process);
  const counts = severityCounts(process);
  const openCount = latest?.issues.length ?? 0;
  const highCount = counts.High;
  const unsaved = selectHasUnsavedAudit(process);
  const chip = dueChip(process);
  const processCode = process.displayCode ?? process.id;
  const fileCount = process.files.length || (process.serverFilesCount ?? 0);
  const description =
    process.description?.trim() ||
    `${fileCount} file${fileCount === 1 ? '' : 's'} · ${latest ? 'audited' : 'not audited yet'}`;

  useLayoutEffect(() => {
    if (!menuOpen) return;
    const rect = triggerRef.current?.getBoundingClientRect();
    if (rect) {
      setMenuPos({ top: rect.bottom + 4, right: window.innerWidth - rect.right });
    }
  }, [menuOpen]);

  useEffect(() => {
    if (!menuOpen) return;
    function onDoc(ev: MouseEvent) {
      const target = ev.target as Node;
      if (menuRef.current?.contains(target) || menuPanelRef.current?.contains(target)) return;
      setMenuOpen(false);
    }
    function onDismiss() {
      setMenuOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    window.addEventListener('resize', onDismiss);
    window.addEventListener('scroll', onDismiss, true);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      window.removeEventListener('resize', onDismiss);
      window.removeEventListener('scroll', onDismiss, true);
    };
  }, [menuOpen]);

  async function runDelete() {
    try {
      await deleteProcess(process.id);
      toast.success('Process deleted');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not delete process');
    }
  }

  function confirmDelete() {
    setMenuOpen(false);
    const scope = process.serverBacked ? 'the server (for everyone with access)' : 'this browser';
    toast(
      (t) => (
        <div className="flex flex-col gap-2">
          <div className="text-sm">
            Delete <strong>{displayName(process.name)}</strong>? Removes files, versions, and tracking from {scope}.
          </div>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => toast.dismiss(t.id)}
              className="rounded-md border border-gray-300 px-2 py-1 text-xs font-medium hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => {
                toast.dismiss(t.id);
                void runDelete();
              }}
              className="rounded-md bg-red-600 px-2 py-1 text-xs font-medium text-white hover:bg-red-700"
            >
              Delete
            </button>
          </div>
        </div>
      ),
      { duration: 8000 },
    );
  }

  return (
    <article className="group relative flex flex-col overflow-hidden rounded-xl border border-rule bg-white p-4 shadow-soft ring-1 ring-black/[0.02] transition-all duration-200 hover:border-brand/30 hover:shadow-soft-md dark:border-gray-800 dark:bg-gray-900 dark:ring-white/[0.03] sm:p-[18px]">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1 pr-1">
          <InlineEditName
            value={process.name}
            onSave={async (next) => {
              const trimmed = next.trim();
              if (!trimmed || trimmed === process.name) return;
              try {
                await updateProcess(process.id, { name: trimmed });
                toast.success('Renamed');
              } catch (err) {
                toast.error(err instanceof Error ? err.message : 'Could not rename process');
                throw err;
              }
            }}
          />
          <p className="mt-1 font-mono text-[11px] text-ink-3">{processCode}</p>
        </div>
        <div className="flex shrink-0 items-start gap-1">
          <span
            className={`inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold ${chip.className}`}
          >
            {chip.label}
          </span>
          {process.serverBacked ? (
            <button
              type="button"
              title="Share process"
              aria-label="Share process"
              onClick={() => setMembersOpen(true)}
              className="rounded-lg p-1 text-ink-3 opacity-0 transition-opacity hover:bg-gray-100 group-hover:opacity-100 focus:opacity-100 dark:hover:bg-gray-800"
            >
              <Share2 size={16} />
            </button>
          ) : null}
          <div className="relative" ref={menuRef}>
            <button
              ref={triggerRef}
              type="button"
              title="Process actions"
              aria-label="Process actions"
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen((open) => !open)}
              className="rounded-lg p-1 text-ink-3 hover:bg-gray-100 dark:hover:bg-gray-800"
            >
              <MoreHorizontal size={18} />
            </button>
            {menuOpen
              ? createPortal(
              <div
                ref={menuPanelRef}
                style={{ position: 'fixed', top: menuPos.top, right: menuPos.right }}
                className="z-50 w-44 rounded-xl border border-rule bg-white p-1 text-sm shadow-soft-lg dark:border-gray-800 dark:bg-gray-900"
              >
                <Link
                  to="/compare"
                  onClick={() => setMenuOpen(false)}
                  className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-ink-2 hover:bg-gray-50 dark:text-gray-200 dark:hover:bg-gray-800"
                >
                  <GitCompare size={14} />
                  Compare
                </Link>
                <button
                  type="button"
                  onClick={() => {
                    setEditOpen(true);
                    setMenuOpen(false);
                  }}
                  className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left hover:bg-gray-50 dark:hover:bg-gray-800"
                >
                  <Edit2 size={14} />
                  Edit process
                </button>
                <button
                  type="button"
                  onClick={confirmDelete}
                  className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-brand hover:bg-red-50 dark:hover:bg-red-950/30"
                >
                  <Trash2 size={14} />
                  Delete process
                </button>
              </div>,
                  document.body,
                )
              : null}
          </div>
        </div>
      </div>

      <p className="mt-2.5 line-clamp-2 text-[12.5px] leading-snug text-ink-2 dark:text-gray-400">{description}</p>
      {unsaved ? (
        <p className="mt-1.5 text-[11px] font-medium text-warning-700 dark:text-amber-300">Unsaved audit run</p>
      ) : null}

      <div className="mt-auto flex items-center justify-between gap-3 rounded-lg border border-rule-2 bg-surface-app/60 px-2.5 py-2 dark:border-gray-800 dark:bg-gray-800/40">
        <div className="flex flex-wrap items-center gap-3 text-xs text-ink-2 dark:text-gray-400">
          <span>
            <span className="font-semibold tabular-nums text-ink dark:text-gray-200">{openCount}</span> open
          </span>
          {highCount > 0 ? (
            <span>
              <span className="font-semibold tabular-nums text-danger-700 dark:text-red-300">{highCount}</span> high
            </span>
          ) : null}
        </div>
        <Link
          to={processDashboardPath(process.id)}
          className="inline-flex shrink-0 items-center gap-0.5 text-xs font-semibold text-brand hover:text-brand-hover"
        >
          Open <ChevronRight size={13} aria-hidden />
        </Link>
      </div>

      {editOpen ? <EditProcessModal process={process} onClose={() => setEditOpen(false)} /> : null}
      {membersOpen && process.serverBacked ? (
        <MembersPanel
          processIdOrCode={process.displayCode ?? process.id}
          currentUserCode={currentUser?.displayCode}
          canManage={canManageMembers}
          onClose={() => setMembersOpen(false)}
        />
      ) : null}
    </article>
  );
}

function EditProcessModal({ process, onClose }: { process: AuditProcess; onClose: () => void }) {
  const updateProcess = useAppStore((state) => state.updateProcess);
  const [name, setName] = useState(process.name);
  const [description, setDescription] = useState(process.description);
  const [nextAuditDue, setNextAuditDue] = useState(process.nextAuditDue ?? '');
  const [saving, setSaving] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!name.trim() || saving) return;
    setSaving(true);
    try {
      await updateProcess(process.id, { name: name.trim(), description: description.trim(), nextAuditDue: nextAuditDue || null });
      toast.success('Process updated');
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not update process');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
      <form
        onSubmit={submit}
        className="w-full max-w-lg rounded-xl border border-gray-200 bg-white p-5 shadow-soft-lg dark:border-gray-800 dark:bg-gray-900"
      >
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Edit Process</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close edit process dialog"
            className="rounded-lg p-1 hover:bg-gray-100 dark:hover:bg-gray-800"
          >
            <X size={18} />
          </button>
        </div>
        <label className="mt-5 block text-sm font-medium">Process Name</label>
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          required
          className="mt-2 w-full rounded-lg border border-gray-300 px-3 py-2 outline-none transition-all ease-soft focus:border-brand focus:ring-2 focus:ring-brand/20 dark:border-gray-700 dark:bg-gray-800"
        />
        <label className="mt-4 block text-sm font-medium">Description</label>
        <textarea
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          className="mt-2 h-24 w-full rounded-lg border border-gray-300 px-3 py-2 outline-none transition-all ease-soft focus:border-brand focus:ring-2 focus:ring-brand/20 dark:border-gray-700 dark:bg-gray-800"
        />
        <label className="mt-4 block text-sm font-medium">Next audit due</label>
        <input
          type="date"
          value={nextAuditDue}
          onChange={(event) => setNextAuditDue(event.target.value)}
          className="mt-2 w-full rounded-lg border border-gray-300 px-3 py-2 outline-none transition-all ease-soft focus:border-brand focus:ring-2 focus:ring-brand/20 dark:border-gray-700 dark:bg-gray-800"
        />
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={saving}>
            {saving ? 'Saving…' : 'Save Changes'}
          </Button>
        </div>
      </form>
    </div>
  );
}

function InlineEditName({
  value,
  onSave,
}: {
  value: string;
  onSave: (next: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!editing) setDraft(value);
  }, [editing, value]);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  async function commit() {
    const next = draft.trim();
    if (!next || next === value) {
      setEditing(false);
      setDraft(value);
      return;
    }
    setSaving(true);
    try {
      await onSave(next);
      setEditing(false);
    } catch {
      setDraft(value);
    } finally {
      setSaving(false);
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter') {
      event.preventDefault();
      void commit();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      setDraft(value);
      setEditing(false);
    }
  }

  if (editing) {
    return (
      <input
        ref={inputRef}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={onKeyDown}
        onBlur={() => void commit()}
        disabled={saving}
        aria-label="Process name"
        className="w-full rounded-md border border-brand/40 bg-white px-2 py-0.5 text-sm font-bold text-ink outline-none focus:border-brand focus:ring-1 focus:ring-brand dark:bg-gray-900 dark:text-white"
      />
    );
  }

  return (
    <button
      type="button"
      onClick={() => setEditing(true)}
      title="Click to rename"
      className="group/name -mx-1 inline-flex max-w-full items-center gap-1 truncate rounded-md px-1 py-0.5 text-left text-sm font-bold leading-snug text-ink hover:bg-gray-100 dark:text-white dark:hover:bg-gray-800 sm:text-[14.5px]"
    >
      <span className="truncate">{displayName(value)}</span>
      <Edit2
        size={12}
        className="shrink-0 text-gray-400 opacity-0 transition-opacity group-hover/name:opacity-100"
        aria-hidden="true"
      />
    </button>
  );
}

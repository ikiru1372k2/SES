import { Edit2, MoreHorizontal, Trash2, X } from 'lucide-react';
import { FormEvent, useState } from 'react';
import toast from 'react-hot-toast';
import { Link } from 'react-router-dom';
import { displayName } from '../../lib/storage';
import type { AuditProcess } from '../../lib/types';
import { useAppStore } from '../../store/useAppStore';
import { Button } from '../shared/Button';

function severityCounts(process: AuditProcess) {
  const latest = process.latestAuditResult ?? process.versions[0]?.result;
  return {
    High: latest?.issues.filter((issue) => issue.severity === 'High').length ?? 0,
    Medium: latest?.issues.filter((issue) => issue.severity === 'Medium').length ?? 0,
    Low: latest?.issues.filter((issue) => issue.severity === 'Low').length ?? 0,
  };
}

export function ProcessCard({ process }: { process: AuditProcess }) {
  const deleteProcess = useAppStore((state) => state.deleteProcess);
  const [menuOpen, setMenuOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const latest = process.latestAuditResult ?? process.versions[0]?.result;
  const counts = severityCounts(process);
  const total = Math.max(1, counts.High + counts.Medium + counts.Low);

  function confirmDelete() {
    const ok = window.confirm(`Delete "${displayName(process.name)}"? This removes its files, versions, and tracking data from this browser.`);
    if (!ok) return;
    deleteProcess(process.id);
    toast.success('Process deleted');
  }

  return (
    <article className="relative rounded-xl border border-gray-200 bg-white p-5 shadow-sm transition hover:border-brand/40 hover:shadow-md dark:border-gray-700 dark:bg-gray-900">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="font-semibold text-gray-950 dark:text-white">{displayName(process.name)}</h2>
          <p className="mt-1 line-clamp-2 text-sm text-gray-500 dark:text-gray-400">{process.description || 'Workbook audit process'}</p>
        </div>
        <div className="relative">
          <button title="Process actions" onClick={() => setMenuOpen((open) => !open)} className="rounded-lg p-1 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800"><MoreHorizontal size={18} /></button>
          {menuOpen ? (
            <div className="absolute right-0 top-8 z-10 w-44 rounded-lg border border-gray-200 bg-white p-1 text-sm shadow-lg dark:border-gray-700 dark:bg-gray-900">
              <button onClick={() => { setEditOpen(true); setMenuOpen(false); }} className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left hover:bg-gray-50 dark:hover:bg-gray-800">
                <Edit2 size={14} />
                Edit process
              </button>
              <button onClick={confirmDelete} className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-brand hover:bg-red-50 dark:hover:bg-red-950/30">
                <Trash2 size={14} />
                Delete process
              </button>
            </div>
          ) : null}
        </div>
      </div>
      <div className="mt-5 text-sm text-gray-600 dark:text-gray-300">{process.files.length} files - {process.versions.length} versions</div>
      <div className="mt-1 text-sm text-gray-500">Last audit: {latest ? new Date(latest.runAt).toLocaleDateString() : 'Not audited'}</div>
      <div className="mt-5 grid grid-cols-3 gap-3 text-sm">
        <div><div className="text-gray-500">Files</div><div className="text-xl font-bold">{process.files.length}</div></div>
        <div><div className="text-gray-500">Flagged</div><div className="text-xl font-bold">{latest?.flaggedRows ?? 0}</div></div>
        <div><div className="text-gray-500">Issues</div><div className="text-xl font-bold">{latest?.issues.length ?? 0}</div></div>
      </div>
      <div className="mt-4 flex h-2 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-700">
        <div className="bg-brand" style={{ width: `${(counts.High / total) * 100}%` }} />
        <div className="bg-amber-500" style={{ width: `${(counts.Medium / total) * 100}%` }} />
        <div className="bg-blue-500" style={{ width: `${(counts.Low / total) * 100}%` }} />
      </div>
      <div className="mt-2 text-xs text-gray-500">High {counts.High} - Med {counts.Medium} - Low {counts.Low}</div>
      <div className="mt-5 flex gap-2">
        <Link to={`/workspace/${process.id}`} className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-hover">Open Workspace</Link>
        <Link to="/compare" className="rounded-lg border border-gray-300 px-4 py-2 text-sm hover:border-brand hover:text-brand dark:border-gray-700 dark:hover:bg-gray-800">Compare</Link>
      </div>
      {editOpen ? <EditProcessModal process={process} onClose={() => setEditOpen(false)} /> : null}
    </article>
  );
}

function EditProcessModal({ process, onClose }: { process: AuditProcess; onClose: () => void }) {
  const updateProcess = useAppStore((state) => state.updateProcess);
  const [name, setName] = useState(process.name);
  const [description, setDescription] = useState(process.description);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!name.trim()) return;
    updateProcess(process.id, { name: name.trim(), description: description.trim() });
    toast.success('Process updated');
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <form onSubmit={submit} className="w-full max-w-lg rounded-xl border border-gray-200 bg-white p-5 shadow-xl dark:border-gray-700 dark:bg-gray-900">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Edit Process</h2>
          <button type="button" onClick={onClose} className="rounded-lg p-1 hover:bg-gray-100 dark:hover:bg-gray-800"><X size={18} /></button>
        </div>
        <label className="mt-5 block text-sm font-medium">Process Name</label>
        <input value={name} onChange={(event) => setName(event.target.value)} required className="mt-2 w-full rounded-lg border border-gray-300 px-3 py-2 dark:border-gray-700 dark:bg-gray-800" />
        <label className="mt-4 block text-sm font-medium">Description</label>
        <textarea value={description} onChange={(event) => setDescription(event.target.value)} className="mt-2 h-24 w-full rounded-lg border border-gray-300 px-3 py-2 dark:border-gray-700 dark:bg-gray-800" />
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit">Save Changes</Button>
        </div>
      </form>
    </div>
  );
}

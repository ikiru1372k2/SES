import { FormEvent, useState } from 'react';
import { X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { useAppStore } from '../../store/useAppStore';
import { Button } from '../shared/Button';

export function CreateProcessModal({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const createProcess = useAppStore((state) => state.createProcess);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!name.trim() || saving) return;
    setSaving(true);
    try {
      const process = await createProcess(name, description);
      toast.success('Process created');
      onClose();
      // Tile dashboard is the landing page after create — user picks a
      // function audit before entering a workspace (issue #62).
      void navigate(`/processes/${process.id}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not create process');
    } finally {
      setSaving(false);
    }
  }

  function close() {
    if ((name.trim() || description.trim()) && !window.confirm('Discard unsaved changes?')) return;
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <form onSubmit={submit} className="w-full max-w-lg rounded-xl border border-gray-200 bg-white p-5 shadow-xl dark:border-gray-700 dark:bg-gray-900">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Create Process</h2>
          <button type="button" onClick={close} className="rounded-lg p-1 hover:bg-gray-100 dark:hover:bg-gray-800"><X size={18} /></button>
        </div>
        <label className="mt-5 block text-sm font-medium">Process Name</label>
        <input value={name} onChange={(event) => setName(event.target.value)} required placeholder="e.g. May 2026 Audit" className="mt-2 w-full rounded-lg border border-gray-300 px-3 py-2 dark:border-gray-700 dark:bg-gray-800" />
        <label className="mt-4 block text-sm font-medium">Description</label>
        <textarea value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Optional context for this audit cycle" className="mt-2 h-24 w-full rounded-lg border border-gray-300 px-3 py-2 dark:border-gray-700 dark:bg-gray-800" />
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="secondary" onClick={close}>Cancel</Button>
          <Button type="submit" disabled={saving}>{saving ? 'Creating…' : 'Create Process'}</Button>
        </div>
      </form>
    </div>
  );
}

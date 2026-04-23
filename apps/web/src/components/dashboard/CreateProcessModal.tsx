import { FormEvent, useMemo, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { processDashboardPath } from '../../lib/processRoutes';
import { useAppStore } from '../../store/useAppStore';
import { Button } from '../shared/Button';

type FieldErrors = { name?: string };

export function CreateProcessModal({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const createProcess = useAppStore((state) => state.createProcess);
  const processes = useAppStore((state) => state.processes);
  const existingNames = useMemo(
    () => new Set(processes.map((process) => process.name.trim().toLowerCase())),
    [processes],
  );
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [saving, setSaving] = useState(false);
  const nameRef = useRef<HTMLInputElement | null>(null);

  function validateName(value: string): string | undefined {
    const trimmed = value.trim();
    if (!trimmed) return 'Name is required.';
    if (trimmed.length < 2) return 'Name must be at least 2 characters.';
    if (trimmed.length > 80) return 'Name must be 80 characters or fewer.';
    if (existingNames.has(trimmed.toLowerCase())) return 'A process with this name already exists.';
    return undefined;
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (saving) return;
    const nameError = validateName(name);
    if (nameError) {
      setErrors({ name: nameError });
      nameRef.current?.focus();
      return;
    }
    setSaving(true);
    try {
      const process = await createProcess(name, description);
      toast.success('Process created');
      onClose();
      void navigate(processDashboardPath(process.id));
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not create process';
      setErrors({ name: message });
      toast.error(message);
    } finally {
      setSaving(false);
    }
  }

  function close() {
    // Silent close — modal is lightweight and re-opening preserves nothing
    // irreplaceable. The confirm dialog was noisy for the common "escape
    // out" flow after glancing at the form.
    onClose();
  }

  const nameError = errors.name;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <form
        onSubmit={submit}
        className="w-full max-w-lg rounded-xl border border-gray-200 bg-white p-5 shadow-xl dark:border-gray-700 dark:bg-gray-900"
      >
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Create Process</h2>
          <button
            type="button"
            onClick={close}
            aria-label="Close create process dialog"
            className="rounded-lg p-1 hover:bg-gray-100 dark:hover:bg-gray-800"
          >
            <X size={18} />
          </button>
        </div>
        <label htmlFor="create-process-name" className="mt-5 block text-sm font-medium">
          Process Name
        </label>
        <input
          id="create-process-name"
          ref={nameRef}
          value={name}
          onChange={(event) => {
            setName(event.target.value);
            if (errors.name) {
              setErrors((prev) => {
                const next = { ...prev };
                delete next.name;
                return next;
              });
            }
          }}
          onBlur={() => {
            const err = validateName(name);
            setErrors((prev) => {
              const next = { ...prev };
              if (err) next.name = err;
              else delete next.name;
              return next;
            });
          }}
          required
          autoFocus
          placeholder="e.g. May 2026 Audit"
          aria-invalid={Boolean(nameError) || undefined}
          aria-describedby={nameError ? 'create-process-name-error' : undefined}
          className={`mt-2 w-full rounded-lg border px-3 py-2 dark:bg-gray-800 ${
            nameError
              ? 'border-red-400 focus:border-red-500 focus:outline-none focus:ring-1 focus:ring-red-500 dark:border-red-500/60'
              : 'border-gray-300 dark:border-gray-700'
          }`}
        />
        {nameError ? (
          <p id="create-process-name-error" className="mt-1 text-xs text-red-600 dark:text-red-400">
            {nameError}
          </p>
        ) : (
          <p className="mt-1 text-xs text-gray-500">
            A short, memorable name. You can rename it later.
          </p>
        )}
        <label htmlFor="create-process-description" className="mt-4 block text-sm font-medium">
          Description
        </label>
        <textarea
          id="create-process-description"
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          placeholder="Optional context for this audit cycle"
          className="mt-2 h-24 w-full rounded-lg border border-gray-300 px-3 py-2 dark:border-gray-700 dark:bg-gray-800"
        />
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="secondary" onClick={close}>
            Cancel
          </Button>
          <Button type="submit" disabled={saving}>
            {saving ? 'Creating…' : 'Create Process'}
          </Button>
        </div>
      </form>
    </div>
  );
}

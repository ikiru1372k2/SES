import { useState, type FormEvent } from 'react';
import toast from 'react-hot-toast';
import { X } from 'lucide-react';
import { requestFunctionAudit } from '../../lib/api/tilesApi';

interface Props {
  processIdOrCode: string;
  onClose: () => void;
}

export function RequestFunctionAuditModal({ processIdOrCode, onClose }: Props) {
  const [proposedName, setProposedName] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!proposedName.trim() || !contactEmail.trim()) return;
    setSubmitting(true);
    try {
      const payload: { proposedName: string; contactEmail: string; description?: string } = {
        proposedName: proposedName.trim(),
        contactEmail: contactEmail.trim(),
      };
      const desc = description.trim();
      if (desc) payload.description = desc;
      const res = await requestFunctionAudit(processIdOrCode, payload);
      toast.success(`Request filed (${res.displayCode}). The team will be in touch.`);
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Request failed');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <form
        onSubmit={onSubmit}
        onClick={(event) => event.stopPropagation()}
        className="w-full max-w-md rounded-xl bg-white p-5 shadow-xl dark:bg-gray-900"
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Request new function audit</h2>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="rounded p-1 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800"
          >
            <X size={16} />
          </button>
        </div>
        <p className="mb-4 text-xs text-gray-500 dark:text-gray-400">
          Tell us which analysis surface you need. A helpdesk ticket is opened and the platform team
          will follow up.
        </p>
        <label className="mb-3 block text-sm">
          <span className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">
            Proposed name
          </span>
          <input
            type="text"
            required
            maxLength={200}
            value={proposedName}
            onChange={(event) => setProposedName(event.target.value)}
            className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-brand focus:outline-none dark:border-gray-700 dark:bg-gray-800"
          />
        </label>
        <label className="mb-3 block text-sm">
          <span className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">
            Contact email
          </span>
          <input
            type="email"
            required
            maxLength={320}
            value={contactEmail}
            onChange={(event) => setContactEmail(event.target.value)}
            className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-brand focus:outline-none dark:border-gray-700 dark:bg-gray-800"
          />
        </label>
        <label className="mb-5 block text-sm">
          <span className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">
            Description
          </span>
          <textarea
            rows={3}
            maxLength={4_000}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-brand focus:outline-none dark:border-gray-700 dark:bg-gray-800"
          />
        </label>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="rounded-md border border-gray-300 px-3 py-1.5 text-sm disabled:opacity-50 dark:border-gray-700"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={submitting}
            className="rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-hover disabled:opacity-50"
          >
            {submitting ? 'Submitting…' : 'Submit request'}
          </button>
        </div>
      </form>
    </div>
  );
}

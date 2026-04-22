import { useState } from 'react';
import type { DirectoryRowInput } from '@ses/domain';
import toast from 'react-hot-toast';
import { directoryCommit, directoryUploadPreview } from '../../lib/api/directoryApi';
import { PasteFromExcel } from './PasteFromExcel';

type Step = 0 | 1;

export function DirectoryUploadWizard({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [step, setStep] = useState<Step>(0);
  const [rows, setRows] = useState<DirectoryRowInput[]>([]);
  const [preview, setPreview] = useState<Awaited<ReturnType<typeof directoryUploadPreview>> | null>(null);
  const [strategy, setStrategy] = useState<'skip_duplicates' | 'update_existing'>('skip_duplicates');
  const [busy, setBusy] = useState(false);

  async function runPreview(next: DirectoryRowInput[]) {
    setRows(next);
    setBusy(true);
    try {
      const p = await directoryUploadPreview(next);
      setPreview(p);
      setStep(1);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Preview failed');
    } finally {
      setBusy(false);
    }
  }

  async function commit() {
    setBusy(true);
    try {
      const r = await directoryCommit(rows, strategy);
      toast.success(`Committed: ${r.created.length} created, ${r.updated.length} updated, ${r.skipped.length} skipped`);
      onDone();
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Commit failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl border border-gray-200 bg-white p-6 shadow-xl dark:border-gray-700 dark:bg-gray-950">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Import manager directory</h2>
          <button type="button" onClick={onClose} className="text-sm text-gray-500 hover:text-gray-800 dark:hover:text-gray-200">
            Close
          </button>
        </div>
        <div className="mb-4 flex gap-2 text-xs text-gray-500">
          <span className={step === 0 ? 'font-semibold text-brand' : ''}>1. Paste</span>
          <span>→</span>
          <span className={step === 1 ? 'font-semibold text-brand' : ''}>2. Preview &amp; commit</span>
        </div>
        {step === 0 ? (
          <div className="space-y-4">
            <PasteFromExcel onParsed={(r) => void runPreview(r)} />
            <p className="text-xs text-gray-500">After Parse, the wizard loads the preview step.</p>
          </div>
        ) : null}
        {step === 1 && preview ? (
          <div className="space-y-4">
            <div className="rounded-lg border border-gray-200 p-3 text-sm dark:border-gray-700">
              <div>Total {preview.counts.total}</div>
              <div className="text-green-700">OK {preview.counts.ok}</div>
              <div className="text-amber-700">Invalid {preview.counts.invalid}</div>
              <div className="text-orange-700">Duplicate (DB) {preview.counts.duplicateDb}</div>
            </div>
            <div className="max-h-56 overflow-auto text-xs">
              <table className="w-full border-collapse">
                <thead>
                  <tr className="border-b border-gray-200 text-left dark:border-gray-700">
                    <th className="p-1">#</th>
                    <th className="p-1">Name</th>
                    <th className="p-1">Email</th>
                    <th className="p-1">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {(preview.preview as Array<{ input: DirectoryRowInput; rowKind: string; issues: string[] }>).map((row, i) => (
                    <tr key={i} className="border-b border-gray-100 dark:border-gray-800">
                      <td className="p-1">{i + 1}</td>
                      <td className="p-1">
                        {row.input.firstName} {row.input.lastName}
                      </td>
                      <td className="p-1">{row.input.email}</td>
                      <td className="p-1">{row.rowKind}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <label className="flex items-center gap-2 text-sm">
              Strategy
              <select
                value={strategy}
                onChange={(e) => setStrategy(e.target.value as typeof strategy)}
                className="rounded border border-gray-300 bg-white px-2 py-1 dark:border-gray-600 dark:bg-gray-900"
              >
                <option value="skip_duplicates">Skip duplicates</option>
                <option value="update_existing">Update existing by email</option>
              </select>
            </label>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setStep(0)} className="rounded-lg border px-3 py-1.5 text-sm">
                Back
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void commit()}
                className="rounded-lg bg-brand px-3 py-1.5 text-sm text-white disabled:opacity-50"
              >
                Commit
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

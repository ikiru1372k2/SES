/**
 * QgcSettingsDrawer — QGC audit policy settings slide-over panel.
 * Extracted from AuditResultsTab to keep that orchestrator under 300 lines.
 */
import { X } from 'lucide-react';
import { FormEvent, useState } from 'react';
import toast from 'react-hot-toast';
import { createDefaultAuditPolicy } from '../../../../../lib/auditPolicy';
import type { MappingSourceInput } from '../../../../../lib/api/auditsApi';
import { useAppStore } from '../../../../../store/useAppStore';
import type { AuditPolicy, AuditProcess, WorkbookFile } from '../../../../../lib/types';

export function QgcSettingsDrawer({
  process,
  file,
  mappingSource,
  onClose,
}: {
  process: AuditProcess;
  file?: WorkbookFile | undefined;
  mappingSource?: MappingSourceInput | undefined;
  onClose: () => void;
}) {
  const updateAuditPolicy = useAppStore((state) => state.updateAuditPolicy);
  const resetAuditPolicy = useAppStore((state) => state.resetAuditPolicy);
  const runAudit = useAppStore((state) => state.runAudit);
  const [draft, setDraft] = useState<AuditPolicy>(process.auditPolicy);
  const isOverPlanning = file?.functionId === 'over-planning';
  const isMissingPlan = file?.functionId === 'missing-plan';
  const isFunctionRate = file?.functionId === 'function-rate';
  const isInternalCostRate = file?.functionId === 'internal-cost-rate';
  const isOpportunities = file?.functionId === 'opportunities';

  function setNumber(key: keyof AuditPolicy, value: string) {
    setDraft((s) => ({ ...s, [key]: Number(value) || 0 }));
  }
  function setFlag(key: keyof AuditPolicy, value: boolean) {
    setDraft((s) => ({ ...s, [key]: value }));
  }

  type OppField = NonNullable<AuditPolicy['opportunities']>;
  function setOpp<K extends keyof OppField>(key: K, value: OppField[K]) {
    setDraft((s) => ({ ...s, opportunities: { ...(s.opportunities ?? {}), [key]: value } }));
  }
  function setOppNumber(key: keyof OppField, value: string) {
    const parsed = Number(value);
    setOpp(key, (Number.isFinite(parsed) ? parsed : 0) as OppField[typeof key]);
  }

  function save(event: FormEvent) {
    event.preventDefault();
    updateAuditPolicy(process.id, { ...draft, mediumEffortMin: 0, mediumEffortMax: 0, lowEffortEnabled: false });
    if (file) {
      const runOptions =
        (isOverPlanning || isFunctionRate || isInternalCostRate) && mappingSource
          ? { mappingSource }
          : undefined;
      void runAudit(process.id, file.id, runOptions)
        .then(() => toast.success('Settings saved and audit re-run'))
        .catch((err: unknown) => {
          toast.success('Settings saved');
          toast.error(err instanceof Error ? err.message : 'Audit failed — please re-run manually.');
        });
    } else {
      toast.success('Settings saved');
    }
    onClose();
  }

  function reset() {
    setDraft(createDefaultAuditPolicy());
    resetAuditPolicy(process.id);
    toast.success('QGC settings reset. Re-run audit to apply.');
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/30">
      <form
        onSubmit={save}
        className="h-full w-full max-w-md overflow-y-auto border-l border-gray-200 bg-white p-5 shadow-xl dark:border-gray-700 dark:bg-gray-900"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-lg font-semibold">QGC Settings</h3>
            <p className="mt-1 text-sm text-gray-500">
              Configure thresholds for this process. Re-run audit after saving.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-lg p-1 hover:bg-gray-100 dark:hover:bg-gray-800"
          >
            <X size={18} />
          </button>
        </div>

        {isOverPlanning ? (
          <SettingsSection title="Overplanning threshold">
            <NumberField
              label="Flag when monthly Effort PD exceeds"
              value={draft.pdThreshold ?? 30}
              suffix="PD per month"
              onChange={(v) => setNumber('pdThreshold', v)}
            />
          </SettingsSection>
        ) : isMissingPlan ? (
          <SettingsSection title="Missing Planning rules">
            <Toggle label="Flag missing effort (absent / blank)" checked={draft.missingEffortEnabled} onChange={(c) => setFlag('missingEffortEnabled', c)} />
            <Toggle label="Flag zero effort" checked={draft.zeroEffortEnabled} onChange={(c) => setFlag('zeroEffortEnabled', c)} />
          </SettingsSection>
        ) : isFunctionRate ? (
          <SettingsSection title="Function Rate rule">
            <p className="text-sm text-gray-600 dark:text-gray-300">
              External rate columns are auto-detected. Any month with a rate of exactly 0 is flagged; blank cells are ignored.
            </p>
          </SettingsSection>
        ) : isInternalCostRate ? (
          <SettingsSection title="Internal Cost Rate rule">
            <p className="text-sm text-gray-600 dark:text-gray-300">
              Monthly cost-rate columns are auto-detected. Any month with a rate of exactly 0 is flagged; blank cells are ignored.
            </p>
          </SettingsSection>
        ) : isOpportunities ? (
          <SettingsSection title="Opportunities checks">
            <NumberField label="Closed-in-past low-probability max" value={draft.opportunities?.closeDateLowProbabilityMax ?? 75} suffix="%" onChange={(v) => setOppNumber('closeDateLowProbabilityMax', v)} />
            <NumberField label="Project-start-in-past low-probability max" value={draft.opportunities?.projectStartLowProbabilityMax ?? 90} suffix="%" onChange={(v) => setOppNumber('projectStartLowProbabilityMax', v)} />
            <NumberField label="Missing BCS exact probability (Service)" value={draft.opportunities?.missingBcsProbabilityExact ?? 90} suffix="%" onChange={(v) => setOppNumber('missingBcsProbabilityExact', v)} />
            <NumberField label="BCS available low-probability max (Service)" value={draft.opportunities?.bcsAvailableLowProbabilityMax ?? 90} suffix="%" onChange={(v) => setOppNumber('bcsAvailableLowProbabilityMax', v)} />
            <label className="block text-sm">
              <span className="font-medium text-gray-700 dark:text-gray-200">Brazil expected Business Unit</span>
              <input
                type="text"
                value={draft.opportunities?.brazilExpectedBu ?? 'Brazil'}
                onChange={(e) => setOpp('brazilExpectedBu', e.target.value)}
                className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 dark:border-gray-700 dark:bg-gray-800"
              />
            </label>
          </SettingsSection>
        ) : (
          <p className="mt-4 text-sm text-gray-500">No configurable thresholds for this function.</p>
        )}

        <div className="sticky bottom-0 mt-6 flex gap-2 border-t border-gray-200 bg-white pt-4 dark:border-gray-700 dark:bg-gray-900">
          <button type="submit" className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-hover">
            {file ? 'Save & Re-run Audit' : 'Save Settings'}
          </button>
          <button type="button" onClick={reset} className="rounded-lg border border-gray-300 px-4 py-2 text-sm hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800">
            Reset Defaults
          </button>
          <button type="button" onClick={onClose} className="ml-auto rounded-lg border border-gray-300 px-4 py-2 text-sm hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800">
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}

function SettingsSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-5 rounded-xl border border-gray-200 p-4 dark:border-gray-700">
      <h4 className="font-semibold">{title}</h4>
      <div className="mt-3 space-y-3">{children}</div>
    </section>
  );
}

function NumberField({ label, value, suffix, onChange }: { label: string; value: number; suffix?: string; onChange: (v: string) => void }) {
  return (
    <label className="block text-sm">
      <span className="font-medium text-gray-700 dark:text-gray-200">{label}</span>
      <div className="mt-1 flex items-center gap-2">
        <input type="number" value={value} onChange={(e) => onChange(e.target.value)} className="w-full rounded-lg border border-gray-300 px-3 py-2 dark:border-gray-700 dark:bg-gray-800" />
        {suffix ? <span className="text-xs text-gray-500">{suffix}</span> : null}
      </div>
    </label>
  );
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (c: boolean) => void }) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

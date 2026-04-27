import type { AiRuleSpec, FunctionId, IssueCategory, Severity } from '@ses/domain';
import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import toast from 'react-hot-toast';
import { AlertTriangle, ChevronLeft, ChevronRight, Sparkles, Upload } from 'lucide-react';
import {
  useGenerateRule,
  usePickSheet,
  usePreviewEscalations,
  usePreviewRule,
  useSaveRule,
  useUploadSandbox,
} from '../../hooks/useAiPilot';
import { useAiPilotStore } from '../../store/aiPilotStore';
import { EscalationLitePreview } from './EscalationLitePreview';
import { PromptEnhancer } from './PromptEnhancer';
import { PromptExamplesPanel } from './PromptExamplesPanel';

const SEVERITIES: Severity[] = ['High', 'Medium', 'Low'];
const CATEGORIES: IssueCategory[] = [
  'Data Quality',
  'Needs Review',
  'Missing Data',
  'Effort Threshold',
  'Planning Risk',
  'Capacity Risk',
  'Overplanning',
  'Missing Planning',
  'Function Rate',
  'Internal Cost Rate',
  'Other',
];

export function SandboxModal({
  open,
  functionId,
  onClose,
}: {
  open: boolean;
  functionId: FunctionId;
  onClose: () => void;
}) {
  const store = useAiPilotStore();
  const upload = useUploadSandbox();
  const sheet = usePickSheet();
  const generate = useGenerateRule();
  const preview = usePreviewRule();
  const previewEsc = usePreviewEscalations();
  const save = useSaveRule();

  const initialized = useRef(false);
  useEffect(() => {
    if (open && !initialized.current) {
      store.resetSandbox();
      initialized.current = true;
    }
    if (!open) initialized.current = false;
  }, [open, store]);

  if (!open) return null;

  const close = () => {
    store.resetSandbox();
    onClose();
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 pt-12 backdrop-blur-sm"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div className="w-full max-w-3xl rounded-2xl border border-gray-200 bg-white shadow-2xl dark:border-gray-700 dark:bg-gray-900">
        <Header step={store.currentStep} />

        <div className="space-y-4 px-6 py-5">
          {store.currentStep === 1 ? (
            <Step1Upload
              busy={upload.isPending}
              onPick={async (file) => {
                try {
                  const result = await upload.mutateAsync({ functionId, file });
                  store.setUpload(result);
                  store.setStep(result.sheets.length > 1 ? 2 : 3);
                } catch (err) {
                  toast.error(err instanceof Error ? err.message : 'Upload failed');
                }
              }}
            />
          ) : null}

          {store.currentStep === 2 ? (
            <Step2PickSheet
              sheets={store.uploadedFile?.sheets ?? []}
              selected={store.selectedSheet}
              busy={sheet.isPending}
              onPick={async (name) => {
                if (!store.sessionId) return;
                try {
                  await sheet.mutateAsync({ sessionId: store.sessionId, sheetName: name });
                  store.setSelectedSheet(name);
                  store.setStep(3);
                } catch (err) {
                  toast.error(err instanceof Error ? err.message : 'Sheet pick failed');
                }
              }}
            />
          ) : null}

          {store.currentStep === 3 ? (
            <Step3Describe
              functionId={functionId}
              prompt={store.prompt}
              onChange={store.setPrompt}
              busy={generate.isPending}
              onGenerate={async () => {
                if (!store.sessionId || !store.prompt.trim()) return;
                try {
                  const r = await generate.mutateAsync({
                    sessionId: store.sessionId,
                    prompt: store.prompt,
                  });
                  if (!r.success || !r.spec) {
                    store.setGenerationError({ raw: r.raw, error: r.error ?? 'unknown' });
                    return;
                  }
                  store.setSpec(r.spec);
                  store.setGenerationError(null);
                  store.setStep(5);
                } catch (err) {
                  toast.error(err instanceof Error ? err.message : 'Generation failed');
                }
              }}
              error={store.generationError}
              onClearError={() => store.setGenerationError(null)}
            />
          ) : null}

          {store.currentStep === 5 && store.generatedSpec ? (
            <Step5Review
              spec={store.generatedSpec}
              onChange={store.applySpecEdit}
              onBack={() => store.setStep(3)}
              onPreview={async () => {
                if (!store.sessionId || !store.generatedSpec) return;
                try {
                  const r = await preview.mutateAsync({
                    sessionId: store.sessionId,
                    spec: store.generatedSpec,
                  });
                  store.setPreviewResult(r);
                  // escalation preview in parallel — soft fail
                  try {
                    const esc = await previewEsc.mutateAsync({
                      sessionId: store.sessionId,
                      spec: store.generatedSpec,
                    });
                    store.setEscalationLite(esc, null);
                  } catch (err) {
                    store.setEscalationLite(
                      null,
                      err instanceof Error ? err.message : 'unavailable',
                    );
                  }
                  store.setStep(6);
                } catch (err) {
                  toast.error(err instanceof Error ? err.message : 'Preview failed');
                }
              }}
              busy={preview.isPending || previewEsc.isPending}
            />
          ) : null}

          {store.currentStep === 6 && store.previewResult && store.generatedSpec ? (
            <Step6Preview
              result={store.previewResult}
              escalation={store.escalationLite}
              escalationError={store.escalationLiteError}
              onBack={() => store.setStep(5)}
              onSave={async () => {
                if (
                  !store.sessionId ||
                  !store.generatedSpec ||
                  !store.previewedAt
                ) {
                  toast.error('Preview required before save');
                  return;
                }
                try {
                  await save.mutateAsync({
                    spec: store.generatedSpec,
                    sandboxSessionId: store.sessionId,
                    previewedAt: store.previewedAt,
                  });
                  toast.success(`Saved rule ${store.generatedSpec.name}. Will run on next audit.`);
                  close();
                } catch (err) {
                  toast.error(err instanceof Error ? err.message : 'Save failed');
                }
              }}
              saveDisabled={!store.previewedAt}
              busy={save.isPending}
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}

function Header({ step }: { step: number }) {
  const labels = ['Upload', 'Sheet', 'Describe', 'Generate', 'Review', 'Preview'];
  return (
    <header className="flex items-center justify-between border-b border-gray-100 px-6 py-3 dark:border-gray-800">
      <div className="flex items-center gap-2 text-sm font-semibold text-gray-900 dark:text-white">
        <Sparkles size={16} className="text-brand" />
        Author AI rule
      </div>
      <ol className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide">
        {labels.map((label, i) => {
          const n = i + 1;
          const active = step === n;
          const done = step > n;
          return (
            <li
              key={label}
              className={`rounded-full px-2 py-0.5 ${
                active
                  ? 'bg-brand text-white'
                  : done
                    ? 'bg-gray-100 text-gray-500 dark:bg-gray-800'
                    : 'text-gray-400'
              }`}
            >
              {n}. {label}
            </li>
          );
        })}
      </ol>
    </header>
  );
}

function Step1Upload({ busy, onPick }: { busy: boolean; onPick: (file: File) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <div className="space-y-3">
      <p className="text-sm text-gray-600 dark:text-gray-300">
        Drop a sample workbook (.xlsx, max 5MB). Production files are never touched — this is a
        private sandbox.
      </p>
      <button
        type="button"
        disabled={busy}
        onClick={() => inputRef.current?.click()}
        className="flex w-full items-center justify-center gap-2 rounded-xl border-2 border-dashed border-gray-300 bg-gray-50 px-6 py-10 text-sm font-medium text-gray-700 transition hover:border-brand hover:bg-brand-subtle hover:text-brand disabled:opacity-60 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200"
      >
        <Upload size={18} />
        {busy ? 'Uploading…' : 'Choose .xlsx file'}
      </button>
      <input
        ref={inputRef}
        type="file"
        accept=".xlsx"
        hidden
        onChange={(e: ChangeEvent<HTMLInputElement>) => {
          const f = e.target.files?.[0];
          if (f) onPick(f);
        }}
      />
    </div>
  );
}

function Step2PickSheet({
  sheets,
  selected,
  busy,
  onPick,
}: {
  sheets: Array<{ name: string; rowCount: number; status: string }>;
  selected: string | null;
  busy: boolean;
  onPick: (name: string) => void;
}) {
  const [choice, setChoice] = useState(selected ?? sheets[0]?.name ?? '');
  return (
    <div className="space-y-3">
      <p className="text-sm text-gray-600 dark:text-gray-300">
        Multiple sheets detected. Pick the one this rule applies to.
      </p>
      <div className="space-y-1.5">
        {sheets.map((s) => (
          <label
            key={s.name}
            className={`flex cursor-pointer items-center justify-between rounded-lg border px-3 py-2 text-sm transition ${
              choice === s.name
                ? 'border-brand bg-brand-subtle text-brand'
                : 'border-gray-200 hover:border-gray-300 dark:border-gray-700'
            }`}
          >
            <span className="flex items-center gap-2">
              <input
                type="radio"
                name="sheet"
                value={s.name}
                checked={choice === s.name}
                onChange={() => setChoice(s.name)}
                className="accent-brand"
              />
              <span className="font-medium">{s.name}</span>
              <span className="text-xs text-gray-500">
                {s.rowCount} rows · {s.status}
              </span>
            </span>
          </label>
        ))}
      </div>
      <FooterRow>
        <button
          type="button"
          disabled={busy || !choice}
          onClick={() => onPick(choice)}
          className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-hover disabled:opacity-60"
        >
          {busy ? 'Saving…' : 'Continue'}
          <ChevronRight size={14} className="ml-1 inline" />
        </button>
      </FooterRow>
    </div>
  );
}

function Step3Describe({
  functionId,
  prompt,
  onChange,
  onGenerate,
  busy,
  error,
  onClearError,
}: {
  functionId: FunctionId;
  prompt: string;
  onChange: (s: string) => void;
  onGenerate: () => void;
  busy: boolean;
  error: { raw: unknown; error: string } | null;
  onClearError: () => void;
}) {
  const sessionId = useAiPilotStore((s) => s.sessionId);
  const uploadedFile = useAiPilotStore((s) => s.uploadedFile);
  const selectedSheet = useAiPilotStore((s) => s.selectedSheet);
  const columns =
    uploadedFile?.sheets.find((sh) => sh.name === selectedSheet)?.normalizedHeaders ?? [];

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-[1fr_220px]">
      <div className="space-y-2">
        <label className="text-xs font-semibold uppercase tracking-wide text-gray-500">
          Describe the rule
        </label>
        <textarea
          value={prompt}
          onChange={(e) => {
            onChange(e.target.value);
            if (error) onClearError();
          }}
          rows={5}
          maxLength={500}
          placeholder="e.g. Flag rows where State is blank or contains 'Unknown'"
          className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
        />
        <div className="flex items-center justify-between gap-2">
          <p className="text-[11px] text-gray-500">
            {prompt.length}/500 — keep it under ~200 chars for best results.
          </p>
          <PromptEnhancer
            sessionId={sessionId}
            currentPrompt={prompt}
            columns={columns}
            onAccept={(text) => onChange(text)}
            disabled={busy}
          />
        </div>
        {error ? (
          <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-200">
            <div className="mb-1 flex items-center gap-1.5 font-semibold">
              <AlertTriangle size={12} />
              The AI returned a response we couldn&apos;t parse: {error.error}
            </div>
            <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-all text-[10px] font-mono text-red-700 dark:text-red-200">
              {JSON.stringify(error.raw, null, 2)}
            </pre>
            <p className="mt-1 text-red-700 dark:text-red-200">Try a different prompt.</p>
          </div>
        ) : null}
        <FooterRow>
          <button
            type="button"
            disabled={busy || !prompt.trim()}
            onClick={onGenerate}
            className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-hover disabled:opacity-60"
          >
            {busy ? 'Generating…' : 'Generate rule'}
          </button>
        </FooterRow>
      </div>
      <PromptExamplesPanel functionId={functionId} onPick={(text) => onChange(text)} />
    </div>
  );
}

function Step5Review({
  spec,
  onChange,
  onBack,
  onPreview,
  busy,
}: {
  spec: AiRuleSpec;
  onChange: (patch: Partial<AiRuleSpec>) => void;
  onBack: () => void;
  onPreview: () => void;
  busy: boolean;
}) {
  return (
    <div className="space-y-3">
      <p className="text-sm text-gray-600 dark:text-gray-300">
        Review what the AI generated. You can edit any field. Editing forces a re-preview.
      </p>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <Field label="Name">
          <input
            value={spec.name}
            onChange={(e) => onChange({ name: e.target.value })}
            className={inputClass}
          />
        </Field>
        <Field label="Severity">
          <select
            value={spec.severity}
            onChange={(e) => onChange({ severity: e.target.value as Severity })}
            className={inputClass}
          >
            {SEVERITIES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Category">
          <select
            value={spec.category}
            onChange={(e) => onChange({ category: e.target.value as IssueCategory })}
            className={inputClass}
          >
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Flag message (interpolates {projectNo}, {projectName}, {projectManager})">
          <input
            value={spec.flagMessage}
            onChange={(e) => onChange({ flagMessage: e.target.value })}
            className={inputClass}
          />
        </Field>
      </div>
      <Field label="Logic (JSON)">
        <textarea
          value={JSON.stringify(spec.logic, null, 2)}
          onChange={(e) => {
            try {
              const parsed = JSON.parse(e.target.value);
              onChange({ logic: parsed });
            } catch {
              /* ignore until valid */
            }
          }}
          rows={6}
          className={`${inputClass} font-mono text-[11px]`}
        />
      </Field>
      <FooterRow>
        <button
          type="button"
          onClick={onBack}
          className="rounded-lg border border-gray-300 px-3 py-2 text-sm hover:bg-gray-50 dark:border-gray-700"
        >
          <ChevronLeft size={14} className="mr-1 inline" />
          Refine prompt
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={onPreview}
          className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-hover disabled:opacity-60"
        >
          {busy ? 'Previewing…' : 'Preview against sample'}
          <ChevronRight size={14} className="ml-1 inline" />
        </button>
      </FooterRow>
    </div>
  );
}

function Step6Preview({
  result,
  escalation,
  escalationError,
  onBack,
  onSave,
  saveDisabled,
  busy,
}: {
  result: import('../../lib/api/aiPilotApi').PreviewResult;
  escalation: import('../../lib/api/aiPilotApi').EscalationLitePreview | null;
  escalationError: string | null;
  onBack: () => void;
  onSave: () => void;
  saveDisabled: boolean;
  busy: boolean;
}) {
  const sample = result.issues.slice(0, 50);
  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm dark:border-gray-700 dark:bg-gray-800">
        <p className="font-semibold text-gray-800 dark:text-gray-100">
          {result.flaggedRows} flagged · {result.scannedRows} scanned ·{' '}
          {result.scannedRows > 0
            ? Math.round((result.flaggedRows / result.scannedRows) * 100)
            : 0}
          % flag rate
        </p>
        {result.unknownColumns.length > 0 ? (
          <p className="mt-1 text-xs text-amber-700 dark:text-amber-300">
            ⚠ Columns not found on this sheet: {result.unknownColumns.join(', ')}. Rule may behave
            differently on real workbooks.
          </p>
        ) : null}
      </div>

      <EscalationLitePreview preview={escalation} errorMessage={escalationError} />

      <div className="max-h-64 overflow-auto rounded-lg border border-gray-200 dark:border-gray-700">
        <table className="min-w-full text-xs">
          <thead className="sticky top-0 bg-gray-100 text-left text-[10px] font-semibold uppercase tracking-wide text-gray-600 dark:bg-gray-800 dark:text-gray-300">
            <tr>
              <th className="px-2 py-1">Row</th>
              <th className="px-2 py-1">Project</th>
              <th className="px-2 py-1">Sheet</th>
              <th className="px-2 py-1">Severity</th>
              <th className="px-2 py-1">Reason</th>
            </tr>
          </thead>
          <tbody>
            {sample.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-2 py-3 text-center text-gray-500">
                  No rows flagged.
                </td>
              </tr>
            ) : (
              sample.map((issue) => (
                <tr key={issue.id} className="border-t border-gray-100 dark:border-gray-800">
                  <td className="px-2 py-1">{issue.rowIndex + 1}</td>
                  <td className="px-2 py-1">
                    <span className="font-medium">{issue.projectNo}</span>{' '}
                    <span className="text-gray-500">{issue.projectName}</span>
                  </td>
                  <td className="px-2 py-1">{issue.sheetName}</td>
                  <td className="px-2 py-1">
                    <SeverityChip s={issue.severity} />
                  </td>
                  <td className="px-2 py-1 text-gray-700 dark:text-gray-200">{issue.reason}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <FooterRow>
        <button
          type="button"
          onClick={onBack}
          className="rounded-lg border border-gray-300 px-3 py-2 text-sm hover:bg-gray-50 dark:border-gray-700"
        >
          <ChevronLeft size={14} className="mr-1 inline" />
          Edit rule
        </button>
        <button
          type="button"
          disabled={saveDisabled || busy}
          onClick={onSave}
          className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-hover disabled:opacity-60"
          title={saveDisabled ? 'Preview must succeed before saving' : undefined}
        >
          {busy ? 'Saving…' : 'Save to engine'}
        </button>
      </FooterRow>
    </div>
  );
}

const inputClass =
  'w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100';

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-gray-500">
        {label}
      </span>
      {children}
    </label>
  );
}

function FooterRow({ children }: { children: React.ReactNode }) {
  return <div className="flex items-center justify-end gap-2">{children}</div>;
}

function SeverityChip({ s }: { s: 'High' | 'Medium' | 'Low' }) {
  const cls =
    s === 'High'
      ? 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-200'
      : s === 'Medium'
        ? 'bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-200'
        : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-200';
  return (
    <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${cls}`}>{s}</span>
  );
}

import type { FunctionId } from '@ses/domain';
import { AlertTriangle } from 'lucide-react';
import { useAiPilotStore } from '../../../store/aiPilotStore';
import { PromptEnhancer } from '../PromptEnhancer';
import { PromptExamplesPanel } from '../PromptExamplesPanel';
import { FooterRow } from './shared';

export interface Step3DescribeProps {
  functionId: FunctionId;
  prompt: string;
  onChange: (s: string) => void;
  onGenerate: () => void;
  busy: boolean;
  error: { raw: unknown; error: string } | null;
  onClearError: () => void;
}

export function Step3Describe({
  functionId,
  prompt,
  onChange,
  onGenerate,
  busy,
  error,
  onClearError,
}: Step3DescribeProps) {
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

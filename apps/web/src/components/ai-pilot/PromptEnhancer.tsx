import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, Loader2, Sparkles, X } from 'lucide-react';
import { useEnhancePrompt } from '../../hooks/useAiPilot';

export function PromptEnhancer({
  sessionId,
  currentPrompt,
  columns,
  onAccept,
  disabled,
}: {
  sessionId: string | null;
  currentPrompt: string;
  columns: string[];
  onAccept: (text: string) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [suggestion, setSuggestion] = useState('');
  const [error, setError] = useState<string | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const enhance = useEnhancePrompt();

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (!wrapRef.current) return;
      if (!wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const run = async () => {
    if (!sessionId) return;
    setError(null);
    try {
      const r = await enhance.mutateAsync({ sessionId, prompt: currentPrompt, columns });
      setSuggestion(r.enhancedPrompt);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not reach AI service');
    }
  };

  const openAndRun = async () => {
    setOpen(true);
    if (!suggestion) await run();
  };

  const accept = () => {
    if (!suggestion) return;
    onAccept(suggestion);
    setOpen(false);
  };

  const isReady = Boolean(sessionId) && columns.length > 0 && currentPrompt.trim().length >= 3;

  return (
    <div ref={wrapRef} className="relative inline-block">
      <button
        type="button"
        onClick={openAndRun}
        disabled={disabled || !isReady}
        title={
          !sessionId
            ? 'Upload a workbook first'
            : columns.length === 0
              ? 'No columns detected on the selected sheet'
              : currentPrompt.trim().length < 3
                ? 'Type a few words first'
                : 'Rewrite my prompt to be more specific'
        }
        className="inline-flex items-center gap-1 rounded-md border border-brand/40 bg-brand-subtle px-2 py-1 text-[11px] font-medium text-brand transition hover:bg-brand hover:text-white disabled:cursor-not-allowed disabled:border-gray-200 disabled:bg-gray-50 disabled:text-gray-400"
      >
        <Sparkles size={11} />
        Enhance
      </button>

      {open ? (
        <div
          role="dialog"
          aria-label="Prompt enhancer"
          className="absolute right-0 top-full z-30 mt-2 w-[420px] rounded-lg border border-gray-200 bg-white p-3 shadow-xl dark:border-gray-700 dark:bg-gray-900"
        >
          <header className="mb-2 flex items-center justify-between">
            <span className="flex items-center gap-1.5 text-xs font-semibold text-gray-700 dark:text-gray-200">
              <Sparkles size={12} className="text-brand" />
              Prompt enhancer
            </span>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close"
              className="rounded p-0.5 text-gray-400 hover:text-gray-700"
            >
              <X size={12} />
            </button>
          </header>

          <p className="mb-2 text-[10px] text-gray-500">
            Suggests a tighter version using your workbook&apos;s actual columns.
          </p>

          {enhance.isPending ? (
            <div className="flex items-center gap-1.5 rounded-md border border-gray-200 bg-gray-50 p-2 text-xs text-gray-600 dark:border-gray-700 dark:bg-gray-800">
              <Loader2 size={12} className="animate-spin" />
              Asking the AI…
            </div>
          ) : error ? (
            <div className="rounded-md border border-red-200 bg-red-50 p-2 text-[11px] text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-200">
              <div className="mb-1 flex items-center gap-1.5 font-semibold">
                <AlertTriangle size={11} />
                {error}
              </div>
              You can still hand-edit your prompt and Generate.
            </div>
          ) : (
            <textarea
              readOnly
              value={suggestion}
              rows={4}
              placeholder="Click Try again to fetch a suggestion."
              className="w-full rounded-md border border-gray-300 bg-gray-50 px-2 py-1.5 text-xs text-gray-800 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
            />
          )}

          <footer className="mt-2 flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={run}
              disabled={enhance.isPending}
              className="rounded-md border border-gray-300 px-2 py-1 text-[11px] hover:bg-gray-50 disabled:opacity-60 dark:border-gray-700"
            >
              Try again
            </button>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-md px-2 py-1 text-[11px] text-gray-600 hover:bg-gray-50 dark:text-gray-300"
              >
                Keep mine
              </button>
              <button
                type="button"
                onClick={accept}
                disabled={!suggestion || enhance.isPending}
                className="rounded-md bg-brand px-2.5 py-1 text-[11px] font-medium text-white hover:bg-brand-hover disabled:opacity-60"
              >
                Use this
              </button>
            </div>
          </footer>
        </div>
      ) : null}
    </div>
  );
}

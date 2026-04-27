import type { FunctionId } from '@ses/domain';
import { usePromptExamples } from '../../hooks/useAiPilot';

export function PromptExamplesPanel({
  functionId,
  onPick,
}: {
  functionId: FunctionId;
  onPick: (text: string) => void;
}) {
  const examplesQuery = usePromptExamples(functionId);
  if (examplesQuery.isLoading) {
    return <p className="text-xs text-gray-500">Loading examples…</p>;
  }
  const examples = examplesQuery.data?.examples ?? [];
  if (examples.length === 0) {
    return <p className="text-xs text-gray-500">No examples for this function yet.</p>;
  }
  return (
    <div className="space-y-2">
      <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Examples</p>
      <ul className="space-y-1.5">
        {examples.map((ex) => (
          <li key={ex}>
            <button
              type="button"
              onClick={() => onPick(ex)}
              className="block w-full rounded-md border border-gray-200 bg-white p-2 text-left text-xs text-gray-700 transition hover:border-brand hover:bg-brand-subtle hover:text-brand dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200"
            >
              {ex}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

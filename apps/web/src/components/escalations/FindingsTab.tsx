import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { FunctionId, ProcessEscalationManagerRow } from '@ses/domain';
import { getFunctionLabel } from '@ses/domain';
import { workspacePath } from '../../lib/processRoutes';

export function FindingsTab({ processId, row }: { processId: string; row: ProcessEscalationManagerRow }) {
  const engines = useMemo(() => {
    const ids = Object.keys(row.findingsByEngine ?? {}) as FunctionId[];
    return ids.filter((id) => (row.findingsByEngine[id]?.length ?? 0) > 0);
  }, [row.findingsByEngine]);
  const [open, setOpen] = useState<Record<string, boolean>>({});

  if (!engines.length) {
    return <p className="text-sm text-gray-500">No findings in the latest completed runs.</p>;
  }

  return (
    <div className="space-y-2">
      {engines.map((engine) => {
        const list = row.findingsByEngine[engine] ?? [];
        const isOpen = open[engine] ?? true;
        return (
          <div key={engine} className="overflow-hidden rounded-xl border border-gray-200 shadow-soft dark:border-gray-800">
            <button
              type="button"
              className="flex w-full items-center justify-between px-3 py-2.5 text-left text-sm font-medium tracking-tight transition-colors hover:bg-gray-50 dark:hover:bg-gray-900"
              onClick={() => setOpen((s) => ({ ...s, [engine]: !isOpen }))}
            >
              <span>{getFunctionLabel(engine)}</span>
              <span className="chip chip-plain">{list.length}</span>
            </button>
            {isOpen ? (
              <ul className="border-t border-gray-100 px-3 py-2 text-sm dark:border-gray-800">
                {list.map((f, i) => (
                  // issueKey can repeat within an engine's findings (the same
                  // issue is unioned across the manager's rows), so a bare
                  // issueKey key collided — suffix with index + projectNo to
                  // guarantee uniqueness and stop React reconciliation breaking.
                  <li
                    key={`${f.issueKey}::${f.projectNo ?? ''}::${i}`}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-md px-1 py-1.5 transition-colors hover:bg-gray-50/70 dark:hover:bg-gray-900/40"
                  >
                    <span className="text-gray-700 dark:text-gray-200">
                      {f.projectNo ?? f.issueKey}
                      {f.projectName ? ` — ${f.projectName}` : ''}
                    </span>
                    <Link
                      to={`${workspacePath(processId, engine)}?tab=results&issue=${encodeURIComponent(f.issueKey)}`}
                      className="shrink-0 text-xs text-brand transition-colors hover:underline"
                    >
                      Open evidence
                    </Link>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
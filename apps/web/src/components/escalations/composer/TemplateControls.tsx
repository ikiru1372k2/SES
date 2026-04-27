import type { FunctionId } from '@ses/domain';
import { FUNCTION_IDS } from '@ses/domain';

export interface EscalationTemplate {
  id: string;
  subject: string;
  body: string;
  stage: string;
  version: string | number;
  channel: string;
}

export interface FindingRow {
  issueKey: string;
  projectNo?: string | null;
}

export interface TemplateControlsProps {
  readOnly: boolean;
  templateId: string | undefined;
  deadlineAt: string;
  templates: EscalationTemplate[];
  uniqueProjectIds: string[];
  cleanProjectLinks: Record<string, string>;
  projectLinks: Record<string, string>;
  projectLinksOpen: boolean;
  countsByEngine: Partial<Record<FunctionId, number>>;
  findingsByEngine: Partial<Record<FunctionId, FindingRow[]>>;
  removedEngines: Set<string>;
  onTemplateChange: (id: string) => void;
  onDeadlineChange: (value: string) => void;
  onProjectLinksOpenToggle: () => void;
  onProjectLinkChange: (pid: string, url: string) => void;
  onToggleEngineRemove: (fid: FunctionId, count: number) => void;
}

export function TemplateControls({
  readOnly,
  templateId,
  deadlineAt,
  templates,
  uniqueProjectIds,
  cleanProjectLinks,
  projectLinks,
  projectLinksOpen,
  countsByEngine,
  findingsByEngine,
  removedEngines,
  onTemplateChange,
  onDeadlineChange,
  onProjectLinksOpenToggle,
  onProjectLinkChange,
  onToggleEngineRemove,
}: TemplateControlsProps) {
  return (
    <>
      <div className="grid gap-3 md:grid-cols-2">
        <div>
          <label className="text-xs font-medium text-gray-500">Template</label>
          <select
            disabled={readOnly}
            value={templateId ?? ''}
            onChange={(e) => onTemplateChange(e.target.value)}
            className="mt-1 w-full rounded border border-gray-300 px-2 py-1.5 text-sm dark:border-gray-600 dark:bg-gray-900"
          >
            {templates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.stage} v{t.version} ({t.channel})
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-xs font-medium text-gray-500">
            Due date (shown to manager as {'{{dueDate}}'})
          </label>
          <input
            type="date"
            disabled={readOnly}
            value={deadlineAt}
            onChange={(e) => onDeadlineChange(e.target.value)}
            className="mt-1 w-full rounded border border-gray-300 px-2 py-1.5 text-sm dark:border-gray-600 dark:bg-gray-900"
          />
        </div>
      </div>

      {uniqueProjectIds.length > 0 ? (
        <div className="rounded border border-gray-200 dark:border-gray-700">
          <button
            type="button"
            onClick={onProjectLinksOpenToggle}
            className="flex w-full items-center justify-between px-3 py-2 text-left text-xs font-medium text-gray-700 hover:bg-gray-50 dark:text-gray-200 dark:hover:bg-gray-800"
            aria-expanded={projectLinksOpen}
          >
            <span>
              Project links
              <span className="ml-1 text-gray-400">
                ({Object.keys(cleanProjectLinks).length}/{uniqueProjectIds.length})
              </span>
              <span className="ml-2 font-normal text-gray-500">
                Optional — paste a URL per project to include it in the email.
              </span>
            </span>
            <span className="text-gray-400">{projectLinksOpen ? '▾' : '▸'}</span>
          </button>
          {projectLinksOpen ? (
            <div className="space-y-2 border-t border-gray-100 px-3 py-2 dark:border-gray-800">
              {uniqueProjectIds.map((pid) => (
                <div key={pid} className="grid grid-cols-[7rem,1fr] items-center gap-2">
                  <label
                    className="truncate text-xs font-medium text-gray-600 dark:text-gray-300"
                    title={pid}
                  >
                    {pid}
                  </label>
                  <input
                    type="url"
                    disabled={readOnly}
                    value={projectLinks[pid] ?? ''}
                    onChange={(e) => onProjectLinkChange(pid, e.target.value)}
                    placeholder="https://bcs.example.com/project/…"
                    className="w-full rounded border border-gray-300 px-2 py-1 text-sm dark:border-gray-600 dark:bg-gray-900"
                  />
                </div>
              ))}
              <p className="pt-1 text-[11px] text-gray-500">
                Only valid http(s) URLs render in the preview. Leave blank to skip a project.
              </p>
            </div>
          ) : null}
        </div>
      ) : null}

      <div>
        <div className="text-xs font-medium text-gray-500">Findings by engine</div>
        <div className="mt-1 space-y-1">
          {FUNCTION_IDS.map((fid) => {
            const n = countsByEngine[fid] ?? 0;
            if (n === 0) return null;
            const open = !removedEngines.has(fid);
            return (
              <details key={fid} open={open} className="rounded border border-gray-200 dark:border-gray-700">
                <summary className="cursor-pointer px-2 py-1 text-xs font-medium">
                  {fid} ({n})
                  {!readOnly ? (
                    <button
                      type="button"
                      className="ml-2 text-red-600 hover:underline"
                      onClick={(e) => {
                        e.preventDefault();
                        onToggleEngineRemove(fid, n);
                      }}
                    >
                      {open ? 'Remove' : 'Restore'}
                    </button>
                  ) : null}
                </summary>
                <ul className="border-t border-gray-100 px-2 py-1 text-xs dark:border-gray-800">
                  {(findingsByEngine[fid] ?? []).map((f) => (
                    <li key={f.issueKey}>{f.projectNo ?? f.issueKey}</li>
                  ))}
                </ul>
              </details>
            );
          })}
        </div>
      </div>
    </>
  );
}

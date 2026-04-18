import { useState } from 'react';
import type { AuditProcess, NotificationDraft, NotificationTemplate, NotificationTheme } from '../../../lib/types';
import { trackingKey } from '../../../lib/tracking';
import { TemplateEditor } from '../TemplateEditor';
import { DraftCard } from './DraftCard';
import { NotificationPreview } from './NotificationPreview';

const THEMES: NotificationTheme[] = [
  'Company Reminder',
  'Executive Summary',
  'Compact Update',
  'Formal',
  'Urgent',
  'Friendly Follow-up',
  'Escalation',
];

export function PerManagerDrafts({
  process,
  drafts,
  theme,
  setTheme,
  deadline,
  setDeadline,
  template,
  setTemplate,
  onlyUnreviewed,
  setOnlyUnreviewed,
  search,
  setSearch,
  setSelected,
  active,
  sendAll,
  validRecipientCount,
  openOutlook,
  downloadDraft,
  openTeams,
  onSaveNamed,
  onCopyDraft,
}: {
  process: AuditProcess;
  drafts: NotificationDraft[];
  theme: NotificationTheme;
  setTheme: (theme: NotificationTheme) => void;
  deadline: string;
  setDeadline: (value: string) => void;
  template: NotificationTemplate;
  setTemplate: (template: NotificationTemplate | ((previous: NotificationTemplate) => NotificationTemplate)) => void;
  onlyUnreviewed: boolean;
  setOnlyUnreviewed: (value: boolean) => void;
  search: string;
  setSearch: (value: string) => void;
  setSelected: (index: number) => void;
  active: NotificationDraft | undefined;
  sendAll: () => void;
  validRecipientCount: number;
  openOutlook: (draft: NotificationDraft) => void;
  downloadDraft: (draft: NotificationDraft) => void;
  openTeams: (draft: NotificationDraft) => void;
  onSaveNamed: (name: string) => void;
  onCopyDraft: (draft: NotificationDraft) => void;
}) {
  const [rightPanel, setRightPanel] = useState<'preview' | 'template'>('preview');

  return (
    <div className="grid min-h-0 flex-1 gap-5 xl:grid-cols-[380px_minmax(0,1fr)]">
      <section className="flex min-h-0 flex-col rounded-xl border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800">
        <div className="shrink-0 space-y-3 border-b border-gray-100 p-4 dark:border-gray-700">
          <div>
            <h2 className="font-semibold">Per-manager drafts</h2>
            <p className="mt-1 text-xs text-gray-500">
              {drafts.length} manager(s) match the current filters.
            </p>
          </div>
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search manager, email, project name, project no..."
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900"
          />
          <button
            type="button"
            onClick={sendAll}
            disabled={!drafts.length}
            className="w-full rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-hover disabled:opacity-40"
          >
            Send All ({validRecipientCount} managers)
          </button>
          <label className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-300">
            <input
              type="checkbox"
              checked={onlyUnreviewed}
              onChange={(event) => setOnlyUnreviewed(event.target.checked)}
              className="h-4 w-4 rounded border-gray-300"
            />
            Only managers with un-reviewed projects
          </label>
        </div>
        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
          {drafts.length ? (
            drafts.map((draft, index) => (
              <DraftCard
                key={draft.recipientKey}
                draft={draft}
                stage={process.notificationTracking[trackingKey(process.id, draft.recipientKey)]?.stage}
                isActive={active?.recipientKey === draft.recipientKey}
                onSelect={() => {
                  setSelected(index);
                  setRightPanel('preview');
                }}
                onCopy={() => onCopyDraft(draft)}
                onOutlook={() => openOutlook(draft)}
                onEml={() => downloadDraft(draft)}
                onTeams={() => openTeams(draft)}
              />
            ))
          ) : (
            <div className="rounded-lg border border-dashed border-gray-200 p-5 text-center text-sm text-gray-500 dark:border-gray-700">
              No managers match your search or filter.
            </div>
          )}
        </div>
      </section>
      <section className="flex min-h-0 flex-col rounded-xl border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800">
        <div className="shrink-0 border-b border-gray-100 p-4 dark:border-gray-700">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="text-xs font-medium uppercase tracking-wide text-gray-500">Previewing for</div>
              <h2 className="mt-1 font-semibold">{active?.pmName ?? 'No manager selected'}</h2>
              <p className="text-xs text-gray-500">{active?.email ?? 'No valid email'}</p>
            </div>
            <div className="flex rounded-lg border border-gray-200 p-1 text-sm dark:border-gray-700">
              <button
                type="button"
                onClick={() => setRightPanel('preview')}
                className={`rounded-md px-3 py-1.5 ${rightPanel === 'preview' ? 'bg-brand text-white' : 'text-gray-600 hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-gray-700'}`}
              >
                Preview
              </button>
              <button
                type="button"
                onClick={() => setRightPanel('template')}
                className={`rounded-md px-3 py-1.5 ${rightPanel === 'template' ? 'bg-brand text-white' : 'text-gray-600 hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-gray-700'}`}
              >
                Edit template
              </button>
            </div>
          </div>
          <div className="mt-4 grid gap-3 lg:grid-cols-[1fr_180px]">
            <div className="space-y-2">
              <label className="block text-xs font-medium text-gray-500">Theme</label>
              <div className="flex flex-wrap gap-2">
                {THEMES.map((itemTheme) => (
                  <button
                    key={itemTheme}
                    type="button"
                    onClick={() => setTheme(itemTheme)}
                    className={`rounded-full px-3 py-1 text-xs font-medium ${
                      theme === itemTheme
                        ? 'bg-brand text-white'
                        : 'bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-200'
                    }`}
                  >
                    {itemTheme}
                  </button>
                ))}
              </div>
            </div>
            <div className="space-y-2">
              <label className="block text-xs font-medium text-gray-500">Deadline</label>
              <input
                type="date"
                value={deadline}
                onChange={(event) => setDeadline(event.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900"
              />
            </div>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5">
          {rightPanel === 'template' ? (
            <div className="mx-auto max-w-3xl py-5">
              <TemplateEditor
                template={template}
                theme={theme}
                onChange={setTemplate}
                onSaveNamed={onSaveNamed}
              />
            </div>
          ) : active ? (
            <NotificationPreview draft={active} deadline={deadline} template={template} />
          ) : (
            <p className="mt-4 text-sm text-gray-500">No flagged managers in this audit.</p>
          )}
        </div>
      </section>
    </div>
  );
}

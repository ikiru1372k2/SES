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
  const [templateOpen, setTemplateOpen] = useState(false);

  return (
    <div className="grid min-h-0 flex-1 gap-5 lg:grid-cols-[340px_1fr]">
      <section className="flex min-h-0 flex-col gap-4 rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
        <div className="shrink-0 space-y-4">
          <h2 className="font-semibold">Notification Drafts ({drafts.length} managers)</h2>
          <button
            type="button"
            onClick={sendAll}
            disabled={!drafts.length}
            className="w-full rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-hover disabled:opacity-40"
          >
            Send All ({validRecipientCount} managers)
          </button>
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
          <label className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-300">
            <input
              type="checkbox"
              checked={onlyUnreviewed}
              onChange={(event) => setOnlyUnreviewed(event.target.checked)}
              className="h-4 w-4 rounded border-gray-300"
            />
            Only managers with un-reviewed projects
          </label>
          <details
            open={templateOpen}
            onToggle={(event) => setTemplateOpen((event.target as HTMLDetailsElement).open)}
            className="rounded-lg border border-gray-200 p-3 dark:border-gray-700"
          >
            <summary className="cursor-pointer text-sm font-medium">Edit Template</summary>
            <div className="mt-3">
              <TemplateEditor
                template={template}
                theme={theme}
                onChange={setTemplate}
                onSaveNamed={onSaveNamed}
              />
            </div>
          </details>
        </div>
        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
          {drafts.map((draft, index) => (
            <DraftCard
              key={draft.recipientKey}
              draft={draft}
              stage={process.notificationTracking[trackingKey(process.id, draft.recipientKey)]?.stage}
              isActive={active?.recipientKey === draft.recipientKey}
              onSelect={() => setSelected(index)}
              onCopy={() => onCopyDraft(draft)}
              onOutlook={() => openOutlook(draft)}
              onEml={() => downloadDraft(draft)}
              onTeams={() => openTeams(draft)}
            />
          ))}
        </div>
      </section>
      <section className="flex min-h-0 flex-col rounded-xl border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800">
        <div className="shrink-0 border-b border-gray-100 px-5 py-4 dark:border-gray-700">
          <h2 className="font-semibold">Preview</h2>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5">
          {active ? (
            <NotificationPreview draft={active} deadline={deadline} template={template} />
          ) : (
            <p className="mt-4 text-sm text-gray-500">No flagged managers in this audit.</p>
          )}
        </div>
      </section>
    </div>
  );
}

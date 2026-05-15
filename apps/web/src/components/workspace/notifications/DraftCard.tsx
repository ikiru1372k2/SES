import { memo, type KeyboardEvent, type ReactNode } from 'react';
import type { NotificationDraft } from '../../../lib/domain/types';

export const DraftCard = memo(function DraftCard({
  draft,
  stage,
  isActive,
  onSelect,
  onCopy,
  onOutlook,
  onEml,
  onTeams,
}: {
  draft: NotificationDraft;
  stage: string | undefined;
  isActive: boolean;
  onSelect: () => void;
  onCopy: () => void;
  onOutlook?: () => void;
  onEml: () => void;
  onTeams?: () => void;
}) {
  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onSelect();
    }
  }

  return (
    <div
      role="button"
      tabIndex={0}
      aria-pressed={isActive}
      onClick={onSelect}
      onKeyDown={onKeyDown}
      className={`w-full cursor-pointer rounded-lg border p-3 text-left text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand ${
        isActive
          ? 'border-blue-400 bg-blue-50 dark:bg-blue-950'
          : 'border-gray-200 hover:border-gray-300 dark:border-gray-700 dark:hover:border-gray-600'
      }`}
    >
      <div className="font-medium">{draft.pmName}</div>
      <div className={draft.email ? 'text-xs text-gray-500' : 'text-xs font-medium text-red-600'}>
        {draft.email ?? 'Missing manager email'}
      </div>
      <div className="mt-1 text-xs text-gray-500">
        {draft.issueCount} flagged · {draft.unreviewedCount} un-reviewed · {draft.pendingCorrectionCount} correction(s) · {stage ?? draft.stage}
      </div>
      <div className="mt-2 flex flex-wrap gap-2">
        <ActionButton onClick={onCopy}>Copy</ActionButton>
        {onOutlook ? (
          <ActionButton onClick={onOutlook} disabled={!draft.email}>
            Open Outlook
          </ActionButton>
        ) : null}
        <ActionButton onClick={onEml} disabled={!draft.email}>
          Download .eml
        </ActionButton>
        {onTeams ? (
          <ActionButton onClick={onTeams} disabled={!draft.email}>
            Teams
          </ActionButton>
        ) : null}
      </div>
    </div>
  );
});

function ActionButton({ onClick, disabled, children }: { onClick: () => void; disabled?: boolean; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
      disabled={disabled}
      className="rounded border border-gray-300 px-2 py-1 text-xs hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-gray-600 dark:hover:bg-gray-700"
    >
      {children}
    </button>
  );
}

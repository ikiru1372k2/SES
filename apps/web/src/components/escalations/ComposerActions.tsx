import { Eye, Mail, MessageSquare } from 'lucide-react';
import { Button } from '../shared/Button';

export function ComposerActions({
  readOnly,
  viewMode,
  onToggleView,
  onDiscard,
  discardPending,
  onSave,
  draftPending,
  onPreview,
  previewPending,
  outlookAllowed,
  outlookGateReason,
  outlookCount,
  onOutlook,
  teamsAllowed,
  teamsGateReason,
  teamsCount,
  onTeams,
  sendPending,
}: {
  readOnly: boolean;
  viewMode: 'preview' | 'edit';
  onToggleView: () => void;
  onDiscard: () => void;
  discardPending: boolean;
  onSave: () => void;
  draftPending: boolean;
  onPreview: () => void;
  previewPending: boolean;
  outlookAllowed: boolean;
  outlookGateReason: string;
  outlookCount: number;
  onOutlook: () => void;
  teamsAllowed: boolean;
  teamsGateReason: string;
  teamsCount: number;
  onTeams: () => void;
  sendPending: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 border-t border-gray-200 pt-3 dark:border-gray-800">
      <Button type="button" variant="secondary" onClick={onToggleView}>
        {viewMode === 'preview' ? 'Edit' : 'Preview'}
      </Button>
      <Button type="button" variant="secondary" onClick={onDiscard} disabled={readOnly || discardPending}>
        Discard
      </Button>
      <Button type="button" variant="secondary" onClick={onSave} disabled={readOnly || draftPending}>
        Save draft
      </Button>
      <Button
        type="button"
        variant="secondary"
        leading={<Eye size={14} />}
        title="Preview email in a popup"
        disabled={previewPending}
        onClick={onPreview}
      >
        {previewPending ? 'Loading...' : 'Preview'}
      </Button>
      <div className="flex-1" />
      <Button
        type="button"
        variant={outlookAllowed ? 'primary' : 'secondary'}
        leading={<Mail size={14} />}
        title={outlookGateReason || 'Send via Outlook'}
        disabled={readOnly || !outlookAllowed || sendPending}
        onClick={onOutlook}
      >
        Outlook ({outlookCount}/2)
      </Button>
      <Button
        type="button"
        variant={teamsAllowed ? 'primary' : 'secondary'}
        leading={<MessageSquare size={14} />}
        title={teamsGateReason || 'Send via Teams'}
        disabled={readOnly || !teamsAllowed || sendPending}
        onClick={onTeams}
      >
        Teams ({teamsCount}/1)
      </Button>
    </div>
  );
}

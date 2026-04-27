import { Mail, MessageSquare } from 'lucide-react';
import { Button } from '../../shared/Button';

export interface ComposerFooterProps {
  viewMode: 'preview' | 'edit';
  readOnly: boolean;
  outlookCount: number;
  teamsCount: number;
  outlookAllowed: boolean;
  teamsAllowed: boolean;
  outlookGateReason: string;
  teamsGateReason: string;
  discardPending: boolean;
  draftPending: boolean;
  sendPending: boolean;
  onToggleView: () => void;
  onDiscard: () => void;
  onSaveDraft: () => void;
  onSendOutlook: () => void;
  onSendTeams: () => void;
}

export function ComposerFooter({
  viewMode,
  readOnly,
  outlookCount,
  teamsCount,
  outlookAllowed,
  teamsAllowed,
  outlookGateReason,
  teamsGateReason,
  discardPending,
  draftPending,
  sendPending,
  onToggleView,
  onDiscard,
  onSaveDraft,
  onSendOutlook,
  onSendTeams,
}: ComposerFooterProps) {
  return (
    <div className="flex flex-wrap items-center gap-2 border-t border-gray-200 pt-3 dark:border-gray-800">
      <Button type="button" variant="secondary" onClick={onToggleView}>
        {viewMode === 'preview' ? 'Edit' : 'Preview'}
      </Button>
      <Button
        type="button"
        variant="secondary"
        onClick={onDiscard}
        disabled={readOnly || discardPending}
      >
        Discard
      </Button>
      <Button
        type="button"
        variant="secondary"
        onClick={onSaveDraft}
        disabled={readOnly || draftPending}
      >
        Save draft
      </Button>
      <div className="flex-1" />
      <Button
        type="button"
        variant={outlookAllowed ? 'primary' : 'secondary'}
        leading={<Mail size={14} />}
        title={outlookGateReason || 'Open Outlook with this message prefilled'}
        disabled={readOnly || !outlookAllowed || sendPending}
        onClick={onSendOutlook}
      >
        Outlook ({outlookCount}/2)
      </Button>
      <Button
        type="button"
        variant={teamsAllowed ? 'primary' : 'secondary'}
        leading={<MessageSquare size={14} />}
        title={teamsGateReason || 'Open Teams chat with this message prefilled'}
        disabled={readOnly || !teamsAllowed || sendPending}
        onClick={onSendTeams}
      >
        Teams ({teamsCount}/1)
      </Button>
    </div>
  );
}

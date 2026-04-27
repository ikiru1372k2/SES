import type { UseQueryResult } from '@tanstack/react-query';
import type { ProcessEscalationManagerRow, ProcessEscalationsPayload } from '@ses/domain';
import { FUNCTION_REGISTRY } from '@ses/domain';
import { EscalationPanel } from '../../components/escalations/EscalationPanel';
import { ResolutionDrawer } from '../../components/directory/ResolutionDrawer';
import { ShortcutOverlay } from '../../components/escalations/ShortcutOverlay';
import { BulkComposer } from '../../components/escalations/BulkComposer';
import { BroadcastDialog } from '../../components/escalations/BroadcastDialog';
import { effectiveManagerEmail } from '../../components/escalations/nextAction';
import {
  AcknowledgeDialog,
  ReescalateDialog,
  SnoozeDialog,
} from '../../components/escalations/BulkActionDialog';
import { bulkAcknowledge, bulkReescalate, bulkSnooze } from '../../lib/api/bulkTrackingApi';

interface EscalationDialogsProps {
  processId: string;
  processDisplayCode: string;
  panelRow: ProcessEscalationManagerRow | null;
  panelOpen: boolean;
  onPanelClose: () => void;
  resolveOpen: boolean;
  onResolveClose: () => void;
  q: UseQueryResult<ProcessEscalationsPayload, Error>;
  onResolved: () => void;
  shortcutOpen: boolean;
  onShortcutClose: () => void;
  bulkComposerOpen: boolean;
  onBulkComposerClose: () => void;
  selectedTrackingIds: Set<string>;
  onSelectionClear: () => void;
  ackOpen: boolean;
  onAckClose: () => void;
  snoozeOpen: boolean;
  onSnoozeClose: () => void;
  reescOpen: boolean;
  onReescClose: () => void;
  broadcastOpen: boolean;
  onBroadcastClose: () => void;
}

export function EscalationDialogs({
  processId,
  processDisplayCode,
  panelRow,
  panelOpen,
  onPanelClose,
  resolveOpen,
  onResolveClose,
  q,
  onResolved,
  shortcutOpen,
  onShortcutClose,
  bulkComposerOpen,
  onBulkComposerClose,
  selectedTrackingIds,
  onSelectionClear,
  ackOpen,
  onAckClose,
  snoozeOpen,
  onSnoozeClose,
  reescOpen,
  onReescClose,
  broadcastOpen,
  onBroadcastClose,
}: EscalationDialogsProps) {
  return (
    <>
      <EscalationPanel
        processId={processId}
        processDisplayCode={processDisplayCode}
        row={panelRow}
        open={panelOpen}
        onClose={onPanelClose}
      />

      <ResolutionDrawer
        open={resolveOpen}
        onClose={onResolveClose}
        rawNames={(q.data?.rows ?? []).filter((r) => r.isUnmapped).map((r) => r.managerName)}
        onResolved={onResolved}
      />
      <ShortcutOverlay open={shortcutOpen} onClose={onShortcutClose} />
      <BulkComposer
        trackingIds={[...selectedTrackingIds]}
        open={bulkComposerOpen}
        onClose={onBulkComposerClose}
      />
      <AcknowledgeDialog
        open={ackOpen}
        onClose={onAckClose}
        count={selectedTrackingIds.size}
        onDone={() => {
          onSelectionClear();
          void q.refetch();
        }}
        runAction={(note) => bulkAcknowledge([...selectedTrackingIds], note || undefined)}
      />
      <SnoozeDialog
        open={snoozeOpen}
        onClose={onSnoozeClose}
        count={selectedTrackingIds.size}
        onDone={() => {
          onSelectionClear();
          void q.refetch();
        }}
        runAction={(days, note) => bulkSnooze([...selectedTrackingIds], days, note || undefined)}
      />
      <ReescalateDialog
        open={reescOpen}
        onClose={onReescClose}
        count={selectedTrackingIds.size}
        onDone={() => {
          onSelectionClear();
          void q.refetch();
        }}
        runAction={(note) => bulkReescalate([...selectedTrackingIds], note || undefined)}
      />
      <BroadcastDialog
        open={broadcastOpen}
        onClose={onBroadcastClose}
        onDone={() => void q.refetch()}
        processIdOrCode={processDisplayCode}
        estimatedAudience={
          (q.data?.rows ?? []).filter((r) => !r.resolved && Boolean(effectiveManagerEmail(r))).length
        }
        functionOptions={FUNCTION_REGISTRY.map((f) => ({ id: f.id, label: f.label }))}
      />
    </>
  );
}

import { useEffect } from 'react';
import type { UseQueryResult } from '@tanstack/react-query';
import type { ProcessEscalationsPayload } from '@ses/domain';
import toast from 'react-hot-toast';
import { bulkResolve } from '../../lib/api/bulkTrackingApi';

interface UseEscalationKeyboardOptions {
  selectedTrackingIds: Set<string>;
  ackOpen: boolean;
  snoozeOpen: boolean;
  reescOpen: boolean;
  bulkComposerOpen: boolean;
  panelOpen: boolean;
  q: UseQueryResult<ProcessEscalationsPayload, Error>;
  onShortcutOpen: () => void;
  onAckOpen: () => void;
  onSnoozeOpen: () => void;
  onReescOpen: () => void;
  onBulkComposerOpen: () => void;
  onClearSelection: () => void;
}

export function useEscalationKeyboard({
  selectedTrackingIds,
  ackOpen,
  snoozeOpen,
  reescOpen,
  bulkComposerOpen,
  panelOpen,
  q,
  onShortcutOpen,
  onAckOpen,
  onSnoozeOpen,
  onReescOpen,
  onBulkComposerOpen,
  onClearSelection,
}: UseEscalationKeyboardOptions) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (
        event.target instanceof HTMLInputElement ||
        event.target instanceof HTMLTextAreaElement ||
        event.target instanceof HTMLSelectElement
      ) {
        return;
      }
      if (event.key === '?') {
        event.preventDefault();
        onShortcutOpen();
      } else if (event.key === 'Escape' && selectedTrackingIds.size > 0) {
        // Predictable get-me-out-of-here: clears the current bulk selection
        // only when nothing more modal is already open.
        if (!ackOpen && !snoozeOpen && !reescOpen && !bulkComposerOpen) {
          onClearSelection();
        }
      } else if (event.key === 'c' && selectedTrackingIds.size > 0) {
        event.preventDefault();
        onBulkComposerOpen();
      } else if (event.key === 'a' && selectedTrackingIds.size > 0) {
        event.preventDefault();
        onAckOpen();
      } else if (event.key === 's' && selectedTrackingIds.size > 0) {
        event.preventDefault();
        onSnoozeOpen();
      } else if (event.key === 'e' && selectedTrackingIds.size > 0) {
        event.preventDefault();
        onReescOpen();
      } else if (event.key === 'r' && selectedTrackingIds.size > 0) {
        event.preventDefault();
        void bulkResolve([...selectedTrackingIds])
          .then((res) => {
            toast.success(`${res.count} resolved.`);
            void q.refetch();
          })
          .catch((err: Error) => toast.error(err.message));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [ackOpen, bulkComposerOpen, onAckOpen, onBulkComposerOpen, onClearSelection, onReescOpen, onShortcutOpen, onSnoozeOpen, panelOpen, q, reescOpen, selectedTrackingIds, snoozeOpen]);
}

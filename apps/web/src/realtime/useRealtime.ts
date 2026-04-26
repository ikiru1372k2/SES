import { useEffect, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { getSocket, onRealtimeEvent } from './socket';
import { useAppStore } from '../store/useAppStore';
import type {
  PresenceJoinedPayload,
  PresenceLeftPayload,
  PresenceMember,
  PresenceSnapshotPayload,
  RealtimeEnvelope,
} from './types';

const HEARTBEAT_MS = 20_000;

interface UseRealtimeReturn {
  /** Current known presence members for the joined process (includes self). */
  members: PresenceMember[];
  /** True once the socket has received a presence.snapshot for this process. */
  connected: boolean;
  /** Move presence within this process (tab switch, focus change). */
  move: (patch: { tab?: string; focusCode?: string }) => void;
}

interface UseRealtimeOptions {
  /** Called when the current user is removed from the process or the process is deleted. */
  onEvicted?: (reason: 'removed' | 'deleted', processName: string) => void;
}

/**
 * Subscribe to a process's realtime room.
 *
 * Responsibilities:
 *   1. Join on mount / leave on unmount — the server handles `presence.join`
 *      which enforces membership via ProcessAccessService, so an unauthorized
 *      user just gets `{ ok: false, reason: 'forbidden' }` and we no-op.
 *   2. Maintain a local presence list synced by presence.* envelopes.
 *   3. Fire human-readable toasts for actions other users took on this
 *      process (we mute our own actions to avoid "Jane ran audit" from Jane).
 *   4. Send a periodic heartbeat so the server can detect zombie sessions.
 *
 * Callers don't need to touch the socket directly; pass a `processCode`
 * (the PRC-* display code or UUID — the gateway accepts either) and use
 * the returned `members` for the PresenceBar.
 */
export function useRealtime(
  processCode: string | null | undefined,
  currentUserCode?: string,
  options?: UseRealtimeOptions,
): UseRealtimeReturn {
  const [members, setMembers] = useState<PresenceMember[]>([]);
  const [connected, setConnected] = useState(false);
  const selfCodeRef = useRef<string | undefined>(currentUserCode);
  const onEvictedRef = useRef(options?.onEvicted);
  useEffect(() => { selfCodeRef.current = currentUserCode; });
  useEffect(() => { onEvictedRef.current = options?.onEvicted; });

  useEffect(() => {
    if (!processCode) return;
    const socket = getSocket();

    // Join (the server validates access and returns members count).
    let active = true;
    socket.emit('presence.join', { processCode }, (ack: { ok: boolean; reason?: string } | undefined) => {
      if (!active) return;
      if (!ack?.ok) {
        // Access denied or unknown process — UI stays disconnected, no toast needed.
        setConnected(false);
      }
    });

    const off = onRealtimeEvent((envelope) => {
      if (envelope.processCode && envelope.processCode !== processCode) return;
      handleEnvelope(envelope, selfCodeRef.current, setMembers, setConnected, onEvictedRef);
    });

    // Heartbeat
    const heartbeat = window.setInterval(() => {
      socket.emit('presence.heartbeat');
    }, HEARTBEAT_MS);

    // Reconnect -> re-join. Socket.IO reconnects automatically but forgets
    // room memberships; we need to re-send presence.join each time.
    const onConnect = () => {
      socket.emit('presence.join', { processCode });
    };
    socket.on('connect', onConnect);

    return () => {
      active = false;
      window.clearInterval(heartbeat);
      socket.off('connect', onConnect);
      off();
      socket.emit('presence.leave', { processCode });
      setMembers([]);
      setConnected(false);
    };
  }, [processCode]);

  function move(patch: { tab?: string; focusCode?: string }) {
    if (!processCode) return;
    getSocket().emit('presence.move', patch);
  }

  return { members, connected, move };
}

export function handleEnvelope(
  envelope: RealtimeEnvelope,
  selfCode: string | undefined,
  setMembers: React.Dispatch<React.SetStateAction<PresenceMember[]>>,
  setConnected: React.Dispatch<React.SetStateAction<boolean>>,
  onEvictedRef: { current: ((reason: 'removed' | 'deleted', processName: string) => void) | undefined },
) {
  const isSelf = envelope.actor?.code && envelope.actor.code === selfCode;

  switch (envelope.event) {
    case 'presence.snapshot': {
      const payload = envelope.payload as PresenceSnapshotPayload;
      setMembers(payload.members ?? []);
      setConnected(true);
      return;
    }
    case 'presence.joined': {
      const payload = envelope.payload as PresenceJoinedPayload;
      setMembers((prev) => {
        if (prev.some((m) => m.socketId === payload.socketId)) return prev;
        return [...prev, payload];
      });
      if (!isSelf) {
        toast.success(`${payload.displayName} joined`, { icon: '👋', duration: 2500 });
      }
      return;
    }
    case 'presence.left': {
      const payload = envelope.payload as PresenceLeftPayload;
      setMembers((prev) => prev.filter((m) => m.socketId !== payload.socketId));
      return;
    }
    case 'presence.moved': {
      const payload = envelope.payload as PresenceMember;
      setMembers((prev) => prev.map((m) => (m.socketId === payload.socketId ? payload : m)));
      return;
    }
    case 'audit.completed': {
      if (isSelf) return;
      const actor = envelope.actor?.displayName ?? 'Someone';
      const payload = envelope.payload as {
        runCode?: string;
        fileId?: string;
        fileCode?: string;
      } | undefined;
      const code = payload?.runCode ?? '';
      toast(`${actor} ran an audit ${code}`.trim(), { icon: '🔎' });
      // Refresh the exact file the other user ran so scoped viewers/editors
      // see fresh findings immediately instead of staying pinned to a cached
      // in-session result from before the rerun.
      const state = useAppStore.getState();
      const proc = state.processes.find(
        (p) => p.id === envelope.processCode || p.displayCode === envelope.processCode,
      );
      const targetFileId =
        proc?.files.find((f) => f.id === payload?.fileId || f.displayCode === payload?.fileCode)?.id
        ?? proc?.activeFileId;
      if (proc && targetFileId) {
        void state.hydrateLatestAuditResult(proc.id, targetFileId, { force: true });
      }
      return;
    }
    case 'tracking.updated': {
      if (isSelf) return;
      const payload = envelope.payload as { trackingCode: string; stage: string };
      toast(`Tracking updated (${payload.stage})`, { icon: '📋' });
      return;
    }
    case 'file.uploaded': {
      if (isSelf) return;
      const actor = envelope.actor?.displayName ?? 'Someone';
      const payload = envelope.payload as { name: string };
      toast(`${actor} uploaded ${payload.name}`, { icon: '📎' });
      return;
    }
    case 'notification.sent': {
      if (isSelf) return;
      const actor = envelope.actor?.displayName ?? 'Someone';
      const payload = envelope.payload as { managerEmail: string; channel: string };
      toast(`${actor} sent reminder to ${payload.managerEmail} (${payload.channel})`, { icon: '📧' });
      return;
    }
    case 'signed_link.created': {
      if (isSelf) return;
      const actor = envelope.actor?.displayName ?? 'Someone';
      const payload = envelope.payload as { managerEmail: string };
      toast(`${actor} generated a signed link for ${payload.managerEmail}`, { icon: '🔗' });
      return;
    }
    case 'issue.comment.added': {
      if (isSelf) return;
      const actor = envelope.actor?.displayName ?? 'Someone';
      const payload = envelope.payload as { issueKey: string };
      toast(`${actor} commented on ${payload.issueKey}`, { icon: '💬' });
      return;
    }
    case 'issue.correction.saved': {
      if (isSelf) return;
      const actor = envelope.actor?.displayName ?? 'Someone';
      const payload = envelope.payload as { issueKey: string };
      toast(`${actor} saved a correction for ${payload.issueKey}`, { icon: '✏️' });
      return;
    }
    case 'issue.acknowledgment.saved': {
      if (isSelf) return;
      const actor = envelope.actor?.displayName ?? 'Someone';
      const payload = envelope.payload as { issueKey: string; status: string };
      toast(`${actor} acknowledged ${payload.issueKey} (${payload.status})`, { icon: '✅' });
      return;
    }
    case 'process.member_removed': {
      const payload = envelope.payload as { processCode: string; processName: string; removedUserCode: string };
      if (payload.removedUserCode !== selfCode) return;
      const removedProc = useAppStore.getState().processes.find((p) => p.displayCode === payload.processCode);
      if (removedProc) useAppStore.getState().evictProcess(removedProc.id);
      toast(`You were removed from "${payload.processName}"`, { icon: '🚫', duration: 6000 });
      onEvictedRef.current?.('removed', payload.processName);
      return;
    }
    case 'process.deleted': {
      const payload = envelope.payload as { processCode: string; processName: string };
      const deletedProc = useAppStore.getState().processes.find((p) => p.displayCode === payload.processCode);
      if (deletedProc) useAppStore.getState().evictProcess(deletedProc.id);
      if (!isSelf) {
        toast(`"${payload.processName}" was deleted`, { icon: '🗑️', duration: 6000 });
      }
      onEvictedRef.current?.('deleted', payload.processName);
      return;
    }
    default:
      // Unhandled events are fine — they're broadcast for future features.
      return;
  }
}

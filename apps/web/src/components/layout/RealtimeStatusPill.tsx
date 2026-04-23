import { useEffect, useState } from 'react';
import { AlertCircle, Loader2 } from 'lucide-react';
import { getConnectionState, onConnectionState, type RealtimeConnectionState } from '../../realtime/socket';

// Thin header pill that only renders when the realtime connection is not
// healthy. Previously the socket auto-reconnected silently via Socket.IO
// backoff; users were staring at stale data with no cue. F5.
export function RealtimeStatusPill() {
  const [state, setState] = useState<RealtimeConnectionState>(() => getConnectionState());

  useEffect(() => onConnectionState(setState), []);

  if (state === 'connected') return null;

  const isConnecting = state === 'connecting';
  return (
    <span
      role="status"
      aria-live="polite"
      className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium ${
        isConnecting
          ? 'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-100'
          : 'border-red-300 bg-red-50 text-red-900 dark:border-red-900 dark:bg-red-950/50 dark:text-red-100'
      }`}
      title={
        isConnecting
          ? 'Reconnecting to live updates — you may be a few seconds behind.'
          : 'Live updates are offline. Changes made elsewhere will not appear until reconnection.'
      }
    >
      {isConnecting ? <Loader2 size={11} className="animate-spin" /> : <AlertCircle size={11} />}
      {isConnecting ? 'Reconnecting…' : 'Offline'}
    </span>
  );
}

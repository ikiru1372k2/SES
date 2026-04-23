import { io, type Socket } from 'socket.io-client';
import type { RealtimeEnvelope } from './types';

/**
 * One Socket.IO client for the whole app.
 *
 * Design notes:
 *   - Created lazily on first access so SSR / test harnesses don't open a
 *     socket just by importing this module.
 *   - `withCredentials: true` so the cookie auth set by /api/v1/auth/* rides
 *     the WebSocket handshake — same session, no separate token plumbing.
 *   - `reconnection: true` with exponential backoff is the Socket.IO default;
 *     we leave it on so VPN hiccups self-heal.
 *   - Path matches the gateway's @WebSocketGateway({ path: '/api/v1/realtime' })
 *     so Vite's /api proxy forwards it to the Nest process.
 */

let socket: Socket | null = null;
const envelopeListeners = new Set<(envelope: RealtimeEnvelope) => void>();
// F5: surfaced so the UI can show a "Reconnecting…" pill. Listeners receive
// the new connection state on every transition.
export type RealtimeConnectionState = 'connected' | 'connecting' | 'disconnected';
let connectionState: RealtimeConnectionState = 'connecting';
const connectionListeners = new Set<(state: RealtimeConnectionState) => void>();

function setConnectionState(next: RealtimeConnectionState): void {
  if (connectionState === next) return;
  connectionState = next;
  for (const listener of connectionListeners) {
    try {
      listener(next);
    } catch (err) {
      console.error('[realtime] connection listener threw', err);
    }
  }
}

function ensureSocket(): Socket {
  if (socket) return socket;
  socket = io({
    path: '/api/v1/realtime',
    transports: ['websocket', 'polling'],
    withCredentials: true,
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 500,
    reconnectionDelayMax: 5000,
    timeout: 10_000,
    autoConnect: true,
  });

  socket.on('ses.event', (envelope: RealtimeEnvelope) => {
    for (const listener of envelopeListeners) {
      try {
        listener(envelope);
      } catch (err) {
        // Recovery: remaining listeners still run; faulty listener is skipped.
        console.error('[realtime] listener threw', err);
      }
    }
  });

  socket.on('ses.error', (reason: { reason: string }) => {
    // Recovery: socket.io will auto-reconnect; this surfaces the reason in devtools.
    console.warn('[realtime] server error:', reason);
  });

  socket.on('connect', () => setConnectionState('connected'));
  socket.on('disconnect', () => setConnectionState('disconnected'));
  socket.on('reconnect_attempt', () => setConnectionState('connecting'));
  socket.io.on('reconnect_attempt', () => setConnectionState('connecting'));
  socket.io.on('reconnect', () => setConnectionState('connected'));

  return socket;
}

export function getConnectionState(): RealtimeConnectionState {
  ensureSocket();
  return connectionState;
}

/** Subscribe to realtime connection-state transitions. Returns unsubscribe fn. */
export function onConnectionState(listener: (state: RealtimeConnectionState) => void): () => void {
  ensureSocket();
  connectionListeners.add(listener);
  return () => {
    connectionListeners.delete(listener);
  };
}

export function getSocket(): Socket {
  return ensureSocket();
}

/** Register an envelope listener; returns an unsubscribe fn. */
export function onRealtimeEvent(listener: (envelope: RealtimeEnvelope) => void): () => void {
  ensureSocket();
  envelopeListeners.add(listener);
  return () => {
    envelopeListeners.delete(listener);
  };
}

/** Explicitly tear down (primarily for tests / logout). */
export function disconnectSocket(): void {
  if (!socket) return;
  socket.removeAllListeners();
  socket.disconnect();
  socket = null;
  envelopeListeners.clear();
  connectionListeners.clear();
  connectionState = 'disconnected';
}

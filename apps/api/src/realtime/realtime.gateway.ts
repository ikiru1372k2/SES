import { Logger, UnauthorizedException } from '@nestjs/common';
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { createAdapter } from '@socket.io/redis-adapter';
import type { IncomingHttpHeaders } from 'node:http';
import type { Server, Socket } from 'socket.io';
import { createRequestId, requestContext } from '../common/request-context';
import { AuthService } from '../auth.service';
import { ProcessAccessService } from '../common/process-access.service';
import { PresenceRegistry } from './presence.registry';
import { buildRedisAdapterClients } from './realtime.redis';
import type {
  RealtimeEnvelope,
  RealtimeEventName,
  PresenceInfo,
} from './realtime.types';

/**
 * Rooms:
 *   - process:<PRC-code>        // one per process, every member joins on auth
 *   - user:<USR-code>           // personal channel for notifications
 *
 * Wire format: every event goes out as one `ses.event` message with a
 * structured `RealtimeEnvelope`. One channel keeps clients simple — they
 * dispatch on `envelope.event` with a switch. No ad-hoc event names.
 */

interface AuthedSocket extends Socket {
  data: {
    userId: string;
    userCode: string;
    userEmail: string;
    displayName: string;
    role: string;
    joinedProcessCodes: Set<string>;
  };
}

function parseCookies(headers: IncomingHttpHeaders): Record<string, string> {
  const raw = headers.cookie;
  if (!raw) return {};
  const out: Record<string, string> = {};
  for (const part of raw.split(';')) {
    const eq = part.indexOf('=');
    if (eq > 0) {
      const key = part.slice(0, eq).trim();
      const val = part.slice(eq + 1).trim();
      out[key] = decodeURIComponent(val);
    }
  }
  return out;
}

@WebSocketGateway({
  path: '/api/v1/realtime',
  cors: false, // CORS is handled by the main Nest app; Socket.IO honours the same allow-list
  transports: ['websocket', 'polling'],
})
export class RealtimeGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer() server!: Server;
  private readonly logger = new Logger(RealtimeGateway.name);

  constructor(
    private readonly auth: AuthService,
    private readonly presence: PresenceRegistry,
    private readonly processAccess: ProcessAccessService,
  ) {}

  async afterInit(server: Server): Promise<void> {
    const clients = await buildRedisAdapterClients();
    if (clients) {
      server.adapter(createAdapter(clients.pub, clients.sub));
      this.logger.log('RealtimeGateway initialised with Redis adapter.');
    } else {
      this.logger.log('RealtimeGateway initialised in single-node (in-memory) mode.');
    }
  }

  // ---------------------------------------------------------------------
  // Connection lifecycle
  // ---------------------------------------------------------------------

  async handleConnection(socket: Socket): Promise<void> {
    try {
      const fakeRequest = this.buildRequestShim(socket);
      const user = await this.auth.authenticateRequest(fakeRequest as never);
      const authed = socket as AuthedSocket;
      authed.data = {
        userId: user.id,
        userCode: user.displayCode,
        userEmail: user.email,
        displayName: user.displayName,
        role: user.role,
        joinedProcessCodes: new Set<string>(),
      };
      await socket.join(`user:${user.displayCode}`);
      this.logger.debug(`connected ${user.displayCode} socket=${socket.id}`);
    } catch (err) {
      this.logger.debug(`rejecting unauthenticated socket ${socket.id}: ${(err as Error).message}`);
      // Send a one-off failure event so the client can surface a useful toast,
      // then close. Clients that accept anonymous public-share links will use
      // a different namespace in a future revision.
      socket.emit('ses.error', { reason: 'unauthenticated' });
      socket.disconnect(true);
    }
  }

  async handleDisconnect(socket: Socket): Promise<void> {
    const authed = socket as AuthedSocket;
    const leaveResult = this.presence.leave(socket.id);
    if (leaveResult) {
      this.emitTo(`process:${leaveResult.processCode}`, 'presence.left', {
        userCode: leaveResult.info.userCode,
        socketId: socket.id,
      }, { actor: this.actorOf(authed), processCode: leaveResult.processCode });
    }
    if (authed.data?.userCode) {
      this.logger.debug(`disconnected ${authed.data.userCode} socket=${socket.id}`);
    }
  }

  // ---------------------------------------------------------------------
  // Incoming client messages
  // ---------------------------------------------------------------------

  @SubscribeMessage('presence.join')
  async onPresenceJoin(socket: Socket, data: { processCode: string; tab?: string }) {
    const authed = socket as AuthedSocket;
    if (!authed.data) return { ok: false, reason: 'unauthenticated' };
    const processCode = (data?.processCode ?? '').trim();
    if (!processCode) return { ok: false, reason: 'missing_process_code' };

    // Verify this user is allowed on this process before letting them into the room.
    try {
      await this.processAccess.findAccessibleProcessOrThrow(
        {
          id: authed.data.userId,
          displayCode: authed.data.userCode,
          email: authed.data.userEmail,
          displayName: authed.data.displayName,
          role: authed.data.role as 'admin' | 'auditor' | 'viewer',
        },
        processCode,
        'viewer',
      );
    } catch (err) {
      return { ok: false, reason: 'forbidden', message: (err as Error).message };
    }

    await socket.join(`process:${processCode}`);
    authed.data.joinedProcessCodes.add(processCode);

    const now = new Date().toISOString();
    const info: PresenceInfo = {
      userId: authed.data.userId,
      userCode: authed.data.userCode,
      displayName: authed.data.displayName,
      email: authed.data.userEmail,
      socketId: socket.id,
      tab: data?.tab,
      connectedAt: now,
      lastHeartbeat: now,
    };
    const snapshot = this.presence.join(processCode, info);

    // Tell this socket who else is here…
    socket.emit('ses.event', this.envelope('presence.snapshot', { members: snapshot }, processCode, this.actorOf(authed)));
    // …and tell the rest of the room about the new joiner.
    socket.to(`process:${processCode}`).emit(
      'ses.event',
      this.envelope('presence.joined', info, processCode, this.actorOf(authed)),
    );
    return { ok: true, memberCount: snapshot.length };
  }

  @SubscribeMessage('presence.leave')
  async onPresenceLeave(socket: Socket, data: { processCode: string }) {
    const authed = socket as AuthedSocket;
    if (!authed.data) return { ok: false };
    const processCode = data?.processCode?.trim();
    if (!processCode) return { ok: false, reason: 'missing_process_code' };
    await socket.leave(`process:${processCode}`);
    authed.data.joinedProcessCodes.delete(processCode);
    const snapshot = this.presence.snapshot(processCode).filter((m) => m.socketId !== socket.id);
    this.emitTo(`process:${processCode}`, 'presence.left', {
      userCode: authed.data.userCode,
      socketId: socket.id,
      memberCount: snapshot.length,
    }, { actor: this.actorOf(authed), processCode });
    // Also drop from our local registry
    this.presence.leave(socket.id);
    return { ok: true };
  }

  @SubscribeMessage('presence.move')
  onPresenceMove(socket: Socket, data: { tab?: string; focusCode?: string }) {
    const authed = socket as AuthedSocket;
    if (!authed.data) return;
    const updated = this.presence.move(socket.id, data ?? {});
    if (!updated) return;
    for (const processCode of authed.data.joinedProcessCodes) {
      this.emitTo(`process:${processCode}`, 'presence.moved', updated, {
        actor: this.actorOf(authed),
        processCode,
      });
    }
  }

  @SubscribeMessage('presence.heartbeat')
  onHeartbeat(socket: Socket) {
    this.presence.heartbeat(socket.id);
  }

  // ---------------------------------------------------------------------
  // Public emission API – used by services after a successful mutation.
  // ---------------------------------------------------------------------

  /**
   * Emit an event to every member of a process.
   *
   * Call this AFTER a Prisma transaction commits. Emitting inside the
   * transaction leaks state that may still be rolled back.
   */
  emitToProcess<T>(
    processCode: string,
    event: RealtimeEventName,
    payload: T,
    opts: { actor?: RealtimeEnvelope['actor']; requestId?: string } = {},
  ): void {
    this.emitTo(`process:${processCode}`, event, payload, {
      actor: opts.actor ?? this.actorFromContext(),
      processCode,
      requestId: opts.requestId,
    });
  }

  /** Emit to a single user across all their tabs / devices. */
  emitToUser<T>(
    userCode: string,
    event: RealtimeEventName,
    payload: T,
    opts: { actor?: RealtimeEnvelope['actor']; requestId?: string } = {},
  ): void {
    this.emitTo(`user:${userCode}`, event, payload, {
      actor: opts.actor ?? this.actorFromContext(),
      requestId: opts.requestId,
    });
  }

  // ---------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------

  private emitTo(
    room: string,
    event: RealtimeEventName,
    payload: unknown,
    opts: { actor?: RealtimeEnvelope['actor']; processCode?: string; requestId?: string } = {},
  ): void {
    if (!this.server) return;
    const envelope = this.envelope(event, payload, opts.processCode, opts.actor, opts.requestId);
    this.server.to(room).emit('ses.event', envelope);
  }

  private envelope<T>(
    event: RealtimeEventName,
    payload: T,
    processCode: string | undefined,
    actor: RealtimeEnvelope['actor'] | undefined,
    requestId?: string,
  ): RealtimeEnvelope<T> {
    return {
      event,
      payload,
      requestId: requestId ?? requestContext.get().requestId ?? createRequestId(),
      processCode,
      actor: actor ?? null,
      emittedAt: new Date().toISOString(),
    };
  }

  private actorOf(socket: AuthedSocket): RealtimeEnvelope['actor'] {
    if (!socket.data) return null;
    return {
      id: socket.data.userId,
      code: socket.data.userCode,
      email: socket.data.userEmail,
      displayName: socket.data.displayName,
    };
  }

  private actorFromContext(): RealtimeEnvelope['actor'] {
    const ctx = requestContext.get();
    if (!ctx.userId || !ctx.userCode || !ctx.userEmail) return null;
    return {
      id: ctx.userId,
      code: ctx.userCode,
      email: ctx.userEmail,
      displayName: ctx.userCode, // AuthService fills userCode; displayName isn't in ctx
    };
  }

  /**
   * AuthService.authenticateRequest expects an Express-ish Request. Socket.IO
   * hands us headers (cookie / authorization); we shim just enough to reuse
   * the same verification path as the HTTP layer — one source of truth for
   * auth, no drift.
   */
  private buildRequestShim(socket: Socket) {
    const headers = socket.handshake.headers;
    const authHeader =
      (headers.authorization as string | undefined) ??
      (socket.handshake.auth?.token ? `Bearer ${socket.handshake.auth.token}` : undefined);
    const cookies = parseCookies(headers);
    return {
      headers: {
        ...headers,
        authorization: authHeader,
      },
      cookies,
    };
  }
}

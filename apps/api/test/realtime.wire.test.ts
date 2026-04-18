import { strict as assert } from 'node:assert';
import { createServer, type Server as HttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';
import { Server, type Socket } from 'socket.io';
import { io as ioClient, type Socket as ClientSocket } from 'socket.io-client';
import { PresenceRegistry } from '../src/realtime/presence.registry';
import type { PresenceInfo, RealtimeEnvelope } from '../src/realtime/realtime.types';

/**
 * Wire-level integration test for the realtime protocol.
 *
 * Why we don't boot the real Nest gateway here: the full gateway depends on
 * AuthService (which requires a generated Prisma client) and ProcessAccessService.
 * In CI / sandbox environments without database access, that chain can't boot.
 *
 * This test instead reconstructs the *protocol contract* the gateway
 * implements: a Socket.IO server that listens for presence.join and
 * broadcasts presence.joined / presence.snapshot envelopes to the right
 * rooms. If this contract works, the gateway (which uses the same Server
 * API and the same PresenceRegistry) will work against real clients.
 *
 * On a dev machine with `npm run prisma:generate`, you can promote this to a
 * full Nest boot test by replacing the harness with NestFactory.create(AppModule).
 */

interface TestHarness {
  httpServer: HttpServer;
  io: Server;
  presence: PresenceRegistry;
  url: string;
  close: () => Promise<void>;
}

async function buildHarness(): Promise<TestHarness> {
  const httpServer = createServer();
  const io = new Server(httpServer, {
    path: '/api/v1/realtime',
    transports: ['websocket'],
    cors: { origin: '*' },
  });
  const presence = new PresenceRegistry();

  // Minimal auth: read the handshake.auth payload and trust it. The real
  // gateway replaces this step with AuthService.authenticateRequest.
  io.use((socket, next) => {
    const auth = socket.handshake.auth as {
      userId?: string;
      userCode?: string;
      email?: string;
      displayName?: string;
    } | undefined;
    if (!auth?.userCode || !auth.userId) return next(new Error('unauthenticated'));
    (socket.data as Record<string, unknown>) = { ...auth };
    next();
  });

  io.on('connection', (socket: Socket) => {
    const data = socket.data as {
      userId: string;
      userCode: string;
      email: string;
      displayName: string;
    };

    socket.on(
      'presence.join',
      (payload: { processCode: string }, ack?: (r: { ok: boolean; memberCount?: number }) => void) => {
        const processCode = payload?.processCode;
        if (!processCode) {
          ack?.({ ok: false });
          return;
        }
        socket.join(`process:${processCode}`);
        const now = new Date().toISOString();
        const info: PresenceInfo = {
          userId: data.userId,
          userCode: data.userCode,
          displayName: data.displayName,
          email: data.email,
          socketId: socket.id,
          connectedAt: now,
          lastHeartbeat: now,
        };
        const members = presence.join(processCode, info);

        const envelope = (event: string, p: unknown): RealtimeEnvelope => ({
          event: event as RealtimeEnvelope['event'],
          payload: p,
          requestId: 'REQ-TEST',
          processCode,
          actor: {
            id: data.userId,
            code: data.userCode,
            email: data.email,
            displayName: data.displayName,
          },
          emittedAt: new Date().toISOString(),
        });

        // Snapshot to the joiner, broadcast to the room.
        socket.emit('ses.event', envelope('presence.snapshot', { members }));
        socket.to(`process:${processCode}`).emit('ses.event', envelope('presence.joined', info));
        ack?.({ ok: true, memberCount: members.length });
      },
    );

    socket.on('disconnect', () => {
      const result = presence.leave(socket.id);
      if (!result) return;
      io.to(`process:${result.processCode}`).emit('ses.event', {
        event: 'presence.left',
        payload: { userCode: result.info.userCode, socketId: socket.id },
        requestId: 'REQ-TEST',
        processCode: result.processCode,
        actor: null,
        emittedAt: new Date().toISOString(),
      } satisfies RealtimeEnvelope);
    });
  });

  await new Promise<void>((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
  const address = httpServer.address() as AddressInfo;
  const url = `http://127.0.0.1:${address.port}`;

  return {
    httpServer,
    io,
    presence,
    url,
    async close() {
      // io.close() internally closes the underlying http server that was
      // attached to it, so we don't also call httpServer.close() — that
      // would throw ERR_SERVER_NOT_RUNNING on the second close.
      await new Promise<void>((resolve) => io.close(() => resolve()));
    },
  };
}

function connectClient(
  url: string,
  user: { userId: string; userCode: string; email: string; displayName: string },
): ClientSocket {
  return ioClient(url, {
    path: '/api/v1/realtime',
    transports: ['websocket'],
    auth: user,
    reconnection: false,
    forceNew: true,
  });
}

function waitFor<T>(socket: ClientSocket, event: string, predicate: (env: RealtimeEnvelope) => boolean, timeoutMs = 1500): Promise<RealtimeEnvelope<T>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(event, onEvent);
      reject(new Error(`Timed out waiting for ${event}`));
    }, timeoutMs);
    const onEvent = (env: RealtimeEnvelope) => {
      if (predicate(env)) {
        clearTimeout(timer);
        socket.off(event, onEvent);
        resolve(env as RealtimeEnvelope<T>);
      }
    };
    socket.on(event, onEvent);
  });
}

describe('Realtime protocol (wire-level)', () => {
  let harness: TestHarness;

  before(async () => {
    harness = await buildHarness();
  });

  after(async () => {
    await harness.close();
  });

  it('a second joiner causes the first to receive a presence.joined envelope', async () => {
    const alice = connectClient(harness.url, {
      userId: 'u-alice',
      userCode: 'USR-ALICE',
      email: 'alice@example.com',
      displayName: 'Alice',
    });
    const bob = connectClient(harness.url, {
      userId: 'u-bob',
      userCode: 'USR-BOB',
      email: 'bob@example.com',
      displayName: 'Bob',
    });

    try {
      await Promise.all([
        new Promise<void>((resolve, reject) => {
          alice.once('connect', () => resolve());
          alice.once('connect_error', reject);
        }),
        new Promise<void>((resolve, reject) => {
          bob.once('connect', () => resolve());
          bob.once('connect_error', reject);
        }),
      ]);

      // Register the snapshot listener BEFORE emitting — the server sends
      // the snapshot synchronously on the same tick as the ack, and if we
      // waited for the ack first the event would already have fired.
      const aliceSnapshotPromise = waitFor<{ members: PresenceInfo[] }>(
        alice,
        'ses.event',
        (env) => env.event === 'presence.snapshot' && env.processCode === 'PRC-TEST-0001',
      );

      // Alice joins first.
      const aliceAck = await new Promise<{ ok: boolean; memberCount?: number }>((resolve) => {
        alice.emit('presence.join', { processCode: 'PRC-TEST-0001' }, resolve);
      });
      assert.equal(aliceAck.ok, true);
      assert.equal(aliceAck.memberCount, 1);

      // Alice should see an initial snapshot with herself.
      const aliceSnapshot = await aliceSnapshotPromise;
      assert.equal(aliceSnapshot.payload.members.length, 1);
      assert.equal(aliceSnapshot.payload.members[0]!.userCode, 'USR-ALICE');

      // Set up Alice's listener BEFORE Bob joins so we don't race.
      const aliceSeesBob = waitFor<PresenceInfo>(
        alice,
        'ses.event',
        (env) => env.event === 'presence.joined' && (env.payload as PresenceInfo).userCode === 'USR-BOB',
      );

      // Bob joins.
      const bobAck = await new Promise<{ ok: boolean; memberCount?: number }>((resolve) => {
        bob.emit('presence.join', { processCode: 'PRC-TEST-0001' }, resolve);
      });
      assert.equal(bobAck.ok, true);
      assert.equal(bobAck.memberCount, 2);

      // Alice should receive a presence.joined envelope carrying Bob.
      const envelope = await aliceSeesBob;
      assert.equal(envelope.payload.displayName, 'Bob');
      assert.equal(envelope.actor?.code, 'USR-BOB');
      assert.equal(envelope.processCode, 'PRC-TEST-0001');
      assert.equal(envelope.requestId, 'REQ-TEST');
    } finally {
      alice.disconnect();
      bob.disconnect();
    }
  });

  it('disconnect causes the remaining member to receive presence.left', async () => {
    const alice = connectClient(harness.url, {
      userId: 'u-alice-2',
      userCode: 'USR-ALICE2',
      email: 'alice2@example.com',
      displayName: 'Alice2',
    });
    const bob = connectClient(harness.url, {
      userId: 'u-bob-2',
      userCode: 'USR-BOB2',
      email: 'bob2@example.com',
      displayName: 'Bob2',
    });

    try {
      await Promise.all([
        new Promise<void>((resolve, reject) => {
          alice.once('connect', () => resolve());
          alice.once('connect_error', reject);
        }),
        new Promise<void>((resolve, reject) => {
          bob.once('connect', () => resolve());
          bob.once('connect_error', reject);
        }),
      ]);

      await new Promise<{ ok: boolean }>((resolve) => {
        alice.emit('presence.join', { processCode: 'PRC-TEST-0002' }, resolve);
      });
      await new Promise<{ ok: boolean }>((resolve) => {
        bob.emit('presence.join', { processCode: 'PRC-TEST-0002' }, resolve);
      });

      const aliceSeesBobLeave = waitFor(
        alice,
        'ses.event',
        (env) =>
          env.event === 'presence.left' &&
          (env.payload as { userCode: string }).userCode === 'USR-BOB2',
      );

      bob.disconnect();

      const envelope = await aliceSeesBobLeave;
      assert.equal(envelope.processCode, 'PRC-TEST-0002');
    } finally {
      alice.disconnect();
      bob.disconnect();
    }
  });

  it('events in process A do not leak to process B', async () => {
    const aliceInA = connectClient(harness.url, {
      userId: 'u-alice-3',
      userCode: 'USR-ALICE3',
      email: 'alice3@example.com',
      displayName: 'Alice3',
    });
    const bobInB = connectClient(harness.url, {
      userId: 'u-bob-3',
      userCode: 'USR-BOB3',
      email: 'bob3@example.com',
      displayName: 'Bob3',
    });

    try {
      await Promise.all([
        new Promise<void>((resolve, reject) => {
          aliceInA.once('connect', () => resolve());
          aliceInA.once('connect_error', reject);
        }),
        new Promise<void>((resolve, reject) => {
          bobInB.once('connect', () => resolve());
          bobInB.once('connect_error', reject);
        }),
      ]);

      await new Promise<{ ok: boolean }>((resolve) => {
        aliceInA.emit('presence.join', { processCode: 'PRC-ISOLATED-A' }, resolve);
      });

      let bobReceivedUnexpected = false;
      bobInB.on('ses.event', (env: RealtimeEnvelope) => {
        if (env.event === 'presence.joined' && env.processCode === 'PRC-ISOLATED-A') {
          bobReceivedUnexpected = true;
        }
      });

      await new Promise<{ ok: boolean }>((resolve) => {
        bobInB.emit('presence.join', { processCode: 'PRC-ISOLATED-B' }, resolve);
      });

      // Give the system time to deliver any cross-process leak if one existed.
      await new Promise((resolve) => setTimeout(resolve, 200));
      assert.equal(bobReceivedUnexpected, false, 'presence event leaked across processes');
    } finally {
      aliceInA.disconnect();
      bobInB.disconnect();
    }
  });
});

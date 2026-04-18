import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { PresenceRegistry } from '../src/realtime/presence.registry';
import type { PresenceInfo } from '../src/realtime/realtime.types';

/**
 * Pure-logic tests for the presence tracker.
 *
 * No network, no Socket.IO, no Nest — this verifies the state transitions that
 * the gateway relies on: join, leave, move, heartbeat, snapshot, and the
 * cleanup invariant that disconnecting a socket also removes it from its
 * process bucket.
 */

function makeMember(overrides: Partial<PresenceInfo> = {}): PresenceInfo {
  const now = new Date().toISOString();
  return {
    userId: overrides.userId ?? 'u-alice',
    userCode: overrides.userCode ?? 'USR-000001',
    displayName: overrides.displayName ?? 'Alice',
    email: overrides.email ?? 'alice@example.com',
    socketId: overrides.socketId ?? 'sock-1',
    tab: overrides.tab,
    focusCode: overrides.focusCode,
    connectedAt: overrides.connectedAt ?? now,
    lastHeartbeat: overrides.lastHeartbeat ?? now,
  };
}

describe('PresenceRegistry', () => {
  it('tracks a single joiner and returns the correct snapshot', () => {
    const r = new PresenceRegistry();
    const result = r.join('PRC-2026-0001', makeMember());
    assert.equal(result.length, 1);
    assert.equal(result[0]?.userCode, 'USR-000001');
    assert.deepEqual(r.snapshot('PRC-2026-0001').map((m) => m.socketId), ['sock-1']);
    assert.deepEqual(r.stats(), { processes: 1, sockets: 1 });
  });

  it('accumulates multiple members on the same process', () => {
    const r = new PresenceRegistry();
    r.join('PRC-2026-0001', makeMember({ socketId: 's1', userCode: 'USR-000001' }));
    r.join('PRC-2026-0001', makeMember({ socketId: 's2', userCode: 'USR-000002', displayName: 'Bob' }));
    r.join('PRC-2026-0001', makeMember({ socketId: 's3', userCode: 'USR-000003', displayName: 'Carol' }));
    const snapshot = r.snapshot('PRC-2026-0001');
    assert.equal(snapshot.length, 3);
    assert.deepEqual(
      snapshot.map((m) => m.socketId).sort(),
      ['s1', 's2', 's3'],
    );
  });

  it('isolates members across different processes', () => {
    const r = new PresenceRegistry();
    r.join('PRC-A', makeMember({ socketId: 's1' }));
    r.join('PRC-B', makeMember({ socketId: 's2', userCode: 'USR-000002' }));
    assert.equal(r.snapshot('PRC-A').length, 1);
    assert.equal(r.snapshot('PRC-B').length, 1);
    assert.equal(r.snapshot('PRC-C').length, 0);
  });

  it('returns the same user on multiple sockets as distinct entries', () => {
    // Two browser tabs for the same person -> two presence rows. The UI
    // de-duplicates by userCode; the registry should not.
    const r = new PresenceRegistry();
    r.join('PRC-A', makeMember({ socketId: 's1' }));
    r.join('PRC-A', makeMember({ socketId: 's2' }));
    const snapshot = r.snapshot('PRC-A');
    assert.equal(snapshot.length, 2);
    assert.deepEqual(snapshot.map((m) => m.socketId).sort(), ['s1', 's2']);
  });

  it('removes a member on leave and reports which process it left', () => {
    const r = new PresenceRegistry();
    r.join('PRC-A', makeMember({ socketId: 's1', userCode: 'USR-000001' }));
    r.join('PRC-A', makeMember({ socketId: 's2', userCode: 'USR-000002' }));
    const result = r.leave('s1');
    assert.ok(result);
    assert.equal(result!.processCode, 'PRC-A');
    assert.equal(result!.info.userCode, 'USR-000001');
    assert.equal(r.snapshot('PRC-A').length, 1);
  });

  it('tears down an empty process bucket when the last member leaves', () => {
    const r = new PresenceRegistry();
    r.join('PRC-A', makeMember({ socketId: 's1' }));
    r.leave('s1');
    assert.deepEqual(r.stats(), { processes: 0, sockets: 0 });
    assert.equal(r.snapshot('PRC-A').length, 0);
  });

  it('returns null when leaving an unknown socket (idempotent)', () => {
    const r = new PresenceRegistry();
    assert.equal(r.leave('does-not-exist'), null);
    // Still leaves a clean state.
    assert.deepEqual(r.stats(), { processes: 0, sockets: 0 });
  });

  it('updates tab and focusCode via move() and bumps lastHeartbeat', async () => {
    const r = new PresenceRegistry();
    r.join('PRC-A', makeMember({ socketId: 's1', tab: 'preview' }));
    const before = r.snapshot('PRC-A')[0]!.lastHeartbeat;
    await new Promise((resolve) => setTimeout(resolve, 5));
    const moved = r.move('s1', { tab: 'tracking', focusCode: 'ISS-RUN-PRC-A-00001' });
    assert.ok(moved);
    assert.equal(moved!.tab, 'tracking');
    assert.equal(moved!.focusCode, 'ISS-RUN-PRC-A-00001');
    assert.notEqual(moved!.lastHeartbeat, before);
  });

  it('move() returns null for an unknown socket', () => {
    const r = new PresenceRegistry();
    assert.equal(r.move('ghost', { tab: 'preview' }), null);
  });

  it('heartbeat() updates lastHeartbeat without changing membership', async () => {
    const r = new PresenceRegistry();
    r.join('PRC-A', makeMember({ socketId: 's1' }));
    const before = r.snapshot('PRC-A')[0]!.lastHeartbeat;
    await new Promise((resolve) => setTimeout(resolve, 5));
    r.heartbeat('s1');
    const after = r.snapshot('PRC-A')[0]!.lastHeartbeat;
    assert.notEqual(before, after);
    assert.equal(r.snapshot('PRC-A').length, 1);
  });

  it('ignores heartbeat for an unknown socket (no throw)', () => {
    const r = new PresenceRegistry();
    assert.doesNotThrow(() => r.heartbeat('ghost'));
  });

  it('supports the full join -> move -> leave lifecycle for one user', () => {
    const r = new PresenceRegistry();
    r.join('PRC-A', makeMember({ socketId: 's1', userCode: 'USR-001', tab: 'preview' }));
    r.move('s1', { tab: 'results' });
    r.move('s1', { tab: 'tracking', focusCode: 'ISS-X' });
    const snapshot = r.snapshot('PRC-A');
    assert.equal(snapshot[0]!.tab, 'tracking');
    assert.equal(snapshot[0]!.focusCode, 'ISS-X');
    const leaveResult = r.leave('s1');
    assert.equal(leaveResult?.info.userCode, 'USR-001');
    assert.equal(r.snapshot('PRC-A').length, 0);
  });
});

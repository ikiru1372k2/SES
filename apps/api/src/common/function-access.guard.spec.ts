import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import type { ExecutionContext } from '@nestjs/common';
import { FunctionAccessGuard } from './function-access.guard';

/**
 * F15: the guard must fail closed by HTTP method — a state-changing request
 * on a process-scoped route must require at least `editor`, not `viewer`.
 * We assert the minimum permission the guard passes to
 * findAccessibleProcessOrThrow for GET vs PATCH/DELETE.
 */
function makeGuard() {
  const calls: Array<{ param: string; min: string }> = [];
  const processAccess = {
    findAccessibleProcessOrThrow: async (_user: unknown, param: string, min: string) => {
      calls.push({ param, min });
      return { id: 'proc-1' };
    },
    assertCanAccessProcess: async () => undefined,
  };
  const functions = { isEnabled: async () => true };
  const accessScope = { require: async () => undefined };
  const reflector = { getAllAndOverride: () => undefined };
  const guard = new FunctionAccessGuard(
    {} as never,
    processAccess as never,
    functions as never,
    accessScope as never,
    reflector as never,
  );
  return { guard, calls };
}

function ctxFor(method: string): ExecutionContext {
  const request = {
    user: { id: 'u1' },
    method,
    params: { idOrCode: 'PRC-1' },
    originalUrl: '/api/v1/processes/PRC-1',
  };
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => undefined,
    getClass: () => undefined,
  } as unknown as ExecutionContext;
}

describe('FunctionAccessGuard (F15 — method-aware minimum permission)', () => {
  it('requires only viewer for GET', async () => {
    const { guard, calls } = makeGuard();
    await guard.canActivate(ctxFor('GET'));
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.min, 'viewer');
  });

  it('requires editor for PATCH', async () => {
    const { guard, calls } = makeGuard();
    await guard.canActivate(ctxFor('PATCH'));
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.min, 'editor');
  });

  it('requires editor for DELETE', async () => {
    const { guard, calls } = makeGuard();
    await guard.canActivate(ctxFor('DELETE'));
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.min, 'editor');
  });

  it('requires editor for POST', async () => {
    const { guard, calls } = makeGuard();
    await guard.canActivate(ctxFor('POST'));
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.min, 'editor');
  });
});

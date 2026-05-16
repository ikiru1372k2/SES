import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { ForbiddenException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import { CsrfGuard } from './csrf.guard';

/**
 * F7 coverage. The guard lifts under NODE_ENV=test (so the e2e harness
 * keeps working), so we exercise its real accept/deny logic here with the
 * env override removed.
 */
function ctx(req: {
  method: string;
  path?: string;
  url?: string;
  headers?: Record<string, string>;
}): ExecutionContext {
  const request = { headers: {}, ...req };
  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

describe('CsrfGuard', () => {
  const guard = new CsrfGuard();
  let savedEnv: string | undefined;

  beforeEach(() => {
    savedEnv = process.env.NODE_ENV;
    // Force non-test so the guard's real logic runs.
    process.env.NODE_ENV = 'production';
  });
  afterEach(() => {
    process.env.NODE_ENV = savedEnv;
  });

  it('allows safe methods without the header', () => {
    assert.equal(guard.canActivate(ctx({ method: 'GET', path: '/api/v1/processes' })), true);
  });

  it('blocks a cookie POST with no X-Requested-With header', () => {
    assert.throws(
      () => guard.canActivate(ctx({ method: 'POST', path: '/api/v1/processes' })),
      ForbiddenException,
    );
  });

  it('allows a POST that carries X-Requested-With: ses', () => {
    assert.equal(
      guard.canActivate(
        ctx({
          method: 'POST',
          path: '/api/v1/processes',
          headers: { 'x-requested-with': 'ses' },
        }),
      ),
      true,
    );
  });

  it('allows a Bearer-authenticated POST (token auth is not ambient)', () => {
    assert.equal(
      guard.canActivate(
        ctx({
          method: 'POST',
          path: '/api/v1/processes',
          headers: { authorization: 'Bearer abc.def.ghi' },
        }),
      ),
      true,
    );
  });

  it('exempts the public manager-response endpoint', () => {
    assert.equal(
      guard.canActivate(
        ctx({ method: 'POST', path: '/api/v1/public/respond/sometoken' }),
      ),
      true,
    );
  });

  it('exempts login / signup (no session cookie exists yet)', () => {
    assert.equal(guard.canActivate(ctx({ method: 'POST', path: '/api/v1/auth/login' })), true);
    assert.equal(guard.canActivate(ctx({ method: 'POST', path: '/api/v1/auth/signup' })), true);
  });

  it('still protects logout (SPA sends the header)', () => {
    assert.throws(
      () => guard.canActivate(ctx({ method: 'POST', path: '/api/v1/auth/logout' })),
      ForbiddenException,
    );
  });

  it('lifts entirely under NODE_ENV=test', () => {
    process.env.NODE_ENV = 'test';
    assert.equal(guard.canActivate(ctx({ method: 'POST', path: '/api/v1/processes' })), true);
  });
});

import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import {
  AccessScopeService,
  type ScopeContext,
  type ScopeRow,
} from './access-scope.service';

// The resolver is pure — passing a stubbed prisma is fine because we never
// touch it from resolve(). Other AccessScopeService methods (load/replace)
// are exercised by the e2e suite.
const service = new AccessScopeService({} as never);

function ctx(kind: ScopeContext['kind'], action: 'view' | 'edit', functionId?: string): ScopeContext {
  return functionId ? { kind, action, functionId: functionId as never } : { kind, action };
}

describe('AccessScopeService.resolve — legacy fallback (no scope rows)', () => {
  const noScopes: ScopeRow[] = [];

  it('viewer member viewing a function → allow', () => {
    const r = service.resolve({ member: { permission: 'viewer' }, scopes: noScopes, ctx: ctx('function', 'view', 'master-data') });
    assert.equal(r.allowed, true);
  });

  it('viewer member editing → deny', () => {
    const r = service.resolve({ member: { permission: 'viewer' }, scopes: noScopes, ctx: ctx('function', 'edit', 'master-data') });
    assert.equal(r.allowed, false);
  });

  it('editor member editing a function → allow', () => {
    const r = service.resolve({ member: { permission: 'editor' }, scopes: noScopes, ctx: ctx('function', 'edit', 'over-planning') });
    assert.equal(r.allowed, true);
  });
});

describe('AccessScopeService.resolve — owner short-circuit', () => {
  it('owner allowed regardless of context', () => {
    const r = service.resolve({
      member: { permission: 'owner' },
      // Even with bogus restrictive scope rows, owner always wins.
      scopes: [{ scopeType: 'function', functionId: 'master-data', accessLevel: 'viewer' }],
      ctx: ctx('function', 'edit', 'over-planning'),
    });
    assert.equal(r.allowed, true);
  });
});

describe('AccessScopeService.resolve — scoped function permissions', () => {
  const scopes: ScopeRow[] = [
    { scopeType: 'function', functionId: 'master-data', accessLevel: 'editor' },
  ];

  it('editor on the scoped function → allow', () => {
    const r = service.resolve({ member: { permission: 'viewer' }, scopes, ctx: ctx('function', 'edit', 'master-data') });
    assert.equal(r.allowed, true);
  });

  it('GET on a non-scoped function → deny (no all-functions row)', () => {
    const r = service.resolve({ member: { permission: 'viewer' }, scopes, ctx: ctx('function', 'view', 'over-planning') });
    assert.equal(r.allowed, false);
  });

  it('GET on the escalation center → deny (no escalation row)', () => {
    const r = service.resolve({ member: { permission: 'viewer' }, scopes, ctx: ctx('escalation-center', 'view') });
    assert.equal(r.allowed, false);
  });
});

describe('AccessScopeService.resolve — all-functions floor', () => {
  const scopes: ScopeRow[] = [
    { scopeType: 'all-functions', functionId: null, accessLevel: 'viewer' },
  ];

  it('viewer floor lets read on any function', () => {
    const r = service.resolve({ member: { permission: 'viewer' }, scopes, ctx: ctx('function', 'view', 'function-rate') });
    assert.equal(r.allowed, true);
  });

  it('viewer floor blocks edit on any function', () => {
    const r = service.resolve({ member: { permission: 'editor' }, scopes, ctx: ctx('function', 'edit', 'function-rate') });
    assert.equal(r.allowed, false);
  });

  it('most permissive of all-functions + per-function wins', () => {
    const mixed: ScopeRow[] = [
      { scopeType: 'all-functions', functionId: null, accessLevel: 'viewer' },
      { scopeType: 'function', functionId: 'master-data', accessLevel: 'editor' },
    ];
    const r = service.resolve({ member: { permission: 'viewer' }, scopes: mixed, ctx: ctx('function', 'edit', 'master-data') });
    assert.equal(r.allowed, true);
  });
});

describe('AccessScopeService.resolve — escalation-center scope', () => {
  it('escalation-only viewer can view escalations', () => {
    const scopes: ScopeRow[] = [{ scopeType: 'escalation-center', functionId: null, accessLevel: 'viewer' }];
    const r = service.resolve({ member: { permission: 'viewer' }, scopes, ctx: ctx('escalation-center', 'view') });
    assert.equal(r.allowed, true);
  });

  it('escalation-only viewer cannot view function files', () => {
    const scopes: ScopeRow[] = [{ scopeType: 'escalation-center', functionId: null, accessLevel: 'viewer' }];
    const r = service.resolve({ member: { permission: 'viewer' }, scopes, ctx: ctx('function', 'view', 'master-data') });
    assert.equal(r.allowed, false);
  });

  it('legacy editor permission is overridden once escalation scope exists', () => {
    // Member has a base 'editor' permission but only an escalation scope row.
    // For function routes we should deny because scoped configuration is in
    // effect and there is no function/all-functions grant.
    const scopes: ScopeRow[] = [{ scopeType: 'escalation-center', functionId: null, accessLevel: 'viewer' }];
    const r = service.resolve({ member: { permission: 'editor' }, scopes, ctx: ctx('function', 'view', 'master-data') });
    assert.equal(r.allowed, false);
  });
});

describe('AccessScopeService.resolve — process-wide non-function context', () => {
  it('any scoped member can view process-wide pages', () => {
    const scopes: ScopeRow[] = [{ scopeType: 'function', functionId: 'master-data', accessLevel: 'viewer' }];
    const r = service.resolve({ member: { permission: 'viewer' }, scopes, ctx: ctx('all-functions', 'view') });
    assert.equal(r.allowed, true);
  });

  it('process-wide edit requires all-functions row or owner', () => {
    const scopes: ScopeRow[] = [{ scopeType: 'function', functionId: 'master-data', accessLevel: 'editor' }];
    const r = service.resolve({ member: { permission: 'viewer' }, scopes, ctx: ctx('all-functions', 'edit') });
    assert.equal(r.allowed, false);
  });

  it('process-wide edit allowed with all-functions:editor', () => {
    const scopes: ScopeRow[] = [{ scopeType: 'all-functions', functionId: null, accessLevel: 'editor' }];
    const r = service.resolve({ member: { permission: 'viewer' }, scopes, ctx: ctx('all-functions', 'edit') });
    assert.equal(r.allowed, true);
  });
});

describe('AccessScopeService.resolve — function context without functionId', () => {
  it('rejects when caller forgot to attach functionId', () => {
    const r = service.resolve({
      member: { permission: 'viewer' },
      scopes: [{ scopeType: 'function', functionId: 'master-data', accessLevel: 'editor' }],
      ctx: ctx('function', 'view'),
    });
    assert.equal(r.allowed, false);
  });
});

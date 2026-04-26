import { describe, expect, it } from 'vitest';
import { computeAccess } from '../useEffectiveAccess';
import type { EffectiveAccess } from '../../lib/api/processAccessApi';

// Locks parity with apps/api/src/common/access-scope.service.ts:resolve. If a
// case here changes, the server resolver must move with it (and vice versa).
describe('computeAccess', () => {
  const fid = 'master-data';
  const otherFid = 'over-planning';

  describe('owner bypass', () => {
    it('owner is allowed regardless of scopes/action/kind', () => {
      const access: EffectiveAccess = { permission: 'owner', scopes: [] };
      expect(computeAccess(access, { kind: 'function', functionId: fid, action: 'edit' })).toBe(true);
      expect(computeAccess(access, { kind: 'escalation-center', action: 'edit' })).toBe(true);
      expect(computeAccess(access, { kind: 'all-functions', action: 'edit' })).toBe(true);
    });
  });

  describe('legacy fallback (no scope rows)', () => {
    it('editor passes view + edit', () => {
      const access: EffectiveAccess = { permission: 'editor', scopes: [] };
      expect(computeAccess(access, { kind: 'function', functionId: fid, action: 'view' })).toBe(true);
      expect(computeAccess(access, { kind: 'function', functionId: fid, action: 'edit' })).toBe(true);
    });

    it('viewer passes view but not edit', () => {
      const access: EffectiveAccess = { permission: 'viewer', scopes: [] };
      expect(computeAccess(access, { kind: 'function', functionId: fid, action: 'view' })).toBe(true);
      expect(computeAccess(access, { kind: 'function', functionId: fid, action: 'edit' })).toBe(false);
    });
  });

  describe('function scope', () => {
    it('function-viewer can view that function but not edit', () => {
      const access: EffectiveAccess = {
        permission: 'editor',
        scopes: [{ scopeType: 'function', functionId: fid, accessLevel: 'viewer' }],
      };
      expect(computeAccess(access, { kind: 'function', functionId: fid, action: 'view' })).toBe(true);
      expect(computeAccess(access, { kind: 'function', functionId: fid, action: 'edit' })).toBe(false);
    });

    it('function-editor can edit that function only', () => {
      const access: EffectiveAccess = {
        permission: 'editor',
        scopes: [{ scopeType: 'function', functionId: fid, accessLevel: 'editor' }],
      };
      expect(computeAccess(access, { kind: 'function', functionId: fid, action: 'edit' })).toBe(true);
      expect(computeAccess(access, { kind: 'function', functionId: otherFid, action: 'view' })).toBe(false);
    });

    it('all-functions:editor unlocks every function', () => {
      const access: EffectiveAccess = {
        permission: 'editor',
        scopes: [{ scopeType: 'all-functions', functionId: null, accessLevel: 'editor' }],
      };
      expect(computeAccess(access, { kind: 'function', functionId: fid, action: 'edit' })).toBe(true);
      expect(computeAccess(access, { kind: 'function', functionId: otherFid, action: 'edit' })).toBe(true);
    });

    it('most permissive matching scope wins (function:viewer + all-functions:editor → editor)', () => {
      const access: EffectiveAccess = {
        permission: 'editor',
        scopes: [
          { scopeType: 'function', functionId: fid, accessLevel: 'viewer' },
          { scopeType: 'all-functions', functionId: null, accessLevel: 'editor' },
        ],
      };
      expect(computeAccess(access, { kind: 'function', functionId: fid, action: 'edit' })).toBe(true);
    });
  });

  describe('escalation-center scope', () => {
    it('escalation-viewer can view escalations but not edit', () => {
      const access: EffectiveAccess = {
        permission: 'editor',
        scopes: [{ scopeType: 'escalation-center', functionId: null, accessLevel: 'viewer' }],
      };
      expect(computeAccess(access, { kind: 'escalation-center', action: 'view' })).toBe(true);
      expect(computeAccess(access, { kind: 'escalation-center', action: 'edit' })).toBe(false);
    });

    it('escalation-only scope denies function access', () => {
      const access: EffectiveAccess = {
        permission: 'editor',
        scopes: [{ scopeType: 'escalation-center', functionId: null, accessLevel: 'editor' }],
      };
      expect(computeAccess(access, { kind: 'function', functionId: fid, action: 'view' })).toBe(false);
    });
  });

  describe('all-functions kind (process-wide non-function routes)', () => {
    it('view is allowed if any scope row exists', () => {
      const access: EffectiveAccess = {
        permission: 'editor',
        scopes: [{ scopeType: 'function', functionId: fid, accessLevel: 'viewer' }],
      };
      expect(computeAccess(access, { kind: 'all-functions', action: 'view' })).toBe(true);
    });

    it('edit requires an all-functions row', () => {
      const onlyFunction: EffectiveAccess = {
        permission: 'editor',
        scopes: [{ scopeType: 'function', functionId: fid, accessLevel: 'editor' }],
      };
      expect(computeAccess(onlyFunction, { kind: 'all-functions', action: 'edit' })).toBe(false);

      const withAll: EffectiveAccess = {
        permission: 'editor',
        scopes: [{ scopeType: 'all-functions', functionId: null, accessLevel: 'editor' }],
      };
      expect(computeAccess(withAll, { kind: 'all-functions', action: 'edit' })).toBe(true);
    });
  });
});

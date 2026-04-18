import { strict as assert } from 'node:assert';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { SignedLinkTokenService } from '../src/signed-links/signed-link-token.service';

describe('SignedLinkTokenService', () => {
  let svc: SignedLinkTokenService;
  let originalSecret: string | undefined;

  beforeEach(() => {
    originalSecret = process.env.SES_AUTH_SECRET;
    process.env.SES_AUTH_SECRET = 'x'.repeat(48); // 48 chars — well above prod minimum
    svc = new SignedLinkTokenService();
  });

  afterEach(() => {
    if (originalSecret === undefined) delete process.env.SES_AUTH_SECRET;
    else process.env.SES_AUTH_SECRET = originalSecret;
  });

  it('issues a verifiable token with the expected payload', () => {
    const issued = svc.issue({
      processCode: 'PRC-2026-0001',
      issueKey: 'IKY-ABC123',
      managerEmail: 'alice@example.com',
      allowedActions: ['acknowledge', 'correct'],
    });
    const verified = svc.verify(issued.token);
    assert.ok(verified, 'token should verify');
    assert.equal(verified!.proc, 'PRC-2026-0001');
    assert.equal(verified!.iky, 'IKY-ABC123');
    assert.equal(verified!.mgr, 'alice@example.com');
    assert.deepEqual(verified!.acts, ['acknowledge', 'correct']);
    assert.equal(verified!.v, 1);
    assert.equal(verified!.purp, 'manager_response');
    assert.ok(verified!.exp > Math.floor(Date.now() / 1000));
  });

  it('normalises manager email to lowercase and trimmed', () => {
    const issued = svc.issue({
      processCode: 'PRC-1',
      managerEmail: '  MixedCase@Example.com  ',
      allowedActions: ['acknowledge'],
    });
    assert.equal(issued.payload.mgr, 'mixedcase@example.com');
  });

  it('rejects a token tampered in the payload portion', () => {
    const issued = svc.issue({
      processCode: 'PRC-1',
      managerEmail: 'alice@example.com',
      allowedActions: ['acknowledge'],
    });
    const [payloadPart, sigPart] = issued.token.split('.');
    // Flip one character in the payload — signature no longer matches.
    const flipped = payloadPart!.slice(0, -1) + (payloadPart!.slice(-1) === 'A' ? 'B' : 'A');
    const tampered = `${flipped}.${sigPart}`;
    assert.equal(svc.verify(tampered), null);
  });

  it('rejects a token tampered in the signature portion', () => {
    const issued = svc.issue({
      processCode: 'PRC-1',
      managerEmail: 'alice@example.com',
      allowedActions: ['acknowledge'],
    });
    const [payloadPart, sigPart] = issued.token.split('.');
    const flipped = sigPart!.slice(0, -1) + (sigPart!.slice(-1) === 'X' ? 'Y' : 'X');
    const tampered = `${payloadPart}.${flipped}`;
    assert.equal(svc.verify(tampered), null);
  });

  it('rejects a token signed with a different secret', () => {
    const attackerSvc = new SignedLinkTokenService();
    process.env.SES_AUTH_SECRET = 'y'.repeat(48);
    const issued = attackerSvc.issue({
      processCode: 'PRC-1',
      managerEmail: 'alice@example.com',
      allowedActions: ['acknowledge'],
    });
    // Restore our secret; attacker's token should not verify against ours.
    process.env.SES_AUTH_SECRET = 'x'.repeat(48);
    const result = new SignedLinkTokenService().verify(issued.token);
    assert.equal(result, null);
  });

  it('rejects an expired token', () => {
    const issued = svc.issue({
      processCode: 'PRC-1',
      managerEmail: 'alice@example.com',
      allowedActions: ['acknowledge'],
      ttlSeconds: -1, // already expired
    });
    assert.equal(svc.verify(issued.token), null);
  });

  it('rejects a completely bogus string', () => {
    assert.equal(svc.verify('not.a.token.at.all'), null);
    assert.equal(svc.verify(''), null);
    assert.equal(svc.verify('abc'), null);
    assert.equal(svc.verify('.'), null);
  });

  it('returns a stable SHA-256 hash for DB storage', () => {
    const issued = svc.issue({
      processCode: 'PRC-1',
      managerEmail: 'alice@example.com',
      allowedActions: ['acknowledge'],
    });
    const directHash = svc.hashFor(issued.token);
    assert.deepEqual(issued.tokenHash, directHash);
    assert.equal(directHash.length, 32);
  });

  it('generates unique jti for concurrent issuance', () => {
    const tokens = new Set<string>();
    const jtis = new Set<string>();
    for (let i = 0; i < 100; i++) {
      const issued = svc.issue({
        processCode: 'PRC-1',
        managerEmail: 'a@b.com',
        allowedActions: ['acknowledge'],
      });
      tokens.add(issued.token);
      jtis.add(issued.payload.jti);
    }
    assert.equal(tokens.size, 100, 'every token must be unique');
    assert.equal(jtis.size, 100, 'every jti must be unique');
  });

  it('uses default TTL of 14 days when not specified', () => {
    const issued = svc.issue({
      processCode: 'PRC-1',
      managerEmail: 'alice@example.com',
      allowedActions: ['acknowledge'],
    });
    const now = Math.floor(Date.now() / 1000);
    const delta = issued.payload.exp - now;
    // Allow a 10s test jitter window.
    assert.ok(delta > 14 * 24 * 60 * 60 - 10 && delta <= 14 * 24 * 60 * 60, `TTL delta = ${delta}`);
  });

  it('respects a custom TTL', () => {
    const issued = svc.issue({
      processCode: 'PRC-1',
      managerEmail: 'alice@example.com',
      allowedActions: ['acknowledge'],
      ttlSeconds: 3600,
    });
    const now = Math.floor(Date.now() / 1000);
    const delta = issued.payload.exp - now;
    assert.ok(delta > 3590 && delta <= 3600, `TTL delta = ${delta}`);
  });
});

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { aiPilotObjectKey, sanitizeFileName } from '../src/object-storage';

describe('object key generation', () => {
  it('shapes the AI Pilot key as ai-pilot/{tenant}/{session}/{ulid}-{name}', () => {
    const key = aiPilotObjectKey({
      tenantId: 'ses-tenant-default',
      sessionId: '01H...SESSION',
      fileName: 'sample.xlsx',
    });
    assert.match(
      key,
      /^ai-pilot\/ses-tenant-default\/01H\.\.\.SESSION\/[0-9A-HJKMNP-TV-Z]{26}-sample.xlsx$/,
    );
  });

  it('sanitizes unsafe filename characters', () => {
    assert.equal(sanitizeFileName('../etc/passwd'), 'etc-passwd');
    assert.equal(sanitizeFileName('hello world (1).pdf'), 'hello-world-1-.pdf');
    assert.equal(sanitizeFileName('  '), 'file');
  });

  it('avoids collisions for repeated upload of the same name', () => {
    const a = aiPilotObjectKey({ tenantId: 't', sessionId: 's', fileName: 'a.pdf' });
    const b = aiPilotObjectKey({ tenantId: 't', sessionId: 's', fileName: 'a.pdf' });
    assert.notEqual(a, b, 'two consecutive keys must differ via the embedded ULID');
  });

  it('caps overly long filenames', () => {
    const long = 'x'.repeat(500) + '.pdf';
    const key = aiPilotObjectKey({ tenantId: 't', sessionId: 's', fileName: long });
    const last = key.split('/').pop()!;
    const safeName = last.split('-').slice(1).join('-');
    assert.ok(safeName.length <= 120);
  });
});

import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { matchRawNameToDirectoryEntries } from '../src/modules/directory/directory-matching';

describe('matchRawNameToDirectoryEntries', () => {
  it('returns no autoMatch for empty raw name', () => {
    const r = matchRawNameToDirectoryEntries('  ', [
      {
        id: '1',
        email: 'a@x.com',
        firstName: 'A',
        lastName: 'B',
        normalizedKey: 'a b',
        aliases: [],
        active: true,
      },
    ]);
    assert.equal(r.autoMatch, null);
    assert.equal(r.collision, false);
    assert.equal(r.candidates.length, 0);
  });

  it('auto-accepts a single strong match', () => {
    const r = matchRawNameToDirectoryEntries('Jane Doe', [
      {
        id: '1',
        email: 'jane@x.com',
        firstName: 'Jane',
        lastName: 'Doe',
        normalizedKey: 'doe jane',
        aliases: [],
        active: true,
      },
    ]);
    assert.ok(r.autoMatch);
    assert.equal(r.autoMatch!.id, '1');
    assert.equal(r.collision, false);
  });

  it('detects collision when two different emails tie within delta', () => {
    const r = matchRawNameToDirectoryEntries('John Smith', [
      {
        id: '1',
        email: 'a@x.com',
        firstName: 'John',
        lastName: 'Smith',
        normalizedKey: 'john smith',
        aliases: [],
        active: true,
      },
      {
        id: '2',
        email: 'b@x.com',
        firstName: 'John',
        lastName: 'Smith',
        normalizedKey: 'john smith',
        aliases: [],
        active: true,
      },
    ]);
    assert.equal(r.autoMatch, null);
    assert.equal(r.collision, true);
    assert.ok(r.candidates.length >= 2);
  });

  it('uses alias text for scoring', () => {
    const r = matchRawNameToDirectoryEntries('Johnny', [
      {
        id: '1',
        email: 'j@x.com',
        firstName: 'John',
        lastName: 'Doe',
        normalizedKey: 'doe john',
        aliases: ['Johnny'],
        active: true,
      },
    ]);
    assert.ok(r.autoMatch);
    assert.equal(r.autoMatch!.id, '1');
  });
});

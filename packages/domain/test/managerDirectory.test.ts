import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  detectColumnMapping,
  matchDirectoryExact,
  normalizeManagerKey,
  normalizeObservedManagerLabel,
  parseTsvRows,
} from '../src/reporting/managerDirectory.js';

describe('normalizeManagerKey', () => {
  it('orders tokens deterministically', () => {
    assert.equal(normalizeManagerKey('John', 'Smith'), normalizeManagerKey('Smith', 'John'));
    assert.equal(normalizeManagerKey('  John  ', 'SMITH'), 'john smith');
  });

  it('strips accents', () => {
    assert.equal(normalizeManagerKey('José', 'García'), 'garcia jose');
  });
});

describe('normalizeObservedManagerLabel', () => {
  it('matches manager key for full name string', () => {
    const key = normalizeManagerKey('Jane', 'Doe');
    const obs = normalizeObservedManagerLabel('Doe, Jane');
    assert.equal(key, 'doe jane');
    assert.equal(obs, key);
  });
});

describe('parseTsvRows', () => {
  it('parses tab-separated with header', () => {
    const text = 'First Name\tLast Name\tEmail\nJane\tDoe\tj@ex.com\n';
    const { headers, rows } = parseTsvRows(text);
    assert.deepEqual(headers, ['First Name', 'Last Name', 'Email']);
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!['Email'], 'j@ex.com');
  });

  it('handles windows newlines', () => {
    const { rows } = parseTsvRows('a\tb\r\nc\td');
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.a, 'c');
    assert.equal(rows[0]!.b, 'd');
  });
});

describe('detectColumnMapping', () => {
  it('detects common header variants', () => {
    const headers = ['first_name', 'LastName', 'Given Name', 'Work Email'];
    const m = detectColumnMapping(headers);
    assert.equal(m.firstName, 'first_name');
    assert.equal(m.lastName, 'LastName');
    assert.equal(m.email, 'Work Email');
  });
});

describe('matchDirectoryExact', () => {
  const entries = [
    {
      id: '1',
      normalizedKey: normalizeManagerKey('A', 'B'),
      aliases: ['typo b'],
      active: true,
    },
  ];

  it('hits normalizedKey', () => {
    const r = matchDirectoryExact(normalizeManagerKey('A', 'B'), entries);
    assert.equal(r.kind, 'hit');
    if (r.kind === 'hit') assert.equal(r.entryId, '1');
  });

  it('hits alias', () => {
    const r = matchDirectoryExact(normalizeObservedManagerLabel('typo b'), entries);
    assert.equal(r.kind, 'hit');
    if (r.kind === 'hit') assert.equal(r.reason, 'alias');
  });

  it('detects duplicate normalizedKey collision', () => {
    const dup = [
      { id: 'a', normalizedKey: 'x y', aliases: [], active: true },
      { id: 'b', normalizedKey: 'x y', aliases: [], active: true },
    ];
    const r = matchDirectoryExact('x y', dup);
    assert.equal(r.kind, 'collision');
  });
});

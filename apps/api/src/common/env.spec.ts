import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { parsePositiveIntEnv } from './env';

describe('parsePositiveIntEnv', () => {
  afterEach(() => {
    delete process.env.TEST_POSITIVE_INT;
  });

  it('falls back for missing, blank, invalid, and non-positive values', () => {
    assert.equal(parsePositiveIntEnv('TEST_POSITIVE_INT', 60_000), 60_000);
    process.env.TEST_POSITIVE_INT = '';
    assert.equal(parsePositiveIntEnv('TEST_POSITIVE_INT', 60_000), 60_000);
    process.env.TEST_POSITIVE_INT = 'nope';
    assert.equal(parsePositiveIntEnv('TEST_POSITIVE_INT', 60_000), 60_000);
    process.env.TEST_POSITIVE_INT = '0';
    assert.equal(parsePositiveIntEnv('TEST_POSITIVE_INT', 60_000), 60_000);
  });

  it('returns positive integer values', () => {
    process.env.TEST_POSITIVE_INT = '5000';
    assert.equal(parsePositiveIntEnv('TEST_POSITIVE_INT', 60_000), 5000);
  });
});

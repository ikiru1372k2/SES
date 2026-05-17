import { describe, expect, it } from 'vitest';
import { scorePassword } from '../passwordStrength';

describe('scorePassword', () => {
  it('returns an empty/zero result for an empty string', () => {
    const r = scorePassword('');
    expect(r.score).toBe(0);
    expect(r.label).toBe('');
    expect(r.width).toBe('0%');
  });

  it('rates a short trivial password as Weak', () => {
    const r = scorePassword('abc');
    expect(r.score).toBe(1);
    expect(r.label).toBe('Weak');
  });

  it('rates a mixed medium password in the Fair/Good range', () => {
    const r = scorePassword('abcd1234');
    expect(r.score).toBeGreaterThanOrEqual(2);
    expect(r.score).toBeLessThanOrEqual(3);
  });

  it('rates a long password with all character classes as Strong', () => {
    const r = scorePassword('Abcdef12345!@#');
    expect(r.score).toBe(4);
    expect(r.label).toBe('Strong');
    expect(r.width).toBe('100%');
  });

  it('always returns a non-empty label for any non-empty password', () => {
    for (const pw of ['x', '12', 'password', 'P@ss', 'aaaaaaaaaaaa']) {
      expect(scorePassword(pw).label).not.toBe('');
    }
  });
});

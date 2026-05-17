import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { endOfDay, formatDueDate } from './tracking-compose.helpers';

// `endOfDay` is the source of truth for the Escalation Center SLA: in
// TrackingComposeService.send(), `slaDueAt = endOfDay(body.deadlineAt) ??
// now + slaInitialHours`. These tests lock the mapping from the Compose
// "Due date" (a calendar day, no time) to the SLA instant.
describe('endOfDay', () => {
  it('maps a yyyy-mm-dd date to 23:59:59.999Z of that same UTC day', () => {
    const d = endOfDay('2026-05-22');
    assert.ok(d);
    assert.equal(d!.toISOString(), '2026-05-22T23:59:59.999Z');
  });

  it('keeps the picked calendar day when given a full ISO string', () => {
    // A midnight-UTC ISO (how `new Date("2026-05-22")` serialises) must not
    // roll back to the previous day.
    const d = endOfDay('2026-05-22T00:00:00.000Z');
    assert.ok(d);
    assert.equal(d!.toISOString(), '2026-05-22T23:59:59.999Z');
  });

  it('returns null for missing input so the caller falls back to slaInitialHours', () => {
    assert.equal(endOfDay(null), null);
    assert.equal(endOfDay(undefined), null);
    assert.equal(endOfDay(''), null);
  });

  it('returns null for an unparseable value', () => {
    assert.equal(endOfDay('not-a-date'), null);
  });

  it('a date 2 days out yields an SLA ~2 days away, not the 5-day default', () => {
    // Regression for: "I set due to 2 days in Compose but Escalation Center
    // still shows 5 d". With endOfDay driving slaDueAt, the countdown reflects
    // the picked date.
    const now = new Date('2026-05-17T10:00:00.000Z');
    const due = endOfDay('2026-05-19');
    assert.ok(due);
    const days = (due!.getTime() - now.getTime()) / (24 * 60 * 60 * 1000);
    assert.ok(days > 2 && days < 3, `expected ~2 days, got ${days}`);

    const fiveDayDefault = new Date(now.getTime() + 120 * 60 * 60 * 1000);
    assert.ok(
      due!.getTime() < fiveDayDefault.getTime(),
      'picked date must be earlier than the 120h slaInitialHours default',
    );
  });
});

describe('formatDueDate', () => {
  it('formats an ISO date for display', () => {
    assert.equal(formatDueDate('2026-05-22T23:59:59.999Z'), 'May 22, 2026');
  });

  it('returns empty string for missing/invalid input', () => {
    assert.equal(formatDueDate(null), '');
    assert.equal(formatDueDate(undefined), '');
    assert.equal(formatDueDate('not-a-date'), '');
  });
});

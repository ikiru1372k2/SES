import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { ProcessEscalationManagerRow } from '@ses/domain';
import { AnalyticsStrip } from '../AnalyticsStrip';

function row(
  p: Partial<ProcessEscalationManagerRow> &
    Pick<ProcessEscalationManagerRow, 'managerKey' | 'managerName'>,
): ProcessEscalationManagerRow {
  return {
    resolvedEmail: null,
    directoryEmail: null,
    directoryTeamsUsername: null,
    isUnmapped: false,
    totalIssues: 1,
    countsByEngine: {},
    findingsByEngine: {},
    stage: null,
    resolved: false,
    lastContactAt: null,
    lastActivityAt: null,
    slaDueAt: null,
    trackingId: null,
    trackingDisplayCode: null,
    ...p,
  };
}

function tileValue(label: string): string | null {
  const tile = screen.getByLabelText(`${label} metric`);
  return tile.querySelector('span.tabular-nums')?.textContent ?? null;
}

describe('AnalyticsStrip', () => {
  const now = Date.parse('2026-05-17T12:00:00Z');

  it('counts a manager resolved without ever being contacted into Resolved · 7d', () => {
    // Regression: lastContactAt is only set when a message is sent, so a
    // manager resolved via stage transition has it null. The KPI must fall
    // back to lastActivityAt (the tracking entry's updatedAt).
    render(
      <AnalyticsStrip
        now={now}
        rows={[
          row({
            managerKey: 'fischer',
            managerName: 'Fischer, Tom',
            stage: 'RESOLVED',
            resolved: true,
            lastContactAt: null,
            lastActivityAt: new Date(now - 3_600_000).toISOString(),
          }),
        ]}
      />,
    );

    expect(tileValue('Resolved · 7d')).toBe('1');
    expect(tileValue('Open')).toBe('0');
  });

  it('excludes resolutions older than 7 days from Resolved · 7d', () => {
    render(
      <AnalyticsStrip
        now={now}
        rows={[
          row({
            managerKey: 'old',
            managerName: 'Old, Case',
            stage: 'RESOLVED',
            resolved: true,
            lastActivityAt: new Date(now - 8 * 24 * 3_600_000).toISOString(),
          }),
        ]}
      />,
    );

    expect(tileValue('Resolved · 7d')).toBe('0');
  });

  it('keeps an unresolved manager in Open and out of Resolved · 7d', () => {
    render(
      <AnalyticsStrip
        now={now}
        rows={[row({ managerKey: 'a', managerName: 'Ann', stage: 'SENT' })]}
      />,
    );

    expect(tileValue('Open')).toBe('1');
    expect(tileValue('Resolved · 7d')).toBe('0');
  });
});

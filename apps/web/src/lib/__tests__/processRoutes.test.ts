import { afterEach, describe, expect, it, vi } from 'vitest';
import { escalationCenterPath, processAnalyticsPath, processDashboardPath } from '../processRoutes';

describe('process route helpers', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('uses processes routes by default', () => {
    expect(processDashboardPath('PRC-1')).toBe('/processes/PRC-1');
    expect(escalationCenterPath('PRC-1')).toBe('/processes/PRC-1/escalations');
    expect(processAnalyticsPath('PRC-1')).toBe('/processes/PRC-1/analytics');
  });

  it('uses workspace routes when tiles dashboard is disabled', () => {
    vi.stubEnv('VITE_FEATURE_TILES_DASHBOARD', 'false');
    expect(processDashboardPath('PRC-1')).toBe('/workspace/PRC-1');
    expect(escalationCenterPath('PRC-1')).toBe('/workspace/PRC-1/escalations');
    expect(processAnalyticsPath('PRC-1')).toBe('/workspace/PRC-1/analytics');
  });
});

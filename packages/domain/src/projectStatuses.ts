import { FUNCTION_IDS, type FunctionId } from './functions';

export type EngineSubStatus = 'open' | 'resolved' | 'na';

/** Matches `ProjectTrackingStatus` shape without importing `./types` (cycle). */
export type LegacyProjectTrackingRow = {
  projectNo: string;
  stage: 'open' | 'acknowledged' | 'corrected' | 'resolved';
  feedback: string;
  history: Array<{ channel: string; at: string; note: string }>;
  updatedAt: string;
};

export interface EngineProjectStatus {
  openCount: number;
  status: EngineSubStatus;
  lastSeenRunId: string | null;
  resolvedAt?: string | null;
}

export interface ProjectStatusesAggregate {
  totalOpen: number;
  overallStatus: 'open' | 'resolved' | 'mixed';
}

export interface ProjectStatusesV2 {
  byEngine: Record<string, EngineProjectStatus>;
  aggregate: ProjectStatusesAggregate;
  /** Optional per-project UI state (local / migration); not required by the Issue #70 API contract. */
  legacyProjects?: Record<string, LegacyProjectTrackingRow>;
}

function emptyEngineStatus(): EngineProjectStatus {
  return { openCount: 0, status: 'na', lastSeenRunId: null, resolvedAt: null };
}

export function emptyProjectStatuses(): ProjectStatusesV2 {
  const byEngine: Record<string, EngineProjectStatus> = {};
  for (const id of FUNCTION_IDS) {
    byEngine[id] = emptyEngineStatus();
  }
  return {
    byEngine,
    aggregate: { totalOpen: 0, overallStatus: 'resolved' },
  };
}

export function recomputeAggregate(statuses: ProjectStatusesV2): ProjectStatusesV2 {
  let totalOpen = 0;
  const considered: EngineSubStatus[] = [];
  for (const id of FUNCTION_IDS) {
    const row = statuses.byEngine[id] ?? emptyEngineStatus();
    if (row.status === 'na') continue;
    considered.push(row.status);
    if (row.status === 'open') totalOpen += row.openCount;
  }
  let overallStatus: ProjectStatusesAggregate['overallStatus'] = 'resolved';
  if (considered.length === 0) {
    overallStatus = 'resolved';
  } else if (considered.every((s) => s === 'resolved')) {
    overallStatus = 'resolved';
  } else if (considered.every((s) => s === 'open')) {
    overallStatus = 'open';
  } else {
    overallStatus = 'mixed';
  }
  return {
    ...statuses,
    aggregate: { totalOpen, overallStatus },
  };
}

export function globalResolvedFromStatuses(statuses: ProjectStatusesV2): boolean {
  const withData = FUNCTION_IDS.map((id) => statuses.byEngine[id]?.status ?? 'na').filter((s) => s !== 'na');
  if (withData.length === 0) return false;
  return withData.every((s) => s === 'resolved');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isLegacyProjectRow(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return typeof value.stage === 'string' && ('projectNo' in value || 'feedback' in value);
}

function coerceLegacyProjectStatus(projectNo: string, raw: unknown): LegacyProjectTrackingRow {
  if (!isRecord(raw)) {
    return {
      projectNo,
      stage: 'open',
      feedback: '',
      history: [],
      updatedAt: new Date().toISOString(),
    };
  }
  const st = raw.stage;
  const stage =
    st === 'acknowledged' || st === 'corrected' || st === 'resolved' || st === 'open' ? st : 'open';
  return {
    projectNo: String(raw.projectNo ?? projectNo),
    stage,
    feedback: String(raw.feedback ?? ''),
    history: Array.isArray(raw.history)
      ? raw.history.map((ev) => ({
          channel: typeof ev === 'object' && ev && 'channel' in ev ? String((ev as { channel?: string }).channel) : 'manual',
          at: String((ev as { at?: string })?.at ?? new Date().toISOString()),
          note: String((ev as { note?: string })?.note ?? ''),
        }))
      : [],
    updatedAt: String(raw.updatedAt ?? new Date().toISOString()),
  };
}

export function parseProjectStatuses(raw: unknown): ProjectStatusesV2 {
  if (!isRecord(raw)) {
    return emptyProjectStatuses();
  }
  const byRaw = raw.byEngine;
  const aggRaw = raw.aggregate;
  if (isRecord(byRaw) && isRecord(aggRaw) && typeof aggRaw.totalOpen === 'number' && typeof aggRaw.overallStatus === 'string') {
    const base = emptyProjectStatuses();
    for (const id of FUNCTION_IDS) {
      const cell = byRaw[id];
      if (!isRecord(cell)) continue;
      const openCount = typeof cell.openCount === 'number' ? cell.openCount : 0;
      const status = cell.status === 'open' || cell.status === 'resolved' || cell.status === 'na' ? cell.status : 'na';
      const lastSeenRunId = typeof cell.lastSeenRunId === 'string' ? cell.lastSeenRunId : cell.lastSeenRunId === null ? null : null;
      const resolvedAt =
        typeof cell.resolvedAt === 'string' ? cell.resolvedAt : cell.resolvedAt === null || cell.resolvedAt === undefined ? null : null;
      base.byEngine[id] = { openCount, status, lastSeenRunId, resolvedAt };
    }
    base.aggregate = {
      totalOpen: aggRaw.totalOpen as number,
      overallStatus:
        aggRaw.overallStatus === 'open' || aggRaw.overallStatus === 'resolved' || aggRaw.overallStatus === 'mixed'
          ? aggRaw.overallStatus
          : 'open',
    };
    return recomputeAggregate(base);
  }
  const legacyKeys = Object.keys(raw).filter((k) => k !== 'byEngine' && k !== 'aggregate');
  const legacyProjectKeys = legacyKeys.filter((k) => isLegacyProjectRow((raw as Record<string, unknown>)[k]));
  if (legacyProjectKeys.length > 0) {
    const base = emptyProjectStatuses();
    const legacyProjects: Record<string, LegacyProjectTrackingRow> = {};
    for (const k of legacyProjectKeys) {
      legacyProjects[k] = coerceLegacyProjectStatus(k, (raw as Record<string, unknown>)[k]);
    }
    return {
      byEngine: base.byEngine,
      aggregate: {
        totalOpen: legacyProjectKeys.length,
        overallStatus: 'open',
      },
      legacyProjects,
    };
  }
  return recomputeAggregate(emptyProjectStatuses());
}

export function assertProjectStatuses(value: unknown): ProjectStatusesV2 {
  const parsed = parseProjectStatuses(value);
  for (const id of FUNCTION_IDS) {
    const row = parsed.byEngine[id];
    if (!row || typeof row.openCount !== 'number') {
      throw new Error('Invalid projectStatuses.byEngine');
    }
    if (row.status !== 'open' && row.status !== 'resolved' && row.status !== 'na') {
      throw new Error('Invalid engine status');
    }
  }
  return parsed;
}

export function patchEngineStatus(
  statuses: ProjectStatusesV2,
  functionId: FunctionId,
  patch: Partial<EngineProjectStatus>,
): ProjectStatusesV2 {
  const next: ProjectStatusesV2 = {
    ...statuses,
    byEngine: { ...statuses.byEngine, [functionId]: { ...emptyEngineStatus(), ...statuses.byEngine[functionId], ...patch } },
  };
  return recomputeAggregate(next);
}

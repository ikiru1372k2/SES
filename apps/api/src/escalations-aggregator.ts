import type { FunctionId } from '@ses/domain';
import {
  emptyEngineCountRecord,
  FUNCTION_IDS,
  isValidEmail,
  managerKey,
  type ProcessEscalationFindingRef,
  type ProcessEscalationManagerRow,
  type ProcessEscalationsPayload,
  type ProcessEscalationsSummary,
} from '@ses/domain';

export type AggregatorIssueRow = {
  issueKey: string;
  projectManager: string | null;
  email: string | null;
  engineId: FunctionId;
  projectNo: string | null;
  projectName: string | null;
};

export type AggregatorTrackingRow = {
  managerKey: string;
  managerName: string;
  managerEmail: string | null;
  stage: string;
  resolved: boolean;
  lastContactAt: Date | null;
  slaDueAt: Date | null;
  id: string;
  displayCode: string;
  outlookCount: number;
  teamsCount: number;
};

function issueManagerKey(row: AggregatorIssueRow): string {
  const name = row.projectManager?.trim() || 'Unknown';
  return managerKey(name, row.email);
}

function breachSla(now: number, slaDueAt: Date | null, resolved: boolean): boolean {
  if (resolved || !slaDueAt) return false;
  return slaDueAt.getTime() < now;
}

function pickResolvedEmail(managerKeyValue: string, issues: AggregatorIssueRow[], tr: AggregatorTrackingRow | undefined): string | null {
  if (tr?.managerEmail && isValidEmail(tr.managerEmail)) {
    return tr.managerEmail.trim().toLowerCase();
  }
  for (const iss of issues) {
    if (issueManagerKey(iss) !== managerKeyValue) continue;
    if (isValidEmail(iss.email)) return iss.email!.trim().toLowerCase();
  }
  return null;
}

function hasValidEmailOnIssues(managerKeyValue: string, issues: AggregatorIssueRow[]): boolean {
  for (const iss of issues) {
    if (issueManagerKey(iss) !== managerKeyValue) continue;
    if (isValidEmail(iss.email)) return true;
  }
  return false;
}

type AggBucket = {
  managerName: string;
  countsByEngine: Partial<Record<FunctionId, number>>;
  findingsByEngine: Partial<Record<FunctionId, ProcessEscalationFindingRef[]>>;
};

export function aggregateEscalations(
  processId: string,
  issues: AggregatorIssueRow[],
  tracking: AggregatorTrackingRow[],
  nowMs: number = Date.now(),
): ProcessEscalationsPayload {
  const byManager = new Map<string, AggBucket>();

  for (const row of issues) {
    const name = row.projectManager?.trim() || 'Unknown';
    const key = issueManagerKey(row);
    const cur: AggBucket =
      byManager.get(key) ??
      {
        managerName: name,
        countsByEngine: {},
        findingsByEngine: {},
      };

    const nextCounts = { ...cur.countsByEngine };
    nextCounts[row.engineId] = (nextCounts[row.engineId] ?? 0) + 1;

    const list = [...(cur.findingsByEngine[row.engineId] ?? [])];
    list.push({
      issueKey: row.issueKey,
      projectNo: row.projectNo,
      projectName: row.projectName,
    });

    byManager.set(key, {
      managerName: cur.managerName || name,
      countsByEngine: nextCounts,
      findingsByEngine: { ...cur.findingsByEngine, [row.engineId]: list },
    });
  }

  const trackingByKey = new Map(tracking.map((t) => [t.managerKey, t]));

  for (const t of tracking) {
    if (byManager.has(t.managerKey)) continue;
    const empty: AggBucket = {
      managerName: t.managerName,
      countsByEngine: {},
      findingsByEngine: {},
    };
    byManager.set(t.managerKey, empty);
  }

  const rows: ProcessEscalationManagerRow[] = [];

  for (const [managerKeyValue, agg] of byManager) {
    const tr = trackingByKey.get(managerKeyValue);
    const resolved = tr?.resolved ?? false;
    const resolvedEmail = pickResolvedEmail(managerKeyValue, issues, tr);
    const hasEmail = Boolean(resolvedEmail) || hasValidEmailOnIssues(managerKeyValue, issues);
    const isUnmapped = managerKeyValue.startsWith('missing-email:') || !hasEmail;

    const totalIssues = FUNCTION_IDS.reduce((sum, id) => sum + (agg.countsByEngine[id] ?? 0), 0);

    rows.push({
      managerKey: managerKeyValue,
      managerName: tr?.managerName ?? agg.managerName,
      resolvedEmail,
      directoryEmail: null,
      isUnmapped,
      totalIssues,
      countsByEngine: { ...agg.countsByEngine },
      findingsByEngine: { ...agg.findingsByEngine },
      stage: tr?.stage ?? null,
      resolved,
      lastContactAt: tr?.lastContactAt?.toISOString() ?? null,
      slaDueAt: tr?.slaDueAt?.toISOString() ?? null,
      trackingId: tr?.id ?? null,
      trackingDisplayCode: tr?.displayCode ?? null,
      outlookCount: tr?.outlookCount ?? 0,
      teamsCount: tr?.teamsCount ?? 0,
    });
  }

  rows.sort((a, b) => a.managerName.localeCompare(b.managerName));

  const perEngineIssueCounts = emptyEngineCountRecord();
  const perEngineManagerCounts = emptyEngineCountRecord();

  for (const id of FUNCTION_IDS) {
    const mgrSet = new Set<string>();
    for (const r of rows) {
      const c = r.countsByEngine[id] ?? 0;
      if (c > 0) {
        perEngineIssueCounts[id] = (perEngineIssueCounts[id] ?? 0) + c;
        mgrSet.add(r.managerKey);
      }
    }
    perEngineManagerCounts[id] = mgrSet.size;
  }

  let totalOpenFindings = 0;
  let managersWithOpenCount = 0;
  for (const r of rows) {
    if (r.resolved) continue;
    if (r.totalIssues > 0) {
      totalOpenFindings += r.totalIssues;
      managersWithOpenCount += 1;
    }
  }

  let slaBreachingCount = 0;
  for (const r of rows) {
    if (breachSla(nowMs, r.slaDueAt ? new Date(r.slaDueAt) : null, r.resolved)) slaBreachingCount += 1;
  }

  const enginesWithIssues = FUNCTION_IDS.filter((id) => (perEngineIssueCounts[id] ?? 0) > 0);
  // Provisional: pre-directory-enrichment. EscalationsService recomputes
  // this after joining ManagerDirectory so a Directory import clears the
  // banner without needing an audit rerun. See escalations.service.ts.
  const unmappedManagerCount = rows.filter((r) => r.isUnmapped && (r.totalIssues > 0 || !r.resolved)).length;

  const summary: ProcessEscalationsSummary = {
    totalOpenFindings,
    perEngineIssueCounts,
    perEngineManagerCounts,
    managersWithOpenCount,
    engineCountWithOpen: enginesWithIssues.length,
    slaBreachingCount,
    unmappedManagerCount,
  };

  return {
    processId,
    summary,
    rows,
    engineIds: FUNCTION_IDS,
  };
}

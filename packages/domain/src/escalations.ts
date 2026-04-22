import type { FunctionId } from './functions';
import { FUNCTION_IDS } from './functions';

export interface ProcessEscalationsSummary {
  totalOpenFindings: number;
  perEngineIssueCounts: Record<string, number>;
  perEngineManagerCounts: Record<string, number>;
  managersWithOpenCount: number;
  engineCountWithOpen: number;
  slaBreachingCount: number;
  unmappedManagerCount: number;
}

export interface ProcessEscalationFindingRef {
  issueKey: string;
  projectNo: string | null;
  projectName: string | null;
}

export interface ProcessEscalationManagerRow {
  managerKey: string;
  managerName: string;
  resolvedEmail: string | null;
  /** Email from `ManagerDirectory` when `normalizedKey` matches this row. */
  directoryEmail: string | null;
  isUnmapped: boolean;
  totalIssues: number;
  countsByEngine: Partial<Record<FunctionId, number>>;
  findingsByEngine: Partial<Record<FunctionId, ProcessEscalationFindingRef[]>>;
  stage: string | null;
  resolved: boolean;
  lastContactAt: string | null;
  slaDueAt: string | null;
  trackingId: string | null;
  trackingDisplayCode: string | null;
  /**
   * Issue #76: an auditor must click "Verified — Resolve" before a
   * RESOLVED-stage entry truly leaves the active list. When `stage`
   * reads RESOLVED but `verifiedAt` is null the row renders with an
   * orange "Awaiting verification" pill.
   */
  verifiedAt?: string | null;
  verifiedByName?: string | null;
  /**
   * Counters on the tracking entry (Issue #75). The UI uses these to
   * render the `Outlook N/2` / `Teams N/1` pills and to mirror the
   * server-side channel gate.
   */
  outlookCount?: number;
  teamsCount?: number;
  escalationLevel?: number;
  draftLockExpiresAt?: string | null;
  draftLockUserDisplayName?: string | null;
}

export interface ProcessEscalationsPayload {
  processId: string;
  summary: ProcessEscalationsSummary;
  rows: ProcessEscalationManagerRow[];
  engineIds: readonly FunctionId[];
}

export function emptyEngineCountRecord(): Record<string, number> {
  return Object.fromEntries(FUNCTION_IDS.map((id) => [id, 0])) as Record<string, number>;
}

import type {
  ChartSpec,
  ChatEvent,
  FunctionId,
} from '@ses/domain';
import { parseApiError } from './client';

export interface AnalyticsSummary {
  processCode: string;
  functionId: FunctionId | null;
  totalScanned: number;
  totalFlagged: number;
  functionsCovered: number;
  perFunction: Array<{
    functionId: FunctionId | string;
    label: string;
    present: boolean;
    scannedRows: number;
    flaggedRows: number;
    completedAt: string | null;
    ageDays: number | null;
    stale: boolean;
  }>;
}

export interface AnalyticsTimeseriesPoint {
  versionNumber: number;
  versionName: string;
  displayCode: string;
  createdAt: string;
  functionId: FunctionId | string;
  scannedRows: number;
  flaggedRows: number;
}

export interface AnalyticsManagerRow {
  manager: string;
  count: number;
  high: number;
}

export interface AnalyticsAnomaly {
  kind: string;
  rule: 'rule';
  ruleId: string | null;
  projectNo: string | null;
  projectName: string | null;
  managerName: string | null;
  severity: string;
  reason: string | null;
  functionId: string;
}

export interface AnalyticsAnomaliesResponse {
  ruleViolations: AnalyticsAnomaly[];
  mlOverlay: unknown[];
}

export interface AnalyticsHealth {
  ok: boolean;
  ollama?: 'up' | 'down' | 'degraded';
  loaded_models?: string[];
  error?: string;
}

const base = (processCode: string) =>
  `/api/v1/analytics/processes/${encodeURIComponent(processCode)}`;

function withFn(url: string, functionId: FunctionId | undefined): string {
  return functionId ? `${url}?functionId=${encodeURIComponent(functionId)}` : url;
}

export async function fetchAnalyticsHealth(): Promise<AnalyticsHealth> {
  const res = await fetch(`/api/v1/analytics/health`, { credentials: 'include' });
  if (!res.ok) throw await parseApiError(res, 'Health check failed');
  return res.json() as Promise<AnalyticsHealth>;
}

export async function fetchAnalyticsSummary(
  processCode: string,
  functionId?: FunctionId,
): Promise<AnalyticsSummary> {
  const res = await fetch(withFn(`${base(processCode)}/summary`, functionId), {
    credentials: 'include',
  });
  if (!res.ok) throw await parseApiError(res, 'Failed to load analytics summary');
  return res.json() as Promise<AnalyticsSummary>;
}

export async function fetchAnalyticsTimeseries(
  processCode: string,
  functionId?: FunctionId,
): Promise<AnalyticsTimeseriesPoint[]> {
  const res = await fetch(withFn(`${base(processCode)}/timeseries`, functionId), {
    credentials: 'include',
  });
  if (!res.ok) throw await parseApiError(res, 'Failed to load timeseries');
  return res.json() as Promise<AnalyticsTimeseriesPoint[]>;
}

export async function fetchAnalyticsManagers(
  processCode: string,
  functionId?: FunctionId,
): Promise<AnalyticsManagerRow[]> {
  const res = await fetch(withFn(`${base(processCode)}/managers`, functionId), {
    credentials: 'include',
  });
  if (!res.ok) throw await parseApiError(res, 'Failed to load manager analytics');
  return res.json() as Promise<AnalyticsManagerRow[]>;
}

export async function fetchAnalyticsAnomalies(
  processCode: string,
  functionId?: FunctionId,
): Promise<AnalyticsAnomaliesResponse> {
  const res = await fetch(withFn(`${base(processCode)}/anomalies`, functionId), {
    credentials: 'include',
  });
  if (!res.ok) throw await parseApiError(res, 'Failed to load anomalies');
  return res.json() as Promise<AnalyticsAnomaliesResponse>;
}

export interface ChatRequestBody {
  question: string;
  functionId?: FunctionId | undefined;
  versionRef?: string | undefined;
  compareTo?: string | undefined;
  useStub?: boolean | undefined;
}

export async function streamAnalyticsChat(
  processCode: string,
  body: ChatRequestBody,
  onEvent: (evt: ChatEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const init: RequestInit = {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(body),
  };
  if (signal) init.signal = signal;
  const res = await fetch(`${base(processCode)}/chat`, init);
  if (!res.ok || !res.body) throw await parseApiError(res, 'Chat failed');
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buf.indexOf('\n\n')) !== -1) {
      const frame = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      if (!frame.startsWith('data:')) continue;
      const json = frame.slice(5).trim();
      if (!json) continue;
      try {
        onEvent(JSON.parse(json) as ChatEvent);
      } catch {
        // ignore malformed frames
      }
    }
  }
}

export interface ChatHistoryEntry {
  id: string;
  question: string;
  final_answer: string;
  chart_spec: ChartSpec | null;
  created_at: string;
  model_name: string | null;
  latency_ms: number | null;
}

export async function fetchChatHistory(
  processCode: string,
  functionId?: FunctionId,
): Promise<ChatHistoryEntry[]> {
  const res = await fetch(withFn(`${base(processCode)}/chat/history`, functionId), {
    credentials: 'include',
  });
  if (!res.ok) throw await parseApiError(res, 'Failed to load chat history');
  return res.json() as Promise<ChatHistoryEntry[]>;
}

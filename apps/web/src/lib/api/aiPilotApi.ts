import type { AiRuleSpec, AuditIssue, FunctionId } from '@ses/domain';
import { JSON_HEADERS, parseApiError } from './client';

const BASE = '/api/v1/admin/ai-pilot';

export interface AiRuleListItem {
  ruleCode: string;
  name: string;
  functionId: FunctionId;
  category: string;
  severity: 'High' | 'Medium' | 'Low';
  status: 'active' | 'paused' | 'archived';
  version: number;
  createdAt: string;
  aiMeta: {
    description: string;
    flagMessage: string;
    logic: unknown;
    authoredBy: { displayName: string; email: string } | null;
    createdAt: string;
    updatedAt: string;
  } | null;
}

export interface SandboxUploadResult {
  sessionId: string;
  fileName: string;
  expiresAt: string;
  sheets: Array<{
    name: string;
    rowCount: number;
    status: 'valid' | 'duplicate' | 'invalid';
    normalizedHeaders: string[];
  }>;
  previewMarkdown?: string;
}

export interface GenerateResult {
  success: boolean;
  spec?: AiRuleSpec;
  raw?: unknown;
  error?: string;
}

export interface PreviewResult {
  fileId: string;
  runAt: string;
  scannedRows: number;
  flaggedRows: number;
  issues: AuditIssue[];
  sheets: Array<{ sheetName: string; rowCount: number; flaggedCount: number }>;
  unknownColumns: string[];
}

export interface EscalationLitePreview {
  totalEscalations: number;
  uniqueManagers: number;
  perManagerCount: Array<{ email: string; displayName: string; count: number }>;
  unassignedCount: number;
}

const get = async <T>(url: string): Promise<T> => {
  const res = await fetch(url, { credentials: 'include' });
  if (!res.ok) throw await parseApiError(res, 'Request failed');
  return (await res.json()) as T;
};

const post = async <T>(url: string, body: unknown): Promise<T> => {
  const res = await fetch(url, {
    method: 'POST',
    credentials: 'include',
    headers: JSON_HEADERS,
    body: JSON.stringify(body),
  });
  if (!res.ok) throw await parseApiError(res, 'Request failed');
  return (await res.json()) as T;
};

export const fetchHealth = () => get<{ ok: boolean; raw?: unknown; error?: string }>(`${BASE}/health`);

export const fetchPromptExamples = (functionId: FunctionId) =>
  get<{ examples: string[] }>(`${BASE}/functions/${functionId}/prompt-examples`);

export const listRules = (functionId: FunctionId) =>
  get<AiRuleListItem[]>(`${BASE}/functions/${functionId}/rules`);

export const getRule = (ruleCode: string) =>
  get<AiRuleListItem>(`${BASE}/rules/${ruleCode}`);

export async function uploadSandboxFile(
  functionId: FunctionId,
  file: File,
): Promise<SandboxUploadResult> {
  const body = new FormData();
  body.append('file', file, file.name);
  body.append('functionId', functionId);
  const res = await fetch(`${BASE}/sandbox/upload`, {
    method: 'POST',
    credentials: 'include',
    body,
  });
  if (!res.ok) throw await parseApiError(res, 'Upload failed');
  return (await res.json()) as SandboxUploadResult;
}

export const pickSheet = (sessionId: string, sheetName: string) =>
  post<{ ok: true }>(`${BASE}/sandbox/${sessionId}/sheet`, { sheetName });

export const generateRule = (sessionId: string, prompt: string) =>
  post<GenerateResult>(`${BASE}/sandbox/${sessionId}/generate`, { prompt });

export const enhancePrompt = (sessionId: string, prompt: string, columns: string[]) =>
  post<{ enhancedPrompt: string }>(`${BASE}/sandbox/${sessionId}/enhance-prompt`, {
    prompt,
    columns,
  });

export const previewRule = (sessionId: string, spec: AiRuleSpec) =>
  post<PreviewResult>(`${BASE}/sandbox/${sessionId}/preview`, { spec });

export const previewEscalations = (sessionId: string, spec: AiRuleSpec) =>
  post<EscalationLitePreview>(`${BASE}/sandbox/${sessionId}/preview-escalations`, { spec });

export const saveRule = (input: {
  spec: AiRuleSpec;
  sandboxSessionId: string;
  previewedAt: string;
}) => post<AiRuleListItem>(`${BASE}/rules`, input);

export const setRuleStatus = (ruleCode: string, status: 'active' | 'paused' | 'archived') =>
  post<{ ruleCode: string; status: string }>(`${BASE}/rules/${ruleCode}/${
    status === 'active' ? 'resume' : status === 'paused' ? 'pause' : 'archive'
  }`, {});

export const fetchAuditLog = (params: { ruleCode?: string; limit?: number }) => {
  const usp = new URLSearchParams();
  if (params.ruleCode) usp.set('ruleCode', params.ruleCode);
  if (params.limit) usp.set('limit', String(params.limit));
  return get<
    Array<{
      id: string;
      action: string;
      ruleCode: string | null;
      payload: unknown;
      createdAt: string;
      actor: { displayName: string; email: string } | null;
    }>
  >(`${BASE}/audit-log${usp.toString() ? `?${usp.toString()}` : ''}`);
};

export const fetchWelcomeState = () =>
  get<{ aiPilotWelcomeDismissed: boolean }>(`${BASE}/welcome-state`);

export const dismissWelcome = () =>
  post<{ aiPilotWelcomeDismissed: true }>(`${BASE}/welcome-state/dismiss`, {});

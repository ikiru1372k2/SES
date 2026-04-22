import { parseApiError } from './client';

const JSON_HEADERS = { 'Content-Type': 'application/json' };

export interface ApiEscalationTemplate {
  id: string;
  tenantId: string | null;
  parentId: string | null;
  stage: string;
  subject: string;
  body: string;
  channel: string;
  active: boolean;
  version: number;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export async function fetchEscalationTemplates(opts?: { stageKey?: string; includeInactive?: boolean }): Promise<ApiEscalationTemplate[]> {
  const q = new URLSearchParams();
  if (opts?.stageKey) q.set('stageKey', opts.stageKey);
  if (opts?.includeInactive) q.set('includeInactive', 'true');
  const res = await fetch(`/api/v1/escalation-templates?${q}`, { credentials: 'include' });
  if (!res.ok) throw await parseApiError(res, 'Failed to load escalation templates');
  return (await res.json()) as ApiEscalationTemplate[];
}

export async function createEscalationTemplate(body: {
  stage?: string;
  subject?: string;
  body?: string;
  channel?: string;
  parentId?: string | null;
}): Promise<ApiEscalationTemplate> {
  const res = await fetch('/api/v1/escalation-templates', {
    method: 'POST',
    credentials: 'include',
    headers: JSON_HEADERS,
    body: JSON.stringify(body),
  });
  if (!res.ok) throw await parseApiError(res, 'Failed to create template');
  return (await res.json()) as ApiEscalationTemplate;
}

export async function patchEscalationTemplate(
  id: string,
  body: { subject?: string; body?: string; channel?: string; active?: boolean },
): Promise<ApiEscalationTemplate> {
  const res = await fetch(`/api/v1/escalation-templates/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    credentials: 'include',
    headers: JSON_HEADERS,
    body: JSON.stringify(body),
  });
  if (!res.ok) throw await parseApiError(res, 'Failed to update template');
  return (await res.json()) as ApiEscalationTemplate;
}

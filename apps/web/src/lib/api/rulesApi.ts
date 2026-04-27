import type { FunctionId } from '@ses/domain';
import { parseApiError } from './client';

export interface AuditRuleListItem {
  ruleCode: string;
  functionId: FunctionId;
  name: string;
  category: string;
  description: string;
  defaultSeverity: 'High' | 'Medium' | 'Low';
  source: 'system' | 'ai-pilot';
  status: 'active' | 'paused' | 'archived';
  version: number;
  isEnabledDefault: boolean;
  createdAt?: string;
}

export async function listAllRules(functionId: FunctionId): Promise<AuditRuleListItem[]> {
  const res = await fetch(
    `/api/v1/rules?functionId=${encodeURIComponent(functionId)}`,
    { credentials: 'include' },
  );
  if (!res.ok) throw await parseApiError(res, 'Could not load rules');
  return (await res.json()) as AuditRuleListItem[];
}

import type { FunctionId } from '@ses/domain';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  enhancePrompt,
  fetchAuditLog,
  fetchHealth,
  fetchPromptExamples,
  fetchWelcomeState,
  generateRule,
  getRule,
  listRules,
  previewEscalations,
  previewRule,
  saveRule,
  setRuleStatus,
  uploadSandboxFile,
  pickSheet,
  dismissWelcome,
} from '../lib/api/aiPilotApi';
import { listAllRules } from '../lib/api/rulesApi';

const RULES_KEY = (fnId: FunctionId) => ['ai-pilot', 'rules', fnId] as const;
const RULE_DETAIL_KEY = (code: string) => ['ai-pilot', 'rule', code] as const;
const PROMPT_EXAMPLES_KEY = (fnId: FunctionId) => ['ai-pilot', 'prompts', fnId] as const;

export const useAiRules = (fnId: FunctionId) =>
  useQuery({
    queryKey: RULES_KEY(fnId),
    queryFn: () => listRules(fnId),
    staleTime: 30_000,
  });

export const useAllRules = (fnId: FunctionId) =>
  useQuery({
    queryKey: ['ai-pilot', 'all-rules', fnId] as const,
    queryFn: () => listAllRules(fnId),
    staleTime: 60_000,
  });

export const useAiRule = (ruleCode: string | null | undefined) =>
  useQuery({
    queryKey: RULE_DETAIL_KEY(ruleCode ?? ''),
    queryFn: () => getRule(ruleCode!),
    enabled: Boolean(ruleCode),
    staleTime: 15_000,
  });

export const usePromptExamples = (fnId: FunctionId) =>
  useQuery({
    queryKey: PROMPT_EXAMPLES_KEY(fnId),
    queryFn: () => fetchPromptExamples(fnId),
    staleTime: 5 * 60_000,
  });

export const useAiHealth = () =>
  useQuery({
    queryKey: ['ai-pilot', 'health'],
    queryFn: () => fetchHealth(),
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
  });

export const useUploadSandbox = () =>
  useMutation({
    mutationFn: (input: { functionId: FunctionId; file: File }) =>
      uploadSandboxFile(input.functionId, input.file),
  });

export const usePickSheet = () =>
  useMutation({ mutationFn: (input: { sessionId: string; sheetName: string }) =>
    pickSheet(input.sessionId, input.sheetName) });

export const useGenerateRule = () =>
  useMutation({
    mutationFn: (input: { sessionId: string; prompt: string }) =>
      generateRule(input.sessionId, input.prompt),
  });

export const useEnhancePrompt = () =>
  useMutation({
    mutationFn: (input: { sessionId: string; prompt: string; columns: string[] }) =>
      enhancePrompt(input.sessionId, input.prompt, input.columns),
  });

export const usePreviewRule = () =>
  useMutation({
    mutationFn: (input: { sessionId: string; spec: import('@ses/domain').AiRuleSpec }) =>
      previewRule(input.sessionId, input.spec),
  });

export const usePreviewEscalations = () =>
  useMutation({
    mutationFn: (input: { sessionId: string; spec: import('@ses/domain').AiRuleSpec }) =>
      previewEscalations(input.sessionId, input.spec),
  });

export const useSaveRule = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: saveRule,
    onSuccess: (rule) => {
      void qc.invalidateQueries({ queryKey: ['ai-pilot', 'rules'] });
      void qc.invalidateQueries({ queryKey: ['ai-pilot', 'all-rules'] });
      void qc.invalidateQueries({ queryKey: RULE_DETAIL_KEY(rule.ruleCode) });
    },
  });
};

export const useSetRuleStatus = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { ruleCode: string; status: 'active' | 'paused' | 'archived' }) =>
      setRuleStatus(input.ruleCode, input.status),
    onSuccess: (rule) => {
      void qc.invalidateQueries({ queryKey: ['ai-pilot', 'rules'] });
      void qc.invalidateQueries({ queryKey: ['ai-pilot', 'all-rules'] });
      void qc.invalidateQueries({ queryKey: RULE_DETAIL_KEY(rule.ruleCode) });
    },
  });
};

export const useAiPilotAuditLog = (params: { ruleCode?: string; limit?: number }) =>
  useQuery({
    queryKey: ['ai-pilot', 'audit-log', params.ruleCode, params.limit],
    queryFn: () => fetchAuditLog(params),
    staleTime: 10_000,
  });

export const useWelcomeState = () =>
  useQuery({
    queryKey: ['ai-pilot', 'welcome-state'],
    queryFn: () => fetchWelcomeState(),
    staleTime: Infinity,
  });

export const useDismissWelcome = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: dismissWelcome,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['ai-pilot', 'welcome-state'] }),
  });
};

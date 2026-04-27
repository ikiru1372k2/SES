import type { AiRuleSpec } from '@ses/domain';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { EscalationLitePreview, PreviewResult, SandboxUploadResult } from '../lib/api/aiPilotApi';

export type SandboxStep = 1 | 2 | 3 | 4 | 5 | 6;

export interface AiPilotState {
  // sandbox session — IN-MEMORY only (refresh resets, by design)
  sessionId: string | null;
  uploadedFile: SandboxUploadResult | null;
  selectedSheet: string | null;
  prompt: string;
  generatedSpec: AiRuleSpec | null;
  generationError: { raw: unknown; error: string } | null;
  previewResult: PreviewResult | null;
  previewedAt: string | null;
  escalationLite: EscalationLitePreview | null;
  escalationLiteError: string | null;
  currentStep: SandboxStep;

  // user preference — PERSISTED (whitelisted via partialize)
  welcomeDismissed: boolean;

  // actions
  setStep: (s: SandboxStep) => void;
  setPrompt: (p: string) => void;
  setSpec: (spec: AiRuleSpec) => void;
  applySpecEdit: (patch: Partial<AiRuleSpec>) => void;
  setUpload: (upload: SandboxUploadResult) => void;
  setSelectedSheet: (sheet: string | null) => void;
  setGenerationError: (err: { raw: unknown; error: string } | null) => void;
  setPreviewResult: (r: PreviewResult | null) => void;
  setEscalationLite: (e: EscalationLitePreview | null, err?: string | null) => void;
  resetSandbox: () => void;
  setWelcomeDismissed: (v: boolean) => void;
}

const initialSandbox = {
  sessionId: null,
  uploadedFile: null,
  selectedSheet: null,
  prompt: '',
  generatedSpec: null,
  generationError: null,
  previewResult: null,
  previewedAt: null,
  escalationLite: null,
  escalationLiteError: null,
  currentStep: 1 as SandboxStep,
};

export const useAiPilotStore = create<AiPilotState>()(
  persist(
    (set) => ({
      ...initialSandbox,
      welcomeDismissed: false,
      setStep: (s) => set({ currentStep: s }),
      setPrompt: (p) => set({ prompt: p }),
      setSpec: (spec) => set({ generatedSpec: spec, previewedAt: null, previewResult: null }),
      applySpecEdit: (patch) =>
        set((state) => ({
          generatedSpec: state.generatedSpec ? { ...state.generatedSpec, ...patch } : null,
          previewedAt: null,
          previewResult: null,
          escalationLite: null,
        })),
      setUpload: (upload) =>
        set({
          sessionId: upload.sessionId,
          uploadedFile: upload,
          selectedSheet: upload.sheets[0]?.name ?? null,
        }),
      setSelectedSheet: (sheet) => set({ selectedSheet: sheet }),
      setGenerationError: (err) => set({ generationError: err }),
      setPreviewResult: (r) =>
        set({ previewResult: r, previewedAt: r ? new Date().toISOString() : null }),
      setEscalationLite: (e, err) => set({ escalationLite: e, escalationLiteError: err ?? null }),
      resetSandbox: () => set({ ...initialSandbox }),
      setWelcomeDismissed: (v) => set({ welcomeDismissed: v }),
    }),
    {
      name: 'ses-ai-pilot',
      partialize: (state) => ({ welcomeDismissed: state.welcomeDismissed }) as Partial<AiPilotState>,
    },
  ),
);

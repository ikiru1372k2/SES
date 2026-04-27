import type { FunctionId } from '@ses/domain';
import { useEffect, useRef } from 'react';
import toast from 'react-hot-toast';
import {
  useGenerateRule,
  usePickSheet,
  usePreviewEscalations,
  usePreviewRule,
  useSaveRule,
  useUploadSandbox,
} from '../../hooks/useAiPilot';
import { useAiPilotStore } from '../../store/aiPilotStore';
import {
  SandboxHeader,
  Step1Upload,
  Step2PickSheet,
  Step3Describe,
  Step5Review,
  Step6Preview,
} from './sandbox';

export function SandboxModal({
  open,
  functionId,
  onClose,
}: {
  open: boolean;
  functionId: FunctionId;
  onClose: () => void;
}) {
  const store = useAiPilotStore();
  const upload = useUploadSandbox();
  const sheet = usePickSheet();
  const generate = useGenerateRule();
  const preview = usePreviewRule();
  const previewEsc = usePreviewEscalations();
  const save = useSaveRule();

  const initialized = useRef(false);
  useEffect(() => {
    if (open && !initialized.current) {
      store.resetSandbox();
      initialized.current = true;
    }
    if (!open) initialized.current = false;
  }, [open, store]);

  if (!open) return null;

  const close = () => {
    store.resetSandbox();
    onClose();
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 pt-12 backdrop-blur-sm"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div className="w-full max-w-3xl rounded-2xl border border-gray-200 bg-white shadow-2xl dark:border-gray-700 dark:bg-gray-900">
        <SandboxHeader step={store.currentStep} />

        <div className="space-y-4 px-6 py-5">
          {store.currentStep === 1 ? (
            <Step1Upload
              busy={upload.isPending}
              onPick={async (file) => {
                try {
                  const result = await upload.mutateAsync({ functionId, file });
                  store.setUpload(result);
                  store.setStep(result.sheets.length > 1 ? 2 : 3);
                } catch (err) {
                  toast.error(err instanceof Error ? err.message : 'Upload failed');
                }
              }}
            />
          ) : null}

          {store.currentStep === 2 ? (
            <Step2PickSheet
              sheets={store.uploadedFile?.sheets ?? []}
              selected={store.selectedSheet}
              busy={sheet.isPending}
              onPick={async (name) => {
                if (!store.sessionId) return;
                try {
                  await sheet.mutateAsync({ sessionId: store.sessionId, sheetName: name });
                  store.setSelectedSheet(name);
                  store.setStep(3);
                } catch (err) {
                  toast.error(err instanceof Error ? err.message : 'Sheet pick failed');
                }
              }}
            />
          ) : null}

          {store.currentStep === 3 ? (
            <Step3Describe
              functionId={functionId}
              prompt={store.prompt}
              onChange={store.setPrompt}
              busy={generate.isPending}
              onGenerate={async () => {
                if (!store.sessionId || !store.prompt.trim()) return;
                try {
                  const r = await generate.mutateAsync({
                    sessionId: store.sessionId,
                    prompt: store.prompt,
                  });
                  if (!r.success || !r.spec) {
                    store.setGenerationError({ raw: r.raw, error: r.error ?? 'unknown' });
                    return;
                  }
                  store.setSpec(r.spec);
                  store.setGenerationError(null);
                  store.setStep(5);
                } catch (err) {
                  toast.error(err instanceof Error ? err.message : 'Generation failed');
                }
              }}
              error={store.generationError}
              onClearError={() => store.setGenerationError(null)}
            />
          ) : null}

          {store.currentStep === 5 && store.generatedSpec ? (
            <Step5Review
              spec={store.generatedSpec}
              onChange={store.applySpecEdit}
              onBack={() => store.setStep(3)}
              onPreview={async () => {
                if (!store.sessionId || !store.generatedSpec) return;
                try {
                  const r = await preview.mutateAsync({
                    sessionId: store.sessionId,
                    spec: store.generatedSpec,
                  });
                  store.setPreviewResult(r);
                  // escalation preview in parallel — soft fail
                  try {
                    const esc = await previewEsc.mutateAsync({
                      sessionId: store.sessionId,
                      spec: store.generatedSpec,
                    });
                    store.setEscalationLite(esc, null);
                  } catch (err) {
                    store.setEscalationLite(
                      null,
                      err instanceof Error ? err.message : 'unavailable',
                    );
                  }
                  store.setStep(6);
                } catch (err) {
                  toast.error(err instanceof Error ? err.message : 'Preview failed');
                }
              }}
              busy={preview.isPending || previewEsc.isPending}
            />
          ) : null}

          {store.currentStep === 6 && store.previewResult && store.generatedSpec ? (
            <Step6Preview
              result={store.previewResult}
              escalation={store.escalationLite}
              escalationError={store.escalationLiteError}
              onBack={() => store.setStep(5)}
              onSave={async () => {
                if (
                  !store.sessionId ||
                  !store.generatedSpec ||
                  !store.previewedAt
                ) {
                  toast.error('Preview required before save');
                  return;
                }
                try {
                  await save.mutateAsync({
                    spec: store.generatedSpec,
                    sandboxSessionId: store.sessionId,
                    previewedAt: store.previewedAt,
                  });
                  toast.success(`Saved rule ${store.generatedSpec.name}. Will run on next audit.`);
                  close();
                } catch (err) {
                  toast.error(err instanceof Error ? err.message : 'Save failed');
                }
              }}
              saveDisabled={!store.previewedAt}
              busy={save.isPending}
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}

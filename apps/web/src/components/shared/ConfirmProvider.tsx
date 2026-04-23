import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { Button } from './Button';
import { Modal } from './Modal';

// Replaces all native window.confirm / window.prompt sites with a themed,
// keyboard-accessible, focus-trapped dialog.
//
// Usage:
//   const confirm = useConfirm();
//   if (await confirm({ title: 'Delete?', description: '...', confirmLabel: 'Delete', destructive: true })) { ... }
//
//   const prompt = usePrompt();
//   const note = await prompt({ title: 'Add a note', placeholder: '...', defaultValue: '' });

type ConfirmTone = 'default' | 'destructive';

type ConfirmOptions = {
  title: string;
  description?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: ConfirmTone;
};

type PromptOptions = {
  title: string;
  description?: ReactNode;
  placeholder?: string;
  defaultValue?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  multiline?: boolean;
  required?: boolean;
};

type ConfirmFn = (opts: ConfirmOptions) => Promise<boolean>;
type PromptFn = (opts: PromptOptions) => Promise<string | null>;

type ConfirmContextValue = {
  confirm: ConfirmFn;
  prompt: PromptFn;
};

const ConfirmContext = createContext<ConfirmContextValue | null>(null);

type ConfirmDialogState = ConfirmOptions & {
  kind: 'confirm';
  resolve: (value: boolean) => void;
};

type PromptDialogState = PromptOptions & {
  kind: 'prompt';
  resolve: (value: string | null) => void;
};

type DialogState = ConfirmDialogState | PromptDialogState | null;

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<DialogState>(null);
  const [promptValue, setPromptValue] = useState('');

  const close = useCallback(() => {
    setState(null);
  }, []);

  const confirm = useCallback<ConfirmFn>((opts) => {
    return new Promise<boolean>((resolve) => {
      setState({ kind: 'confirm', ...opts, resolve });
    });
  }, []);

  const prompt = useCallback<PromptFn>((opts) => {
    return new Promise<string | null>((resolve) => {
      setPromptValue(opts.defaultValue ?? '');
      setState({ kind: 'prompt', ...opts, resolve });
    });
  }, []);

  const contextValue = useMemo<ConfirmContextValue>(() => ({ confirm, prompt }), [confirm, prompt]);

  function handleConfirm(decision: boolean) {
    if (state?.kind === 'confirm') state.resolve(decision);
    close();
  }

  function handlePromptSubmit() {
    if (state?.kind !== 'prompt') return;
    const trimmed = promptValue.trim();
    if (state.required && !trimmed) return;
    state.resolve(promptValue);
    close();
  }

  function handlePromptCancel() {
    if (state?.kind === 'prompt') state.resolve(null);
    close();
  }

  const open = state !== null;

  return (
    <ConfirmContext.Provider value={contextValue}>
      {children}
      {state?.kind === 'confirm' ? (
        <Modal
          open={open}
          onClose={() => handleConfirm(false)}
          title={state.title}
          description={state.description}
          size="sm"
          footer={
            <>
              <Button variant="secondary" onClick={() => handleConfirm(false)}>
                {state.cancelLabel ?? 'Cancel'}
              </Button>
              <Button
                variant={state.tone === 'destructive' ? 'danger' : 'primary'}
                onClick={() => handleConfirm(true)}
              >
                {state.confirmLabel ?? 'Confirm'}
              </Button>
            </>
          }
        >
          {null}
        </Modal>
      ) : null}
      {state?.kind === 'prompt' ? (
        <Modal
          open={open}
          onClose={handlePromptCancel}
          title={state.title}
          description={state.description}
          size="md"
          footer={
            <>
              <Button variant="secondary" onClick={handlePromptCancel}>
                {state.cancelLabel ?? 'Cancel'}
              </Button>
              <Button
                onClick={handlePromptSubmit}
                disabled={state.required ? !promptValue.trim() : false}
              >
                {state.confirmLabel ?? 'Submit'}
              </Button>
            </>
          }
        >
          {state.multiline ? (
            <textarea
              autoFocus
              value={promptValue}
              onChange={(event) => setPromptValue(event.target.value)}
              placeholder={state.placeholder}
              className="h-28 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-800"
            />
          ) : (
            <input
              autoFocus
              value={promptValue}
              onChange={(event) => setPromptValue(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  handlePromptSubmit();
                }
              }}
              placeholder={state.placeholder}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-800"
            />
          )}
        </Modal>
      ) : null}
    </ConfirmContext.Provider>
  );
}

export function useConfirm(): ConfirmFn {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error('useConfirm must be called inside <ConfirmProvider>');
  return ctx.confirm;
}

export function usePrompt(): PromptFn {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error('usePrompt must be called inside <ConfirmProvider>');
  return ctx.prompt;
}

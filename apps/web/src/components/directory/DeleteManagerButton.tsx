import { useEffect, useRef, useState } from 'react';
import { Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { Button } from '../shared/Button';
import { deleteManager, type DirectoryEntry } from '../../lib/api/directoryApi';

export function DeleteManagerButton({
  manager,
  onDeleted,
}: {
  manager: DirectoryEntry;
  onDeleted: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [blockingMessage, setBlockingMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(
    () => () => {
      abortRef.current?.abort();
    },
    [],
  );

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Tab') {
        const container = dialogRef.current;
        if (!container) return;
        const focusables = Array.from(
          container.querySelectorAll<HTMLElement>(
            'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
          ),
        );
        if (!focusables.length) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (!first || !last) return;
        const active = document.activeElement as HTMLElement | null;
        if (event.shiftKey) {
          if (active === first || !container.contains(active)) {
            event.preventDefault();
            last.focus();
          }
          return;
        }
        if (active === last) {
          event.preventDefault();
          first.focus();
        }
        return;
      }
      if (event.key === 'Escape' && !deleting) {
        setOpen(false);
        setBlockingMessage(null);
        setErrorMessage(null);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    window.setTimeout(() => cancelRef.current?.focus(), 0);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, deleting]);

  async function confirmDelete() {
    if (deleting) return;
    setDeleting(true);
    setErrorMessage(null);
    abortRef.current?.abort();
    abortRef.current = new AbortController();
    try {
      const result = await deleteManager(manager.id, abortRef.current.signal);
      if (result.status === 204) {
        onDeleted(manager.id);
        setOpen(false);
        toast.success('Manager deleted');
        return;
      }
      if (result.status === 404) {
        onDeleted(manager.id);
        setOpen(false);
        toast.success('Manager was already removed');
        return;
      }
      if (result.status === 409) {
        setBlockingMessage(result.message);
        return;
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      setErrorMessage("Couldn't delete. Try again.");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <>
      <button
        type="button"
        className="rounded p-1 text-gray-600 hover:bg-gray-100 hover:text-red-600 dark:text-gray-300 dark:hover:bg-gray-800"
        onClick={() => {
          setOpen(true);
          setBlockingMessage(null);
          setErrorMessage(null);
        }}
        aria-label={`Delete manager ${manager.firstName} ${manager.lastName}`.trim()}
      >
        <Trash2 size={16} />
      </button>
      {open ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby={`delete-manager-title-${manager.id}`}
          aria-describedby={`delete-manager-body-${manager.id}`}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => {
            if (!deleting) {
              setOpen(false);
              setBlockingMessage(null);
              setErrorMessage(null);
            }
          }}
        >
          <div
            ref={dialogRef}
            className="w-full max-w-md rounded-xl border border-gray-200 bg-white p-5 shadow-xl dark:border-gray-700 dark:bg-gray-900"
            onClick={(event) => event.stopPropagation()}
          >
            <h2 id={`delete-manager-title-${manager.id}`} className="text-lg font-semibold">
              Delete manager?
            </h2>
            <p id={`delete-manager-body-${manager.id}`} className="mt-3 text-sm text-gray-700 dark:text-gray-300">
              {blockingMessage ? (
                blockingMessage
              ) : (
                <>
                  This will permanently remove <strong>{`${manager.firstName} ${manager.lastName}`.trim()}</strong> (
                  <strong>{manager.displayCode}</strong>) from the directory. They will no longer receive audit
                  notifications. This cannot be undone.
                </>
              )}
            </p>
            {errorMessage ? <p className="mt-2 text-sm text-red-600">{errorMessage}</p> : null}
            <div className="mt-5 flex justify-end gap-2">
              <Button
                ref={cancelRef}
                type="button"
                variant="secondary"
                onClick={() => {
                  setOpen(false);
                  setBlockingMessage(null);
                  setErrorMessage(null);
                }}
                disabled={deleting}
              >
                {blockingMessage ? 'Close' : 'Cancel'}
              </Button>
              {!blockingMessage ? (
                <Button type="button" variant="danger" onClick={() => void confirmDelete()} disabled={deleting}>
                  {deleting ? 'Deleting…' : 'Delete'}
                </Button>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

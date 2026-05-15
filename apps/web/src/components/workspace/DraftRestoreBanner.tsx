import { FileClock, RotateCcw, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';
import type { FunctionId } from '@ses/domain';
import type { FileDraftMetadata, WorkbookFile } from '../../lib/domain/types';
import { Button } from '../shared/Button';

export function DraftRestoreBanner({
  draft,
  currentFile,
  processId,
  functionId,
  onRestore,
  onDiscard,
}: {
  draft: FileDraftMetadata | undefined;
  currentFile: WorkbookFile | undefined;
  processId: string;
  functionId: FunctionId;
  onRestore: (processId: string, functionId: FunctionId) => Promise<void>;
  onDiscard: (processId: string, functionId: FunctionId) => Promise<void>;
}) {
  if (!draft?.updatedAt || !draft.fileName) return null;
  const currentDate = currentFile?.uploadedAt ? new Date(currentFile.uploadedAt).getTime() : 0;
  const draftDate = new Date(draft.updatedAt).getTime();
  if (currentDate && draftDate <= currentDate) return null;

  async function restore() {
    try {
      await onRestore(processId, functionId);
      toast.success('Draft restored as the current file version');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not restore draft');
    }
  }

  async function discard() {
    try {
      await onDiscard(processId, functionId);
      toast.success('Draft discarded');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not discard draft');
    }
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-amber-200 bg-amber-50 px-5 py-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-100">
      <div className="flex min-w-0 items-center gap-2">
        <FileClock size={16} />
        <span className="min-w-0 truncate">
          Unsaved draft available: <strong>{draft.fileName}</strong>
          {draft.updatedAt ? ` · ${new Date(draft.updatedAt).toLocaleString()}` : ''}
        </span>
      </div>
      <div className="flex gap-2">
        <Button variant="secondary" leading={<RotateCcw size={14} />} onClick={() => void restore()}>
          Restore
        </Button>
        <Button variant="secondary" leading={<Trash2 size={14} />} onClick={() => void discard()}>
          Discard
        </Button>
      </div>
    </div>
  );
}

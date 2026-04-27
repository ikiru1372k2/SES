/**
 * Issue slice — comments, corrections, and acknowledgments on audit issues.
 */
import type { StateCreator } from 'zustand';
import toast from 'react-hot-toast';
import type { AppStore } from '../types';
import {
  addIssueCommentOnApi,
  deleteIssueCommentOnApi,
  saveIssueCorrectionOnApi,
  clearIssueCorrectionOnApi,
  saveIssueAcknowledgmentOnApi,
} from '../../lib/api/issuesApi';
import { createId } from '../../lib/id';
import type { IssueAcknowledgment, IssueComment } from '../../lib/types';

export type IssueSlice = Pick<
  AppStore,
  | 'addIssueComment'
  | 'deleteIssueComment'
  | 'saveIssueCorrection'
  | 'clearIssueCorrection'
  | 'setIssueAcknowledgment'
  | 'clearIssueAcknowledgment'
>;

function patchProcess<T extends { id: string }>(
  list: T[],
  processId: string,
  updater: (p: T) => T,
): T[] {
  return list.map((p) => (p.id === processId ? updater(p) : p));
}

function serverBackedProcess(
  processes: AppStore['processes'],
  processId: string,
): { displayCode: string } | null {
  const proc = processes.find((p) => p.id === processId);
  if (!proc || !proc.serverBacked || !proc.displayCode) return null;
  return { displayCode: proc.displayCode };
}

export const createIssueSlice: StateCreator<AppStore, [], [], IssueSlice> = (set, get) => ({
  addIssueComment: (processId, issueKey, body, author = 'Auditor') => {
    const trimmed = body.trim();
    if (!trimmed) return;
    const now = new Date().toISOString();
    const tempId = createId('comment');
    const comment: IssueComment = {
      id: tempId,
      issueKey,
      processId,
      author: author.trim() || 'Auditor',
      body: trimmed,
      createdAt: now,
    };
    set((state) => ({
      processes: patchProcess(state.processes, processId, (process) => ({
        ...process,
        comments: {
          ...(process.comments ?? {}),
          [issueKey]: [...(process.comments?.[issueKey] ?? []), comment],
        },
        updatedAt: now,
      })),
    }));
    const server = serverBackedProcess(get().processes, processId);
    if (server) {
      void addIssueCommentOnApi(server.displayCode, issueKey, trimmed)
        .then((apiComment) => {
          set((state) => ({
            processes: patchProcess(state.processes, processId, (process) => ({
              ...process,
              comments: {
                ...(process.comments ?? {}),
                [issueKey]: (process.comments?.[issueKey] ?? []).map((c) =>
                  c.id === tempId ? { ...c, id: apiComment.displayCode } : c,
                ),
              },
            })),
          }));
        })
        .catch((err: unknown) => {
          toast.error(err instanceof Error ? `Comment not added: ${err.message}` : 'Comment not added');
        });
    }
  },

  deleteIssueComment: (processId, issueKey, commentId) => {
    const now = new Date().toISOString();
    set((state) => ({
      processes: patchProcess(state.processes, processId, (process) => ({
        ...process,
        comments: {
          ...(process.comments ?? {}),
          [issueKey]: (process.comments?.[issueKey] ?? []).filter((c) => c.id !== commentId),
        },
        updatedAt: now,
      })),
    }));
    if (serverBackedProcess(get().processes, processId)) {
      void deleteIssueCommentOnApi(commentId).catch((err: unknown) => {
        toast.error(err instanceof Error ? `Comment not deleted: ${err.message}` : 'Comment not deleted');
      });
    }
  },

  saveIssueCorrection: (processId, issueKey, correction) => {
    const now = new Date().toISOString();
    set((state) => ({
      processes: patchProcess(state.processes, processId, (process) => ({
        ...process,
        corrections: {
          ...(process.corrections ?? {}),
          [issueKey]: { issueKey, processId, ...correction, note: correction.note.trim(), updatedAt: now },
        },
        updatedAt: now,
      })),
    }));
    const server = serverBackedProcess(get().processes, processId);
    if (server) {
      void saveIssueCorrectionOnApi(server.displayCode, issueKey, correction).catch((err: unknown) => {
        toast.error(err instanceof Error ? `Correction not saved: ${err.message}` : 'Correction not saved');
      });
    }
  },

  clearIssueCorrection: (processId, issueKey) => {
    const now = new Date().toISOString();
    set((state) => ({
      processes: patchProcess(state.processes, processId, (process) => {
        const corrections = { ...(process.corrections ?? {}) };
        delete corrections[issueKey];
        return { ...process, corrections, updatedAt: now };
      }),
    }));
    const server = serverBackedProcess(get().processes, processId);
    if (server) {
      void clearIssueCorrectionOnApi(server.displayCode, issueKey).catch((err: unknown) => {
        toast.error(err instanceof Error ? `Correction not cleared: ${err.message}` : 'Correction not cleared');
      });
    }
  },

  setIssueAcknowledgment: (processId, issueKey, status) => {
    const now = new Date().toISOString();
    const entry: IssueAcknowledgment = { issueKey, processId, status, updatedAt: now };
    set((state) => ({
      processes: patchProcess(state.processes, processId, (process) => ({
        ...process,
        acknowledgments: { ...(process.acknowledgments ?? {}), [issueKey]: entry },
        updatedAt: now,
      })),
    }));
    const server = serverBackedProcess(get().processes, processId);
    if (server) {
      void saveIssueAcknowledgmentOnApi(server.displayCode, issueKey, { status }).catch((err: unknown) => {
        toast.error(err instanceof Error ? `Acknowledgment not saved: ${err.message}` : 'Acknowledgment not saved');
      });
    }
  },

  clearIssueAcknowledgment: (processId, issueKey) => {
    const now = new Date().toISOString();
    set((state) => ({
      processes: patchProcess(state.processes, processId, (process) => {
        const next = { ...(process.acknowledgments ?? {}) };
        delete next[issueKey];
        return { ...process, acknowledgments: next, updatedAt: now };
      }),
    }));
  },
});

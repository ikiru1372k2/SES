/**
 * Tracking slice — escalation tracking entries, stage mutations, and project-status updates.
 */
import type { StateCreator } from 'zustand';
import toast from 'react-hot-toast';
import { parseProjectStatuses, type EscalationStage, type LegacyProjectTrackingRow } from '@ses/domain';
import type { AppStore } from '../types';
import { upsertTrackingOnApi, addTrackingEventOnApi } from '../../lib/api/trackingApi';
import { makeDefaultTrackingEntry, trackingKey } from '../../lib/tracking';
import type { ProjectTrackingStatus, TrackingChannel, TrackingEntry } from '../../lib/types';

export type TrackingSlice = Pick<
  AppStore,
  | 'recordTrackingEvent'
  | 'setTrackingStage'
  | 'markTrackingResolved'
  | 'reopenTracking'
  | 'updateProjectStatus'
>;

function patchProcess<T extends { id: string }>(
  list: T[],
  processId: string,
  updater: (p: T) => T,
): T[] {
  return list.map((p) => (p.id === processId ? updater(p) : p));
}

function inferStageFromCounts(outlookCount: number, teamsCount: number, resolved: boolean): EscalationStage {
  if (resolved) return 'RESOLVED';
  if (teamsCount > 0) return 'ESCALATED_L1';
  if (outlookCount >= 2) return 'AWAITING_RESPONSE';
  if (outlookCount === 1) return 'SENT';
  return 'NEW';
}

function serverBackedProcess(
  processes: AppStore['processes'],
  processId: string,
): { displayCode: string } | null {
  const proc = processes.find((p) => p.id === processId);
  if (!proc || !proc.serverBacked || !proc.displayCode) return null;
  return { displayCode: proc.displayCode };
}

export const createTrackingSlice: StateCreator<AppStore, [], [], TrackingSlice> = (set, get) => ({
  recordTrackingEvent: (processId, managerName, managerEmail, flaggedProjectCount, channel, note) => {
    const now = new Date().toISOString();
    const key = trackingKey(processId, managerEmail);
    const prior = get().processes.find((p) => p.id === processId)?.notificationTracking[key];
    const server = serverBackedProcess(get().processes, processId);
    if (server) {
      const managerKey = managerEmail.toLowerCase().trim();
      void (async () => {
        try {
          const fresh = serverBackedProcess(get().processes, processId);
          if (!fresh) throw new Error('Process is no longer available');
          const row = await upsertTrackingOnApi(fresh.displayCode, { managerKey, managerName, managerEmail });
          await addTrackingEventOnApi(row.displayCode, { channel, note });
        } catch (err) {
          set((state) => ({
            processes: patchProcess(state.processes, processId, (process) => ({
              ...process,
              notificationTracking: prior
                ? { ...process.notificationTracking, [key]: prior }
                : (() => {
                    const next = { ...process.notificationTracking };
                    delete next[key];
                    return next;
                  })(),
            })),
          }));
          toast.error(err instanceof Error ? `Tracking event not saved: ${err.message}` : 'Tracking event not saved');
        }
      })();
    }
    set((state) => ({
      processes: patchProcess(state.processes, processId, (process) => {
        const entryKey = trackingKey(processId, managerEmail);
        const current = process.notificationTracking[entryKey];
        const outlookCount =
          (current?.outlookCount ?? 0) +
          (channel === 'outlook' || channel === 'eml' || channel === 'sendAll' ? 1 : 0);
        const teamsCount = (current?.teamsCount ?? 0) + (channel === 'teams' ? 1 : 0);
        const stage = inferStageFromCounts(outlookCount, teamsCount, current?.resolved ?? false);
        const base = makeDefaultTrackingEntry(processId, managerName, managerEmail, flaggedProjectCount);
        const entry: TrackingEntry = {
          ...base,
          outlookCount,
          teamsCount,
          lastContactAt: now,
          stage,
          resolved: current?.resolved ?? false,
          history: [...(current?.history ?? []), { channel, at: now, note }],
          projectStatuses: parseProjectStatuses(current?.projectStatuses),
        };
        return { ...process, notificationTracking: { ...process.notificationTracking, [entryKey]: entry }, updatedAt: now };
      }),
    }));
  },

  setTrackingStage: (processId, managerName, managerEmail, flaggedProjectCount, stage) => {
    const now = new Date().toISOString();
    const key = trackingKey(processId, managerEmail);
    const prior = get().processes.find((p) => p.id === processId)?.notificationTracking[key];
    const server = serverBackedProcess(get().processes, processId);
    if (server) {
      void upsertTrackingOnApi(server.displayCode, {
        managerKey: managerEmail.toLowerCase().trim(),
        managerName,
        managerEmail,
        stage,
        resolved: stage === 'RESOLVED',
      }).catch((err) => {
        set((state) => ({
          processes: patchProcess(state.processes, processId, (process) => ({
            ...process,
            notificationTracking: prior
              ? { ...process.notificationTracking, [key]: prior }
              : (() => {
                  const next = { ...process.notificationTracking };
                  delete next[key];
                  return next;
                })(),
          })),
        }));
        toast.error(err instanceof Error ? `Stage not saved: ${err.message}` : 'Stage not saved — reverted.');
      });
    }
    set((state) => ({
      processes: patchProcess(state.processes, processId, (process) => {
        const entryKey = trackingKey(processId, managerEmail);
        const current = process.notificationTracking[entryKey];
        const base = current ?? makeDefaultTrackingEntry(processId, managerName, managerEmail, flaggedProjectCount);
        const nextCounts: Pick<TrackingEntry, 'outlookCount' | 'teamsCount' | 'resolved'> = (() => {
          switch (stage) {
            case 'NEW': return { outlookCount: 0, teamsCount: 0, resolved: false };
            case 'SENT': return { outlookCount: Math.max(base.outlookCount, 1), teamsCount: 0, resolved: false };
            case 'AWAITING_RESPONSE': return { outlookCount: Math.max(base.outlookCount, 2), teamsCount: 0, resolved: false };
            case 'ESCALATED_L1':
            case 'ESCALATED_L2':
            case 'NO_RESPONSE': return { outlookCount: Math.max(base.outlookCount, 1), teamsCount: Math.max(base.teamsCount, 1), resolved: false };
            case 'DRAFTED':
            case 'RESPONDED': return { outlookCount: base.outlookCount, teamsCount: base.teamsCount, resolved: false };
            case 'RESOLVED': return { outlookCount: base.outlookCount, teamsCount: base.teamsCount, resolved: true };
            default: return { outlookCount: base.outlookCount, teamsCount: base.teamsCount, resolved: base.resolved };
          }
        })();
        const entry: TrackingEntry = {
          ...base,
          managerName,
          managerEmail,
          flaggedProjectCount,
          ...nextCounts,
          stage,
          lastContactAt: stage === 'NEW' ? null : now,
          history: [...base.history, { channel: 'manual', at: now, note: `Moved to ${stage}` }],
        };
        return { ...process, notificationTracking: { ...process.notificationTracking, [entryKey]: entry }, updatedAt: now };
      }),
    }));
  },

  markTrackingResolved: (processId, managerEmail) => {
    const now = new Date().toISOString();
    set((state) => ({
      processes: patchProcess(state.processes, processId, (process) => {
        const key = trackingKey(processId, managerEmail);
        const current = process.notificationTracking[key];
        const derivedName = managerEmail.split('@')[0]?.replace(/[._-]+/g, ' ') || 'Unassigned';
        const entry: TrackingEntry = current ?? makeDefaultTrackingEntry(processId, derivedName, managerEmail, 0);
        return {
          ...process,
          notificationTracking: {
            ...process.notificationTracking,
            [key]: { ...entry, resolved: true, stage: 'RESOLVED', lastContactAt: now, history: [...entry.history, { channel: 'manual', at: now, note: 'Marked resolved' }] },
          },
          updatedAt: now,
        };
      }),
    }));
  },

  reopenTracking: (processId, managerEmail) => {
    const now = new Date().toISOString();
    set((state) => ({
      processes: patchProcess(state.processes, processId, (process) => {
        const key = trackingKey(processId, managerEmail);
        const current = process.notificationTracking[key];
        if (!current) return process;
        const stage = inferStageFromCounts(current.outlookCount, current.teamsCount, false);
        return {
          ...process,
          notificationTracking: {
            ...process.notificationTracking,
            [key]: { ...current, resolved: false, stage, history: [...current.history, { channel: 'manual', at: now, note: 'Reopened' }] },
          },
          updatedAt: now,
        };
      }),
    }));
  },

  updateProjectStatus: (processId, managerEmail, projectNo, patch, note) => {
    const now = new Date().toISOString();
    set((state) => ({
      processes: patchProcess(state.processes, processId, (process) => {
        const key = trackingKey(processId, managerEmail);
        const current = process.notificationTracking[key];
        if (!current) return process;
        const parsed = parseProjectStatuses(current.projectStatuses);
        const legacy: Record<string, LegacyProjectTrackingRow> = { ...(parsed.legacyProjects ?? {}) };
        const existingStatus = legacy[projectNo] ?? { projectNo, stage: 'open' as const, feedback: '', history: [], updatedAt: now };
        const newStage = patch.stage ?? existingStatus.stage;
        const stageChanged = patch.stage && patch.stage !== existingStatus.stage;
        const updated: ProjectTrackingStatus = {
          ...existingStatus,
          ...patch,
          history: (stageChanged || note
            ? [...existingStatus.history, { channel: 'manual' as TrackingChannel, at: now, note: note ?? `Stage: ${newStage}` }]
            : existingStatus.history) as ProjectTrackingStatus['history'],
          updatedAt: now,
        };
        return {
          ...process,
          notificationTracking: {
            ...process.notificationTracking,
            [key]: { ...current, projectStatuses: { ...parsed, legacyProjects: { ...legacy, [projectNo]: updated } } },
          },
          updatedAt: now,
        };
      }),
    }));
  },
});

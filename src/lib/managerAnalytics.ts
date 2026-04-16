import type { AuditProcess } from './types';

export type ManagerStat = {
  name: string;
  email: string;
  cyclesFlagged: number;
  responseRate: number;
  averageResolutionDays: number | null;
  chronicSlowResponder: boolean;
  lastContactAt: string | null;
};

export function managerStats(process: AuditProcess): ManagerStat[] {
  const entries = Object.values(process.notificationTracking);
  return entries.map((entry) => {
    const responded = entry.outlookCount > 0 || entry.teamsCount > 0 || entry.resolved;
    const resolutionDays = entry.resolved && entry.lastContactAt && entry.history[0]
      ? (new Date(entry.lastContactAt).getTime() - new Date(entry.history[0].at).getTime()) / (1000 * 60 * 60 * 24)
      : null;
    return {
      name: entry.managerName,
      email: entry.managerEmail,
      cyclesFlagged: 1,
      responseRate: responded ? 1 : 0,
      averageResolutionDays: resolutionDays,
      chronicSlowResponder: !entry.resolved && entry.flaggedProjectCount >= 3,
      lastContactAt: entry.lastContactAt,
    };
  });
}

export function aggregateAcrossProcesses(processes: AuditProcess[]): ManagerStat[] {
  const map = new Map<string, { flagged: number; responded: number; totalResolutionDays: number; resolvedCount: number; lastContactAt: string | null; name: string }>();
  for (const process of processes) {
    for (const entry of Object.values(process.notificationTracking)) {
      const key = entry.managerEmail;
      const current = map.get(key) ?? {
        flagged: 0, responded: 0, totalResolutionDays: 0, resolvedCount: 0, lastContactAt: null, name: entry.managerName,
      };
      current.flagged += 1;
      if (entry.outlookCount > 0 || entry.teamsCount > 0 || entry.resolved) current.responded += 1;
      if (entry.resolved && entry.lastContactAt && entry.history[0]) {
        const days = (new Date(entry.lastContactAt).getTime() - new Date(entry.history[0].at).getTime()) / (1000 * 60 * 60 * 24);
        current.totalResolutionDays += days;
        current.resolvedCount += 1;
      }
      if (!current.lastContactAt || (entry.lastContactAt && entry.lastContactAt > current.lastContactAt)) {
        current.lastContactAt = entry.lastContactAt;
      }
      map.set(key, current);
    }
  }
  return [...map.entries()].map(([email, data]) => ({
    name: data.name,
    email,
    cyclesFlagged: data.flagged,
    responseRate: data.flagged ? data.responded / data.flagged : 0,
    averageResolutionDays: data.resolvedCount ? data.totalResolutionDays / data.resolvedCount : null,
    chronicSlowResponder: data.flagged >= 3 && data.responded / data.flagged < 0.5,
    lastContactAt: data.lastContactAt,
  }));
}

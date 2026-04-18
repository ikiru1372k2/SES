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
  const flaggedVersionCount = new Map<string, number>();
  for (const version of process.versions) {
    const seenThisVersion = new Set<string>();
    for (const issue of version.result.issues) {
      if (!seenThisVersion.has(issue.projectManager)) {
        seenThisVersion.add(issue.projectManager);
        flaggedVersionCount.set(issue.projectManager, (flaggedVersionCount.get(issue.projectManager) ?? 0) + 1);
      }
    }
  }

  return Object.values(process.notificationTracking).map((entry) => {
    const responded = entry.outlookCount > 0 || entry.teamsCount > 0 || entry.resolved;
    const firstContact = entry.history[0]?.at;
    const resolutionDays =
      entry.resolved && entry.lastContactAt && firstContact
        ? (new Date(entry.lastContactAt).getTime() - new Date(firstContact).getTime()) / (1000 * 60 * 60 * 24)
        : null;
    const cyclesFlagged = flaggedVersionCount.get(entry.managerName) ?? 0;

    return {
      name: entry.managerName,
      email: entry.managerEmail,
      cyclesFlagged,
      responseRate: responded ? 1 : 0,
      averageResolutionDays: resolutionDays,
      chronicSlowResponder: cyclesFlagged >= 3 && !responded,
      lastContactAt: entry.lastContactAt,
    };
  });
}

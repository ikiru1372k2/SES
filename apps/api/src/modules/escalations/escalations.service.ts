import { Injectable } from '@nestjs/common';
import type { SessionUser } from '@ses/domain';
import { FUNCTION_REGISTRY, normalizeObservedManagerLabel, type FunctionId } from '@ses/domain';
import type { ProcessEscalationsPayload } from '@ses/domain';
import { PrismaService } from '../../common/prisma.service';
import { ProcessAccessService } from '../../common/process-access.service';
import { aggregateEscalations, type AggregatorIssueRow, type AggregatorTrackingRow } from './escalations-aggregator';

function isIndividualComposeSources(sources: unknown): boolean {
  if (!Array.isArray(sources)) return false;
  return sources.some((source) => typeof source === 'string' && source.trim().length > 0 && source !== '__broadcast__');
}

@Injectable()
export class EscalationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly processAccess: ProcessAccessService,
  ) {}

  async getForProcess(idOrCode: string, user: SessionUser): Promise<ProcessEscalationsPayload> {
    const process = await this.processAccess.findAccessibleProcessOrThrow(user, idOrCode, 'viewer');

    const runs = await Promise.all(
      FUNCTION_REGISTRY.map((fn) =>
        this.prisma.auditRun.findFirst({
          where: {
            processId: process.id,
            file: { functionId: fn.id },
            OR: [{ status: 'completed' }, { completedAt: { not: null } }],
          },
          orderBy: [{ completedAt: { sort: 'desc', nulls: 'last' } }, { startedAt: 'desc' }],
          select: {
            issues: {
              select: {
                issueKey: true,
                projectManager: true,
                email: true,
                projectNo: true,
                projectName: true,
              },
            },
          },
        }),
      ),
    );
    const issues: AggregatorIssueRow[] = [];
    runs.forEach((run, index) => {
      if (!run) return;
      const engineId = FUNCTION_REGISTRY[index]!.id as FunctionId;
      for (const iss of run.issues) {
        issues.push({
          issueKey: iss.issueKey,
          projectManager: iss.projectManager,
          email: iss.email,
          engineId,
          projectNo: iss.projectNo,
          projectName: iss.projectName,
        });
      }
    });

    const trackingRows = await this.prisma.trackingEntry.findMany({
      where: { processId: process.id },
      select: {
        id: true,
        displayCode: true,
        managerKey: true,
        managerName: true,
        managerEmail: true,
        stage: true,
        escalationLevel: true,
        resolved: true,
        lastContactAt: true,
        slaDueAt: true,
        verifiedAt: true,
        verifiedBy: { select: { displayName: true } },
        outlookCount: true,
        teamsCount: true,
        draftLockExpiresAt: true,
        draftLockUser: { select: { displayName: true } },
      },
    });

    const trackingIds = trackingRows.map((t) => t.id);
    const resetEvents = trackingIds.length
      ? await this.prisma.trackingEvent.findMany({
          where: { trackingId: { in: trackingIds }, kind: 'cycle_reset' },
          select: { trackingId: true, at: true },
        })
      : [];
    const latestResetByTrackingId = new Map<string, number>();
    for (const event of resetEvents as Array<{ trackingId: string; at: Date }>) {
      const current = latestResetByTrackingId.get(event.trackingId) ?? 0;
      latestResetByTrackingId.set(event.trackingId, Math.max(current, event.at.getTime()));
    }
    const notificationLogs = trackingIds.length
      ? await this.prisma.notificationLog.findMany({
          where: { trackingEntryId: { in: trackingIds } },
          select: { trackingEntryId: true, channel: true, sources: true, sentAt: true },
        })
      : [];
    const individualCounts = new Map<string, { outlookCount: number; teamsCount: number }>();
    for (const log of notificationLogs as Array<{ trackingEntryId: string | null; channel: string; sources: unknown; sentAt: Date }>) {
      if (!log.trackingEntryId || !isIndividualComposeSources(log.sources)) continue;
      const resetAt = latestResetByTrackingId.get(log.trackingEntryId);
      if (resetAt !== undefined && log.sentAt.getTime() <= resetAt) continue;
      const counts = individualCounts.get(log.trackingEntryId) ?? { outlookCount: 0, teamsCount: 0 };
      if (log.channel === 'teams') counts.teamsCount += 1;
      else if (log.channel === 'email' || log.channel === 'outlook') counts.outlookCount += 1;
      individualCounts.set(log.trackingEntryId, counts);
    }

    const tracking: AggregatorTrackingRow[] = trackingRows.map((t) => ({
      managerKey: t.managerKey,
      managerName: t.managerName,
      managerEmail: t.managerEmail,
      stage: t.stage,
      resolved: t.resolved,
      lastContactAt: t.lastContactAt,
      slaDueAt: t.slaDueAt,
      id: t.id,
      displayCode: t.displayCode,
      outlookCount: individualCounts.get(t.id)?.outlookCount ?? 0,
      teamsCount: individualCounts.get(t.id)?.teamsCount ?? 0,
    }));

    const payload = aggregateEscalations(process.id, issues, tracking);

    const directories = await this.prisma.managerDirectory.findMany({
      where: { tenantId: process.tenantId, active: true },
      select: { normalizedKey: true, email: true },
    });
    const directoryByKey = new Map(
      directories.map((d) => [d.normalizedKey.trim().toLowerCase(), d.email.trim().toLowerCase()]),
    );

    const lockById = new Map(
      trackingRows.map((t) => [
        t.id,
        {
          escalationLevel: t.escalationLevel,
          draftLockExpiresAt: t.draftLockExpiresAt?.toISOString() ?? null,
          draftLockUserDisplayName: t.draftLockUser?.displayName ?? null,
          verifiedAt: t.verifiedAt?.toISOString() ?? null,
          verifiedByName: t.verifiedBy?.displayName ?? null,
        },
      ]),
    );

    const rows = payload.rows.map((row) => {
      const nk = normalizeObservedManagerLabel(row.managerName).toLowerCase();
      const directoryEmail =
        directoryByKey.get(row.managerKey.trim().toLowerCase()) ?? directoryByKey.get(nk) ?? null;
      const extra = row.trackingId ? lockById.get(row.trackingId) : undefined;
      // The aggregator runs before directory enrichment, so its isUnmapped
      // is provisional. Recompute here using the effective email (tracking
      // or issue email, else directory) so a Directory import clears the
      // flag on the next refetch without waiting for a rerun.
      const effectiveEmail = row.resolvedEmail ?? directoryEmail;
      const isUnmapped = !effectiveEmail;
      return {
        ...row,
        directoryEmail,
        isUnmapped,
        escalationLevel: extra?.escalationLevel ?? 0,
        draftLockExpiresAt: extra?.draftLockExpiresAt ?? null,
        draftLockUserDisplayName: extra?.draftLockUserDisplayName ?? null,
        verifiedAt: extra?.verifiedAt ?? null,
        verifiedByName: extra?.verifiedByName ?? null,
      };
    });

    const unmappedManagerCount = rows.filter(
      (r) => r.isUnmapped && (r.totalIssues > 0 || !r.resolved),
    ).length;

    return {
      ...payload,
      summary: { ...payload.summary, unmappedManagerCount },
      rows,
    };
  }
}

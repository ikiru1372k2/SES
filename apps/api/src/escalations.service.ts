import { Injectable } from '@nestjs/common';
import type { SessionUser } from '@ses/domain';
import { FUNCTION_REGISTRY, normalizeObservedManagerLabel, type FunctionId } from '@ses/domain';
import type { ProcessEscalationsPayload } from '@ses/domain';
import { PrismaService } from './common/prisma.service';
import { ProcessAccessService } from './common/process-access.service';
import { aggregateEscalations, type AggregatorIssueRow, type AggregatorTrackingRow } from './escalations-aggregator';

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
      outlookCount: t.outlookCount,
      teamsCount: t.teamsCount,
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
      return {
        ...row,
        directoryEmail,
        escalationLevel: extra?.escalationLevel ?? 0,
        draftLockExpiresAt: extra?.draftLockExpiresAt ?? null,
        draftLockUserDisplayName: extra?.draftLockUserDisplayName ?? null,
        verifiedAt: extra?.verifiedAt ?? null,
        verifiedByName: extra?.verifiedByName ?? null,
      };
    });

    return { ...payload, rows };
  }
}

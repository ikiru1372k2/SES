import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { AuditIssue, AuditResult, SessionUser } from '@ses/domain';
import { compareResults, createId } from '@ses/domain';
import { PrismaService } from './common/prisma.service';
import { ActivityLogService } from './common/activity-log.service';
import { IdentifierService } from './common/identifier.service';
import { ProcessAccessService } from './common/process-access.service';

function serializeVersion(version: {
  id: string;
  displayCode: string;
  versionNumber: number;
  versionName: string;
  notes: string;
  createdAt: Date;
  auditRun: {
    id: string;
    displayCode: string;
    requestId: string;
    fileId: string;
    scannedRows: number;
    flaggedRows: number;
    startedAt: Date;
    completedAt: Date | null;
    policySnapshot: unknown;
    summary: unknown;
    issues: Array<{
      id: string;
      displayCode: string;
      issueKey: string;
      ruleCode: string;
      projectNo: string | null;
      projectName: string | null;
      sheetName: string | null;
      projectManager: string | null;
      projectState: string | null;
      effort: number | null;
      severity: string;
      reason: string | null;
      thresholdLabel: string | null;
      recommendedAction: string | null;
      email: string | null;
      rowIndex: number | null;
      rule: { name: string; version: number; category: string };
    }>;
  };
}) {
  const issues = version.auditRun.issues.map((issue) => ({
    id: issue.id,
    displayCode: issue.displayCode,
    issueKey: issue.issueKey,
    projectNo: issue.projectNo ?? '',
    projectName: issue.projectName ?? '',
    sheetName: issue.sheetName ?? '',
    severity: issue.severity as AuditIssue['severity'],
    projectManager: issue.projectManager ?? '',
    projectState: issue.projectState ?? '',
    effort: issue.effort ?? 0,
    auditStatus: issue.ruleCode,
    notes: issue.reason ?? '',
    rowIndex: issue.rowIndex ?? 0,
    email: issue.email ?? '',
    ruleId: issue.ruleCode,
    ruleCode: issue.ruleCode,
    ruleVersion: issue.rule.version,
    ruleName: issue.rule.name,
    auditRunCode: version.auditRun.displayCode,
    category: issue.rule.category as AuditIssue['category'],
    reason: issue.reason ?? '',
    thresholdLabel: issue.thresholdLabel ?? '',
    recommendedAction: issue.recommendedAction ?? '',
  }));
  return {
    id: version.id,
    displayCode: version.displayCode,
    versionId: version.displayCode,
    versionNumber: version.versionNumber,
    versionName: version.versionName,
    notes: version.notes,
    createdAt: version.createdAt.toISOString(),
    result: {
      id: version.auditRun.id,
      displayCode: version.auditRun.displayCode,
      requestId: version.auditRun.requestId,
      fileId: version.auditRun.fileId,
      runAt: (version.auditRun.completedAt ?? version.auditRun.startedAt).toISOString(),
      scannedRows: version.auditRun.scannedRows,
      flaggedRows: version.auditRun.flaggedRows,
      issues,
      sheets: ((version.auditRun.summary as { sheets?: AuditResult['sheets'] } | null)?.sheets ?? []),
      // PRISMA-JSON: policySnapshot is stored as Json; double-cast recovers the domain type
      policySnapshot: version.auditRun.policySnapshot as unknown as AuditResult['policySnapshot'],
    },
  };
}

@Injectable()
export class VersionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly identifiers: IdentifierService,
    private readonly activity: ActivityLogService,
    private readonly processAccess: ProcessAccessService,
  ) {}

  private async getVersionWithAccess(idOrCode: string, user: SessionUser) {
    const match: Prisma.SavedVersionWhereInput = {
      OR: [{ id: idOrCode }, { displayCode: idOrCode }],
    };
    const scope = this.processAccess.whereProcessReadableBy(user);
    const version = await this.prisma.savedVersion.findFirst({
      where: scope ? { AND: [match, { process: scope }] } : match,
      include: {
        auditRun: {
          include: {
            issues: { include: { rule: true }, orderBy: { displayCode: 'asc' } },
          },
        },
      },
    });
    if (!version) throw new NotFoundException(`Version ${idOrCode} not found`);
    await this.processAccess.assertCanAccessProcess(user, version.processId);
    return version;
  }

  async create(processIdOrCode: string, body: { auditRunIdOrCode?: string; versionName: string; notes?: string }, user: SessionUser) {
    const process = await this.processAccess.findAccessibleProcessOrThrow(user, processIdOrCode, 'editor');
    return this.prisma.$transaction(async (tx) => {
      const auditRun = body.auditRunIdOrCode
        ? await tx.auditRun.findFirst({
            where: {
              processId: process.id,
              OR: [{ id: body.auditRunIdOrCode }, { displayCode: body.auditRunIdOrCode }],
            },
          })
        : await tx.auditRun.findFirst({
            where: { processId: process.id, status: 'completed' },
            orderBy: { completedAt: 'desc' },
          });
      if (!auditRun) throw new NotFoundException('No completed audit run available to save');
      const latest = await tx.savedVersion.aggregate({
        where: { processId: process.id },
        _max: { versionNumber: true },
      });
      const version = await tx.savedVersion.create({
        data: {
          id: createId(),
          displayCode: await this.identifiers.nextVersionCode(tx, process.displayCode),
          processId: process.id,
          auditRunId: auditRun.id,
          versionNumber: (latest._max.versionNumber ?? 0) + 1,
          versionName: body.versionName.trim(),
          notes: body.notes?.trim() ?? '',
          createdById: user.id,
        } as any, // PRISMA-JSON: unavoidable until Prisma 6 supports typed JSON columns
        include: {
          auditRun: {
            include: {
              issues: { include: { rule: true }, orderBy: { displayCode: 'asc' } },
            },
          },
        },
      });
      await this.activity.append(tx, {
        actorId: user.id,
        actorEmail: user.email,
        processId: process.id,
        entityType: 'saved_version',
        entityId: version.id,
        entityCode: version.displayCode,
        action: 'version.saved',
        after: { versionCode: version.displayCode, auditRunCode: auditRun.displayCode },
      });
      return serializeVersion(version);
    });
  }

  async list(processIdOrCode: string, user: SessionUser) {
    const process = await this.processAccess.findAccessibleProcessOrThrow(user, processIdOrCode);
    const versions = await this.prisma.savedVersion.findMany({
      where: { processId: process.id },
      orderBy: { versionNumber: 'desc' },
      include: {
        auditRun: {
          include: {
            issues: { include: { rule: true }, orderBy: { displayCode: 'asc' } },
          },
        },
      },
    });
    return versions.map(serializeVersion);
  }

  async get(idOrCode: string, user: SessionUser) {
    const version = await this.getVersionWithAccess(idOrCode, user);
    return serializeVersion(version);
  }

  async compare(a: string, b: string, user: SessionUser) {
    const fromVersion = await this.getVersionWithAccess(a, user);
    const toVersion = await this.getVersionWithAccess(b, user);
    if (fromVersion.processId !== toVersion.processId) {
      throw new BadRequestException('Versions belong to different processes');
    }
    const from = serializeVersion(fromVersion);
    const to = serializeVersion(toVersion);
    return compareResults(from.result, to.result);
  }
}

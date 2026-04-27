import { Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { SessionUser } from '@ses/domain';
import { PrismaService } from '../../common/prisma.service';
import { ProcessAccessService } from '../../common/process-access.service';
import { serializeIssue, serializeRun } from './audit-serializers';

@Injectable()
export class AuditResultsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly processAccess: ProcessAccessService,
  ) {}

  async getRunWithAccess(user: SessionUser, idOrCode: string) {
    const match: Prisma.AuditRunWhereInput = {
      OR: [{ id: idOrCode }, { displayCode: idOrCode }],
    };
    const scope = this.processAccess.whereProcessReadableBy(user);
    const run = await this.prisma.auditRun.findFirst({
      where: scope ? { AND: [match, { process: scope }] } : match,
      include: {
        issues: { include: { auditRun: true, rule: true }, orderBy: { displayCode: 'asc' } },
      },
    });
    if (!run) throw new NotFoundException(`Audit run ${idOrCode} not found`);
    await this.processAccess.assertCanAccessProcess(user, run.processId);
    return run;
  }

  async get(idOrCode: string, user: SessionUser) {
    return serializeRun(await this.getRunWithAccess(user, idOrCode));
  }

  async issues(idOrCode: string, user: SessionUser) {
    const run = await this.getRunWithAccess(user, idOrCode);
    return run.issues.map(serializeIssue);
  }

  // Latest completed audit run for a given file. Used by the web client
  // when the user lands on the Audit Results tab via a deep link (e.g.
  // "Open evidence" from the Escalation Center) — at that point the
  // Zustand `currentAuditResult` is null because the run wasn't initiated
  // from this browser session, and there's no other client-side cache of
  // the issue list. Returns 404 if no completed run exists for the file
  // yet (caller should treat as "no audit run yet").
  async latestForFile(processIdOrCode: string, fileIdOrCode: string, user: SessionUser) {
    const process = await this.processAccess.findAccessibleProcessOrThrow(user, processIdOrCode);
    const file = await this.prisma.workbookFile.findFirst({
      where: {
        processId: process.id,
        OR: [{ id: fileIdOrCode }, { displayCode: fileIdOrCode }],
      },
      select: { id: true },
    });
    if (!file) throw new NotFoundException(`File ${fileIdOrCode} not found`);
    const run = await this.prisma.auditRun.findFirst({
      where: {
        processId: process.id,
        fileId: file.id,
        OR: [{ status: 'completed' }, { completedAt: { not: null } }],
      },
      orderBy: [{ completedAt: 'desc' }, { startedAt: 'desc' }],
      include: {
        issues: { include: { auditRun: true, rule: true }, orderBy: { displayCode: 'asc' } },
      },
    });
    if (!run) throw new NotFoundException(`No completed audit run for file ${fileIdOrCode}`);
    return serializeRun(run);
  }

  async listForProcess(processIdOrCode: string, functionId: string | undefined, user: SessionUser) {
    const process = await this.processAccess.findAccessibleProcessOrThrow(user, processIdOrCode, 'viewer');
    return this.prisma.auditRun.findMany({
      where: {
        processId: process.id,
        status: 'completed',
        ...(functionId ? { file: { functionId } } : {}),
      },
      orderBy: { completedAt: 'desc' },
      take: 20,
      select: {
        id: true,
        displayCode: true,
        completedAt: true,
        scannedRows: true,
        flaggedRows: true,
        file: { select: { functionId: true, name: true, displayCode: true } },
      },
    });
  }
}

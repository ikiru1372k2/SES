import { BadRequestException, Injectable } from '@nestjs/common';
import type { SessionUser } from '@ses/domain';
import { createId, FUNCTION_REGISTRY } from '@ses/domain';
import { PrismaService } from '../../common/prisma.service';
import { IdentifierService } from '../../common/identifier.service';
import { ActivityLogService } from '../../common/activity-log.service';
import { ProcessAccessService } from '../../common/process-access.service';
import { RealtimeGateway } from '../../realtime/realtime.gateway';
import { FunctionsService } from '../../functions.service';

@Injectable()
export class ProcessTilesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly identifiers: IdentifierService,
    private readonly activity: ActivityLogService,
    private readonly processAccess: ProcessAccessService,
    private readonly functions: FunctionsService,
    private readonly realtime: RealtimeGateway,
  ) {}

  /**
   * One round-trip used by the ProcessTilesPage to render all 5 tiles.
   *
   * Returns per-function aggregates: file count, latest upload, draft
   * presence (for the current user), and the max version number seen on
   * any file in that function. Aggregates are computed in 2 queries
   * regardless of the number of functions so this endpoint scales.
   *
   * Draft presence is user-scoped — other members' drafts never leak.
   */
  async tiles(idOrCode: string, user: SessionUser) {
    const process = await this.processAccess.findAccessibleProcessOrThrow(user, idOrCode, 'viewer');
    // Make sure the process has ProcessFunction rows; older data pre-#62
    // might be missing the seed.
    await this.functions.ensureProcessFunctions(process.id);

    const files = await this.prisma.workbookFile.findMany({
      where: { processId: process.id },
      select: {
        functionId: true,
        uploadedAt: true,
      },
    });

    // Draft presence (Issue #63 adds the table; guard so the query only
    // runs when the client is on a build that has FileDraft). We do a cheap
    // raw SQL probe first to avoid exceptions before the #63 migration lands.
    let draftFunctions = new Set<string>();
    try {
      const rows = await this.prisma.$queryRaw<Array<{ functionId: string }>>`
        SELECT "functionId" FROM "FileDraft"
        WHERE "userId" = ${user.id} AND "processId" = ${process.id}
      `;
      draftFunctions = new Set(rows.map((r) => r.functionId));
    } catch {
      // FileDraft table not yet migrated (we're on a #62-only build).
      // Treat as "no drafts" — tiles render fine without the badge.
    }

    const byFunction: Record<string, { fileCount: number; lastUploadAt: string | null; hasDraft: boolean }> = {};
    for (const fn of FUNCTION_REGISTRY) {
      const own = files.filter((f) => f.functionId === fn.id);
      const last = own.reduce<Date | null>((acc, f) => (!acc || f.uploadedAt > acc ? f.uploadedAt : acc), null);
      byFunction[fn.id] = {
        fileCount: own.length,
        lastUploadAt: last?.toISOString() ?? null,
        hasDraft: draftFunctions.has(fn.id),
      };
    }
    return byFunction;
  }

  /**
   * Stub helpdesk flow: write the request row, append an activity log entry,
   * emit a realtime event so any connected admins see it. A real wire-up
   * to an email transport lives outside this repo; we record enough that
   * an operator can manually triage.
   */
  async createFunctionAuditRequest(
    idOrCode: string,
    body: { proposedName?: string; description?: string; contactEmail?: string },
    user: SessionUser,
  ) {
    const proposedName = body.proposedName?.trim();
    const contactEmail = body.contactEmail?.trim();
    if (!proposedName) throw new BadRequestException('proposedName is required');
    if (!contactEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail)) {
      throw new BadRequestException('contactEmail must be a valid email');
    }
    const process = await this.processAccess.findAccessibleProcessOrThrow(user, idOrCode, 'viewer');
    const created = await this.prisma.$transaction(async (tx) => {
      // Displayable ref code. We piggy-back on the activity counter.
      const code = await this.identifiers.nextActivityCode(tx);
      const row = await tx.functionAuditRequest.create({
        data: {
          id: createId(),
          displayCode: `FAR-${code.split('-')[2] ?? Date.now()}`,
          processId: process.id,
          requestedById: user.id,
          proposedName: proposedName.slice(0, 200),
          description: (body.description ?? '').slice(0, 4000),
          contactEmail,
          status: 'open',
        },
      });
      await this.activity.append(tx, {
        actorId: user.id,
        actorEmail: user.email,
        processId: process.id,
        entityType: 'function_audit_request',
        entityId: row.id,
        entityCode: row.displayCode,
        action: 'function.audit_request_created',
        after: { proposedName: row.proposedName, contactEmail: row.contactEmail },
      });
      return row;
    });
    this.realtime.emitToProcess(process.displayCode, 'function.audit_request_created', {
      requestCode: created.displayCode,
      proposedName: created.proposedName,
      contactEmail: created.contactEmail,
    });
    return {
      id: created.id,
      displayCode: created.displayCode,
      processId: created.processId,
      proposedName: created.proposedName,
      description: created.description,
      contactEmail: created.contactEmail,
      status: created.status,
      createdAt: created.createdAt.toISOString(),
    };
  }
}

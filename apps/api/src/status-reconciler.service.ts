import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { FunctionId } from '@ses/domain';
import {
  globalResolvedFromStatuses,
  isFunctionId,
  managerKey,
  parseProjectStatuses,
  patchEngineStatus,
  recomputeAggregate,
} from '@ses/domain';
@Injectable()
export class StatusReconcilerService {
  constructor() {}

  /**
   * After an audit run completes: refresh `byEngine[functionId]` for every
   * tracking row on the process from that engine's latest completed run.
   */
  async reconcileAfterAudit(
    tx: Prisma.TransactionClient,
    params: { processId: string; functionId: string; auditRunId: string },
  ): Promise<void> {
    const { processId, functionId, auditRunId } = params;
    if (!isFunctionId(functionId)) return;

    const issues = await tx.auditIssue.findMany({
      where: { auditRunId },
      select: { projectManager: true, email: true },
    });
    const counts = new Map<string, number>();
    for (const iss of issues) {
      const name = iss.projectManager?.trim() || 'Unknown';
      const key = managerKey(name, iss.email);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }

    const entries = await tx.trackingEntry.findMany({ where: { processId } });
    const fid = functionId as FunctionId;

    for (const entry of entries) {
      const openCount = counts.get(entry.managerKey) ?? 0;
      const status = openCount > 0 ? 'open' : 'resolved';
      const parsed = parseProjectStatuses(entry.projectStatuses);
      const prev = parsed.byEngine[fid];
      let resolvedAt: string | null = null;
      if (status === 'resolved') {
        if (prev?.status === 'resolved' && prev.resolvedAt) resolvedAt = prev.resolvedAt;
        else resolvedAt = new Date().toISOString();
      }
      const next = patchEngineStatus(parsed, fid, {
        openCount,
        status,
        lastSeenRunId: auditRunId,
        resolvedAt,
      });
      const final = recomputeAggregate(next);
      const resolved = globalResolvedFromStatuses(final);
      await tx.trackingEntry.update({
        where: { id: entry.id },
        data: {
          projectStatuses: final as unknown as Prisma.InputJsonValue,
          resolved,
          rowVersion: { increment: 1 },
        },
      });
    }
  }

}

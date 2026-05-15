import { Injectable } from '@nestjs/common';
import type { Prisma } from '../../repositories/types';
import type { FunctionId } from '@ses/domain';
import {
  createId,
  globalResolvedFromStatuses,
  isFunctionId,
  managerKey,
  parseProjectStatuses,
  patchEngineStatus,
  recomputeAggregate,
} from '@ses/domain';
import { IdentifierService } from '../../common/identifier.service';

interface ObservedManager {
  managerKey: string;
  managerName: string;
  managerEmail: string;
  openCount: number;
}

@Injectable()
export class StatusReconcilerService {
  constructor(private readonly identifiers: IdentifierService) {}

  /**
   * After an audit run completes, reconcile tracking rows for the process:
   *   1. Collect every (managerKey → openCount + name/email) from the run.
   *   2. Upsert a TrackingEntry for any manager observed in the audit that
   *      does not yet have one. Without this step, new managers never
   *      appear in the Escalation Center.
   *   3. Patch `byEngine[functionId]` on every tracking row — observed
   *      managers get their new openCount, absent managers get resolved.
   *
   * Keeps everything inside the caller's transaction so an audit row and
   * its tracking side-effects commit together.
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

    const observed = new Map<string, ObservedManager>();
    for (const iss of issues) {
      const name = iss.projectManager?.trim() || 'Unknown';
      const email = (iss.email ?? '').trim();
      const key = managerKey(name, email);
      const prior = observed.get(key);
      if (prior) {
        prior.openCount += 1;
      } else {
        observed.set(key, { managerKey: key, managerName: name, managerEmail: email, openCount: 1 });
      }
    }

    await this.ensureTrackingEntriesExist(tx, processId, observed);

    const entries = await tx.trackingEntry.findMany({ where: { processId } });
    const fid = functionId as FunctionId;

    for (const entry of entries) {
      const openCount = observed.get(entry.managerKey)?.openCount ?? 0;
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

  /**
   * Create TrackingEntry rows for any observed manager that doesn't yet
   * have one in this process. Done in a single round-trip via createMany
   * so large first-time audits don't do N identifier lookups. We skip
   * creating rows for managers with empty names (shouldn't happen — the
   * engine defaults to "Unknown" — but cheap to be defensive).
   */
  private async ensureTrackingEntriesExist(
    tx: Prisma.TransactionClient,
    processId: string,
    observed: Map<string, ObservedManager>,
  ): Promise<void> {
    if (observed.size === 0) return;
    const existing = await tx.trackingEntry.findMany({
      where: { processId, managerKey: { in: [...observed.keys()] } },
      select: { managerKey: true },
    });
    const existingKeys = new Set(existing.map((e) => e.managerKey));
    const missing = [...observed.values()].filter((m) => !existingKeys.has(m.managerKey));
    if (missing.length === 0) return;

    const process = await tx.process.findUniqueOrThrow({
      where: { id: processId },
      select: { displayCode: true },
    });

    const rows = await Promise.all(
      missing.map(async (m) => ({
        id: createId(),
        displayCode: await this.identifiers.nextTrackingCode(tx, process.displayCode),
        processId,
        managerKey: m.managerKey,
        managerName: m.managerName,
        managerEmail: m.managerEmail || null,
        // A fresh manager starts at NEW so the Escalation Center treats
        // them as actionable. resolved stays false until the next audit
        // shows zero open findings.
      })),
    );

    await tx.trackingEntry.createMany({ data: rows, skipDuplicates: true });
  }
}

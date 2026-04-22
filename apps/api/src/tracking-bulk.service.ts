import { BadRequestException, Injectable } from '@nestjs/common';
import type { SessionUser } from '@ses/domain';
import { createId } from '@ses/domain';
import { IdentifierService } from './common/identifier.service';
import { ProcessAccessService } from './common/process-access.service';
import { PrismaService } from './common/prisma.service';
import { TrackingComposeService, type ComposeDraftPayload } from './tracking-compose/tracking-compose.service';
import { TrackingService } from './tracking.service';

type BulkComposeInput = {
  trackingIds: string[];
  payload?: Partial<ComposeDraftPayload>;
};

type BulkSendInput = {
  trackingIds: string[];
  payload: ComposeDraftPayload & { sources: string[] };
};

type BroadcastInput = {
  processIdOrCode: string;
  payload: ComposeDraftPayload & { sources: string[] };
  filter?: { functionId?: string; includeResolved?: boolean };
};

@Injectable()
export class TrackingBulkService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly processAccess: ProcessAccessService,
    private readonly compose: TrackingComposeService,
    private readonly tracking: TrackingService,
    private readonly identifiers: IdentifierService,
  ) {}

  private async listEntries(trackingIds: string[], user: SessionUser) {
    if (trackingIds.length === 0) {
      throw new BadRequestException('trackingIds is required');
    }
    const entries = await this.prisma.trackingEntry.findMany({
      where: { id: { in: trackingIds } },
      include: { process: true },
      orderBy: { managerName: 'asc' },
    });
    if (entries.length !== trackingIds.length) {
      throw new BadRequestException('Some trackingIds were not found');
    }
    const processIds = [...new Set(entries.map((entry) => entry.processId))];
    if (processIds.length !== 1) {
      throw new BadRequestException('Bulk operations support one process at a time');
    }
    const processId = processIds[0];
    if (!processId) throw new BadRequestException('Bulk operation requires process scope');
    await this.processAccess.require(processId, user, 'editor');
    return entries;
  }

  async composeBulk(input: BulkComposeInput, user: SessionUser) {
    const entries = await this.listEntries(input.trackingIds, user);
    const previews = await Promise.all(
      entries.map(async (entry) => {
        const preview = await this.compose.preview(entry.id, user, input.payload ?? {});
        return {
          trackingId: entry.id,
          managerName: entry.managerName,
          managerEmail: entry.managerEmail,
          subject: preview.subject,
          body: preview.body,
        };
      }),
    );
    return { previews };
  }

  async sendBulk(input: BulkSendInput, user: SessionUser) {
    const entries = await this.listEntries(input.trackingIds, user);
    let success = 0;
    let failed = 0;
    let skipped = 0;
    const progress: Array<Record<string, unknown>> = [];
    for (const [index, entry] of entries.entries()) {
      // Fail-soft for the most common "soft" reason a row can't be sent:
      // the manager is not in the directory yet and no email is attached.
      // Previously TrackingComposeService.send() would throw a generic 400,
      // the catch-all below would log it as "failed", and the auditor would
      // have to cross-reference the error text. Now the UI can show a
      // "Missing email — add to directory" chip and keep the row selectable
      // so the auditor can fix the root cause once and retry.
      const managerEmail = (entry.managerEmail ?? '').trim();
      if (!managerEmail) {
        skipped += 1;
        progress.push({
          index,
          trackingId: entry.id,
          managerName: entry.managerName,
          state: 'skipped',
          reason: 'missing_email',
          success,
          failed,
          skipped,
          total: entries.length,
        });
        continue;
      }
      try {
        await this.compose.send(entry.id, user, input.payload);
        success += 1;
        progress.push({
          index,
          trackingId: entry.id,
          managerName: entry.managerName,
          state: 'sent',
          success,
          failed,
          skipped,
          total: entries.length,
        });
      } catch (error) {
        failed += 1;
        progress.push({
          index,
          trackingId: entry.id,
          managerName: entry.managerName,
          state: 'failed',
          error: (error as Error).message,
          success,
          failed,
          skipped,
          total: entries.length,
        });
      }
    }
    return { progress, success, failed, skipped, total: entries.length };
  }

  async markResolved(trackingIds: string[], user: SessionUser) {
    const entries = await this.listEntries(trackingIds, user);
    await Promise.all(
      entries.map((entry) =>
        this.tracking.transition(
          entry.id,
          { to: 'RESOLVED', reason: 'bulk_resolve', sourceAction: 'bulk.resolve' },
          user,
        ),
      ),
    );
    return { ok: true, count: entries.length };
  }

  /**
   * Mark entries as acknowledged — mapped to the RESPONDED stage because
   * the domain state machine doesn't carry a separate ACKNOWLEDGED node.
   * Transitions that are already past RESPONDED (NO_RESPONSE / ESCALATED_*)
   * are still eligible: the ladder treats acknowledgment as a response.
   */
  async markAcknowledged(trackingIds: string[], note: string, user: SessionUser) {
    const entries = await this.listEntries(trackingIds, user);
    const reason = note.trim() || 'bulk_acknowledge';
    let applied = 0;
    const skipped: Array<{ trackingId: string; reason: string }> = [];
    for (const entry of entries) {
      try {
        await this.tracking.transition(
          entry.id,
          { to: 'RESPONDED', reason, sourceAction: 'bulk.acknowledge' },
          user,
        );
        applied += 1;
      } catch (err) {
        skipped.push({ trackingId: entry.id, reason: (err as Error).message });
      }
    }
    return { ok: true, applied, skipped, total: entries.length };
  }

  /**
   * Push the SLA timer forward by N days without changing the stage. The
   * SLA engine re-checks slaDueAt on its next tick; moving the deadline
   * is the cheapest way to "snooze" without faking progress.
   *
   * Each entry gets its own slaDueAt bump (since they start from different
   * baselines), but the event rows are batched via createMany so the
   * transaction is O(2N) round-trips at worst instead of O(3N).
   */
  async snooze(trackingIds: string[], days: number, note: string, user: SessionUser) {
    if (!Number.isFinite(days) || days <= 0 || days > 90) {
      throw new BadRequestException('days must be between 1 and 90');
    }
    const entries = await this.listEntries(trackingIds, user);
    const reason = note.trim() || `bulk_snooze:${days}d`;
    const bumpMs = days * 24 * 60 * 60 * 1000;
    await this.prisma.$transaction(async (tx) => {
      // Pre-compute event rows + their display codes up front so the
      // createMany below is a single round trip.
      const eventRows = await Promise.all(
        entries.map(async (entry) => {
          const base = entry.slaDueAt ?? new Date();
          const next = new Date(base.getTime() + bumpMs);
          return {
            row: {
              id: createId(),
              displayCode: await this.identifiers.nextTrackingEventCode(tx),
              trackingId: entry.id,
              kind: 'sla_snoozed' as const,
              channel: 'manual' as const,
              note: reason,
              reason: 'bulk_snooze' as const,
              payload: { days, slaDueAt: next.toISOString() } as object,
              triggeredById: user.id,
            },
            nextDue: next,
            entryId: entry.id,
          };
        }),
      );

      // slaDueAt differs per entry, so updateMany can't do it in one SQL
      // call. Keep the per-entry update but drop the nested event insert.
      for (const r of eventRows) {
        await tx.trackingEntry.update({
          where: { id: r.entryId },
          data: { slaDueAt: r.nextDue, rowVersion: { increment: 1 } },
        });
      }
      await tx.trackingEvent.createMany({ data: eventRows.map((r) => r.row) });
    });
    return { ok: true, count: entries.length, days };
  }

  /**
   * Walk the ladder one step forward. AWAITING_RESPONSE/NO_RESPONSE step
   * up to ESCALATED_L1; ESCALATED_L1 steps to ESCALATED_L2. Anything past
   * that (or already RESOLVED) is skipped with a clear reason instead of
   * a 500.
   */
  async reescalate(trackingIds: string[], note: string, user: SessionUser) {
    const entries = await this.listEntries(trackingIds, user);
    const reason = note.trim() || 'bulk_reescalate';
    let applied = 0;
    const skipped: Array<{ trackingId: string; reason: string }> = [];
    for (const entry of entries) {
      const to = pickReescalationTarget(entry.stage);
      if (!to) {
        skipped.push({ trackingId: entry.id, reason: `cannot reescalate from ${entry.stage}` });
        continue;
      }
      try {
        await this.tracking.transition(
          entry.id,
          { to, reason, sourceAction: 'bulk.reescalate' },
          user,
        );
        applied += 1;
      } catch (err) {
        skipped.push({ trackingId: entry.id, reason: (err as Error).message });
      }
    }
    return { ok: true, applied, skipped, total: entries.length };
  }

  /**
   * Broadcast to every manager with open findings in a process. Optional
   * filter by functionId (only escalate findings produced by one engine)
   * or includeResolved (sweep even resolved rows; rarely useful, but
   * supported for "compliance reminder" workflows).
   *
   * Re-uses the same per-entry send pipeline as sendBulk so missing-email
   * rows are skipped rather than failing the whole call, and every send
   * creates the usual NotificationLog + TrackingEvent audit trail.
   */
  async broadcast(input: BroadcastInput, user: SessionUser) {
    const process = await this.processAccess.findAccessibleProcessOrThrow(
      user,
      input.processIdOrCode,
      'editor',
    );
    const entries = await this.prisma.trackingEntry.findMany({
      where: {
        processId: process.id,
        ...(input.filter?.includeResolved ? {} : { resolved: false }),
      },
      select: { id: true, managerName: true, managerEmail: true, projectStatuses: true },
      orderBy: { managerName: 'asc' },
    });

    // Optional filter: only include managers who have open findings under
    // the requested functionId. Done in memory since the count is tiny
    // and the query would otherwise need a JSON where-clause.
    const filtered = input.filter?.functionId
      ? entries.filter((entry) => {
          const parsed = (entry.projectStatuses ?? {}) as {
            byEngine?: Record<string, { openCount?: number }>;
          };
          const fid = input.filter!.functionId!;
          return (parsed.byEngine?.[fid]?.openCount ?? 0) > 0;
        })
      : entries;

    if (filtered.length === 0) {
      return { progress: [], success: 0, failed: 0, skipped: 0, total: 0, audience: 0 };
    }

    const result = await this.sendBulk(
      { trackingIds: filtered.map((e) => e.id), payload: input.payload },
      user,
    );
    return { ...result, audience: filtered.length };
  }
}

function pickReescalationTarget(stage: string): 'ESCALATED_L1' | 'ESCALATED_L2' | null {
  switch (stage) {
    case 'AWAITING_RESPONSE':
    case 'NO_RESPONSE':
    case 'SENT':
      return 'ESCALATED_L1';
    case 'ESCALATED_L1':
      return 'ESCALATED_L2';
    default:
      return null;
  }
}

import { BadRequestException, Injectable } from '@nestjs/common';
import type { SessionUser } from '@ses/domain';
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

@Injectable()
export class TrackingBulkService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly processAccess: ProcessAccessService,
    private readonly compose: TrackingComposeService,
    private readonly tracking: TrackingService,
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
    const progress: Array<Record<string, unknown>> = [];
    for (const [index, entry] of entries.entries()) {
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
          total: entries.length,
        });
      }
    }
    return { progress, success, failed, total: entries.length };
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
}

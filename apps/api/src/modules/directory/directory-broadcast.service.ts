import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma.service';
import { RealtimeGateway } from '../../realtime/realtime.gateway';
import type { DirectoryUpdatedPayload } from '../../realtime/realtime.types';

@Injectable()
export class DirectoryBroadcastService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeGateway,
  ) {}

  /**
   * Directory mutations are tenant-scoped, but the realtime gateway rooms
   * are per-process. Fan the notification out to every non-archived process
   * in the tenant so any open EscalationCenter / Workspace tab re-derives
   * its "unmapped manager" state without a reload. Cheap: one SELECT on
   * PRIMARY-KEYed data plus N in-memory emits.
   */
  async broadcastDirectoryUpdate(
    tenantId: string,
    payload: Omit<DirectoryUpdatedPayload, 'tenantId'>,
  ): Promise<void> {
    const processes = await this.prisma.process.findMany({
      where: { tenantId, archivedAt: null },
      select: { displayCode: true },
    });
    const envelope: DirectoryUpdatedPayload = { tenantId, ...payload };
    for (const p of processes) {
      this.realtime.emitToProcess(p.displayCode, 'directory.updated', envelope);
    }
  }
}

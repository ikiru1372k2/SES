import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import type { SessionUser } from '@ses/domain';
import { AuthGuard } from '../../../auth.guard';
import { AccessScopeService } from '../../../common/access-scope.service';
import { CurrentUser } from '../../../common/current-user';
import { PrismaService } from '../../../common/prisma.service';
import { ProcessAccessService } from '../../../common/process-access.service';
import { TrackingBulkService } from './tracking-bulk.service';
import type { ComposeDraftPayload } from '../compose/tracking-compose.service';

@Controller('tracking/bulk')
@UseGuards(AuthGuard)
export class TrackingBulkController {
  constructor(
    private readonly trackingBulk: TrackingBulkService,
    private readonly accessScope: AccessScopeService,
    private readonly processAccess: ProcessAccessService,
    private readonly prisma: PrismaService,
  ) {}

  private async requireEditForTrackingIds(trackingIds: string[], user: SessionUser) {
    const first = trackingIds[0];
    if (!first) return;
    const entry = await this.prisma.trackingEntry.findFirst({
      where: { OR: [{ id: first }, { displayCode: first }] },
      select: { processId: true },
    });
    if (!entry) return;
    await this.accessScope.require(entry.processId, user, {
      kind: 'escalation-center',
      action: 'edit',
    });
  }

  private async requireEditForProcess(processIdOrCode: string, user: SessionUser) {
    const process = await this.processAccess.findAccessibleProcessOrThrow(user, processIdOrCode, 'viewer');
    await this.accessScope.require(process.id, user, {
      kind: 'escalation-center',
      action: 'edit',
    });
  }

  @Post('compose')
  async compose(
    @Body() body: { trackingIds: string[]; payload?: Partial<ComposeDraftPayload> },
    @CurrentUser() user: SessionUser,
  ) {
    await this.requireEditForTrackingIds(body.trackingIds, user);
    return this.trackingBulk.composeBulk(body, user);
  }

  @Post('send')
  async send(
    @Body() body: { trackingIds: string[]; payload: ComposeDraftPayload & { sources: string[] } },
    @CurrentUser() user: SessionUser,
  ) {
    await this.requireEditForTrackingIds(body.trackingIds, user);
    return this.trackingBulk.sendBulk(body, user);
  }

  @Post('resolve')
  async resolve(@Body() body: { trackingIds: string[] }, @CurrentUser() user: SessionUser) {
    await this.requireEditForTrackingIds(body.trackingIds, user);
    return this.trackingBulk.markResolved(body.trackingIds, user);
  }

  @Post('acknowledge')
  async acknowledge(@Body() body: { trackingIds: string[]; note?: string }, @CurrentUser() user: SessionUser) {
    await this.requireEditForTrackingIds(body.trackingIds, user);
    return this.trackingBulk.markAcknowledged(body.trackingIds, body.note ?? '', user);
  }

  @Post('snooze')
  async snooze(
    @Body() body: { trackingIds: string[]; days: number; note?: string },
    @CurrentUser() user: SessionUser,
  ) {
    await this.requireEditForTrackingIds(body.trackingIds, user);
    return this.trackingBulk.snooze(body.trackingIds, body.days, body.note ?? '', user);
  }

  @Post('reescalate')
  async reescalate(
    @Body() body: { trackingIds: string[]; note?: string },
    @CurrentUser() user: SessionUser,
  ) {
    await this.requireEditForTrackingIds(body.trackingIds, user);
    return this.trackingBulk.reescalate(body.trackingIds, body.note ?? '', user);
  }

  @Post('broadcast')
  async broadcast(
    @Body()
    body: {
      processIdOrCode: string;
      payload: ComposeDraftPayload & { sources: string[] };
      filter?: { functionId?: string; includeResolved?: boolean };
    },
    @CurrentUser() user: SessionUser,
  ) {
    await this.requireEditForProcess(body.processIdOrCode, user);
    return this.trackingBulk.broadcast(body, user);
  }
}

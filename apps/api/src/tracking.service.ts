import { Injectable, NotFoundException } from '@nestjs/common';
import type { SessionUser } from '@ses/domain';
import { createId } from '@ses/domain';
import { PrismaService } from './common/prisma.service';
import { ActivityLogService } from './common/activity-log.service';
import { IdentifierService } from './common/identifier.service';
import { ProcessAccessService } from './common/process-access.service';
import { RealtimeGateway } from './realtime/realtime.gateway';

function serializeTrackingEntry(entry: {
  id: string;
  displayCode: string;
  rowVersion: number;
  processId: string;
  managerKey: string;
  managerName: string;
  managerEmail: string | null;
  stage: string;
  outlookCount: number;
  teamsCount: number;
  lastContactAt: Date | null;
  resolved: boolean;
  updatedAt: Date;
  projectStatuses: unknown;
  events?: Array<{ channel: string; note: string | null; at: Date }>;
}) {
  return {
    key: entry.managerKey,
    id: entry.id,
    displayCode: entry.displayCode,
    rowVersion: entry.rowVersion,
    processId: entry.processId,
    managerName: entry.managerName,
    managerEmail: entry.managerEmail ?? '',
    flaggedProjectCount: 0,
    outlookCount: entry.outlookCount,
    teamsCount: entry.teamsCount,
    lastContactAt: entry.lastContactAt?.toISOString() ?? null,
    stage: entry.stage,
    resolved: entry.resolved,
    history:
      entry.events?.map((event) => ({
        channel: event.channel,
        note: event.note ?? '',
        at: event.at.toISOString(),
      })) ?? [],
    projectStatuses: (entry.projectStatuses as Record<string, unknown> | null) ?? {},
    updatedAt: entry.updatedAt.toISOString(),
  };
}

type UpsertBody = {
  managerKey: string;
  managerName: string;
  managerEmail?: string;
  stage?: string;
  resolved?: boolean;
  projectStatuses?: Record<string, unknown>;
};

@Injectable()
export class TrackingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly identifiers: IdentifierService,
    private readonly activity: ActivityLogService,
    private readonly processAccess: ProcessAccessService,
    private readonly realtime: RealtimeGateway,
  ) {}

  async list(processIdOrCode: string, user: SessionUser) {
    const process = await this.processAccess.findAccessibleProcessOrThrow(user, processIdOrCode);
    const entries = await this.prisma.trackingEntry.findMany({
      where: { processId: process.id },
      include: { events: { orderBy: { at: 'asc' } } },
      orderBy: { managerName: 'asc' },
    });
    return entries.map(serializeTrackingEntry);
  }

  async upsert(processIdOrCode: string, body: UpsertBody, user: SessionUser) {
    const process = await this.processAccess.findAccessibleProcessOrThrow(user, processIdOrCode, 'editor');
    const result = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.trackingEntry.findFirst({
        where: { processId: process.id, managerKey: body.managerKey },
        include: { events: { orderBy: { at: 'asc' } } },
      });
      const entry = existing
        ? await tx.trackingEntry.update({
            where: { id: existing.id },
            data: {
              managerName: body.managerName || existing.managerName,
              managerEmail: body.managerEmail ?? existing.managerEmail,
              stage: body.stage ?? existing.stage,
              resolved: body.resolved ?? existing.resolved,
              projectStatuses: (body.projectStatuses as any) ?? existing.projectStatuses,
              rowVersion: { increment: 1 },
            },
            include: { events: { orderBy: { at: 'asc' } } },
          })
        : await tx.trackingEntry.create({
            data: {
              id: createId(),
              displayCode: await this.identifiers.nextTrackingCode(tx, process.displayCode),
              processId: process.id,
              managerKey: body.managerKey,
              managerName: body.managerName,
              managerEmail: body.managerEmail ?? '',
              stage: body.stage ?? 'Not contacted',
              resolved: body.resolved ?? false,
              projectStatuses: (body.projectStatuses ?? {}) as any,
            },
            include: { events: { orderBy: { at: 'asc' } } },
          });
      await this.activity.append(tx, {
        actorId: user.id,
        actorEmail: user.email,
        processId: process.id,
        entityType: 'tracking_entry',
        entityId: entry.id,
        entityCode: entry.displayCode,
        action: existing ? 'tracking.updated' : 'tracking.created',
        after: serializeTrackingEntry(entry),
      });
      return { serialized: serializeTrackingEntry(entry), entry };
    });

    // After-commit emit: every client subscribed to this process room will
    // invalidate the tracking query and re-render the Kanban.
    this.realtime.emitToProcess(process.displayCode, 'tracking.updated', {
      trackingCode: result.entry.displayCode,
      trackingId: result.entry.id,
      managerKey: result.entry.managerKey,
      stage: result.entry.stage,
      resolved: result.entry.resolved,
    }, {
      actor: { id: user.id, code: user.displayCode, email: user.email, displayName: user.displayName },
    });
    return result.serialized;
  }

  async patchEntry(entryIdOrCode: string, body: UpsertBody, user: SessionUser) {
    const prior = await this.prisma.trackingEntry.findFirst({
      where: { OR: [{ id: entryIdOrCode }, { displayCode: entryIdOrCode }] },
      include: { events: { orderBy: { at: 'asc' } } },
    });
    if (!prior) {
      throw new NotFoundException(`Tracking entry ${entryIdOrCode} not found`);
    }
    await this.processAccess.require(prior.processId, user, 'editor');
    return this.prisma.$transaction(async (tx) => {
      const entry = await tx.trackingEntry.update({
        where: { id: prior.id },
        data: {
          managerName: body.managerName || prior.managerName,
          managerEmail: body.managerEmail ?? prior.managerEmail,
          stage: body.stage ?? prior.stage,
          resolved: body.resolved ?? prior.resolved,
          projectStatuses: (body.projectStatuses as any) ?? prior.projectStatuses,
          rowVersion: { increment: 1 },
        },
        include: { events: { orderBy: { at: 'asc' } } },
      });
      await this.activity.append(tx, {
        actorId: user.id,
        actorEmail: user.email,
        processId: entry.processId,
        entityType: 'tracking_entry',
        entityId: entry.id,
        entityCode: entry.displayCode,
        action: 'tracking.updated',
        after: serializeTrackingEntry(entry),
      });
      return serializeTrackingEntry(entry);
    });
  }

  async addEvent(idOrCode: string, body: { channel: string; note?: string }, user: SessionUser) {
    const existing = await this.prisma.trackingEntry.findFirst({
      where: { OR: [{ id: idOrCode }, { displayCode: idOrCode }] },
    });
    if (!existing) throw new NotFoundException(`Tracking entry ${idOrCode} not found`);
    await this.processAccess.require(existing.processId, user, 'editor');
    return this.prisma.$transaction(async (tx) => {
      const entry = await tx.trackingEntry.findFirstOrThrow({
        where: { id: existing.id },
        include: { events: { orderBy: { at: 'asc' } } },
      });
      const event = await tx.trackingEvent.create({
        data: {
          id: createId(),
          displayCode: await this.identifiers.nextTrackingEventCode(tx),
          trackingId: entry.id,
          channel: body.channel,
          note: body.note?.trim() ?? '',
          triggeredById: user.id,
        },
      });
      const updated = await tx.trackingEntry.update({
        where: { id: entry.id },
        data: {
          outlookCount:
            body.channel === 'outlook' || body.channel === 'eml' || body.channel === 'sendAll'
              ? { increment: 1 }
              : undefined,
          teamsCount: body.channel === 'teams' ? { increment: 1 } : undefined,
          lastContactAt: new Date(),
          rowVersion: { increment: 1 },
        },
        include: { events: { orderBy: { at: 'asc' } } },
      });
      await this.activity.append(tx, {
        actorId: user.id,
        actorEmail: user.email,
        processId: updated.processId,
        entityType: 'tracking_event',
        entityId: event.id,
        entityCode: event.displayCode,
        action: 'tracking.event_added',
        after: { channel: event.channel },
      });
      return serializeTrackingEntry(updated);
    });
  }
}

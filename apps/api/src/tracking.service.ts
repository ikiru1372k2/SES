import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { EscalationStage } from '@prisma/client';
import type { SessionUser } from '@ses/domain';
import {
  createId,
  isEscalationStage,
  parseProjectStatuses,
  transition as applyTransition,
} from '@ses/domain';
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
  stage: EscalationStage;
  escalationLevel: number;
  outlookCount: number;
  teamsCount: number;
  lastContactAt: Date | null;
  resolved: boolean;
  updatedAt: Date;
  projectStatuses: unknown;
  events?: Array<{
    channel: string;
    kind?: string;
    note: string | null;
    reason: string | null;
    payload: unknown;
    at: Date;
  }>;
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
    escalationLevel: entry.escalationLevel,
    resolved: entry.resolved,
    history:
      entry.events?.map((event) => ({
        channel: event.channel,
        kind: event.kind ?? 'contact',
        note: event.note ?? '',
        reason: event.reason ?? undefined,
        payload: event.payload ?? undefined,
        at: event.at.toISOString(),
      })) ?? [],
    projectStatuses: parseProjectStatuses(entry.projectStatuses),
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

type PatchBody = {
  managerKey?: string;
  managerName?: string;
  managerEmail?: string;
  stage?: string;
  resolved?: boolean;
  projectStatuses?: Record<string, unknown>;
};

// Single source of truth for how `projectStatuses` is coerced into the
// JSON column. Previously duplicated between upsert() and patchEntry(),
// which made it easy to drift — a bug found in the audit pass. The helper
// accepts three possible inputs: the caller-supplied patch, the existing
// DB row's column, or nothing — and always returns a non-null JSON object.
function resolveProjectStatusesJson(
  incoming: Record<string, unknown> | undefined,
  existing: unknown,
): Record<string, unknown> {
  if (incoming !== undefined) {
    return parseProjectStatuses(incoming) as unknown as Record<string, unknown>;
  }
  if (existing !== undefined && existing !== null) {
    return parseProjectStatuses(existing) as unknown as Record<string, unknown>;
  }
  return parseProjectStatuses({}) as unknown as Record<string, unknown>;
}

function coerceStage(value: string | undefined, fallback: EscalationStage): EscalationStage {
  if (value === undefined || value === null) return fallback;
  if (isEscalationStage(value)) return value;
  const legacy: Record<string, EscalationStage> = {
    'Not contacted': 'NEW',
    'Reminder 1 sent': 'SENT',
    'Reminder 2 sent': 'SENT',
    'Teams escalated': 'ESCALATED_L1',
    Resolved: 'RESOLVED',
    'Manager acknowledged': 'RESPONDED',
  };
  const mapped = legacy[value];
  if (mapped) return mapped;
  throw new BadRequestException(`Invalid escalation stage: ${value}`);
}

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
      const projectStatusesJson = resolveProjectStatusesJson(body.projectStatuses, existing?.projectStatuses);
      const entry = existing
        ? await tx.trackingEntry.update({
            where: { id: existing.id },
            data: {
              managerName: body.managerName || existing.managerName,
              managerEmail: body.managerEmail ?? existing.managerEmail,
              stage: body.stage !== undefined ? coerceStage(body.stage, existing.stage) : existing.stage,
              resolved: body.resolved ?? existing.resolved,
              projectStatuses: projectStatusesJson as any,
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
              stage: coerceStage(body.stage, EscalationStage.NEW),
              resolved: body.resolved ?? false,
              escalationLevel: 0,
              projectStatuses: projectStatusesJson as any,
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

  async patchEntry(entryIdOrCode: string, body: PatchBody, user: SessionUser) {
    const prior = await this.prisma.trackingEntry.findFirst({
      where: { OR: [{ id: entryIdOrCode }, { displayCode: entryIdOrCode }] },
      include: { events: { orderBy: { at: 'asc' } } },
    });
    if (!prior) {
      throw new NotFoundException(`Tracking entry ${entryIdOrCode} not found`);
    }
    await this.processAccess.require(prior.processId, user, 'editor');
    return this.prisma.$transaction(async (tx) => {
      const projectStatusesJson = resolveProjectStatusesJson(body.projectStatuses, prior.projectStatuses);
      const entry = await tx.trackingEntry.update({
        where: { id: prior.id },
        data: {
          managerName: body.managerName || prior.managerName,
          managerEmail: body.managerEmail ?? prior.managerEmail,
          stage: body.stage !== undefined ? coerceStage(body.stage, prior.stage) : prior.stage,
          resolved: body.resolved ?? prior.resolved,
          projectStatuses: projectStatusesJson as any,
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
          kind: 'contact',
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

  async transition(
    idOrCode: string,
    body: { to: string; reason: string; sourceAction: string },
    user: SessionUser,
  ) {
    if (!isEscalationStage(body.to)) {
      throw new BadRequestException(`Invalid target stage: ${body.to}`);
    }
    const prior = await this.prisma.trackingEntry.findFirst({
      where: { OR: [{ id: idOrCode }, { displayCode: idOrCode }] },
    });
    if (!prior) throw new NotFoundException(`Tracking entry ${idOrCode} not found`);
    await this.processAccess.require(prior.processId, user, 'editor');

    const applied = await this.prisma.$transaction(async (tx) => {
      const fresh = await tx.trackingEntry.findFirstOrThrow({
        where: { id: prior.id },
        include: { events: { orderBy: { at: 'asc' } } },
      });
      const slice = {
        stage: fresh.stage as import('@ses/domain').EscalationStage,
        escalationLevel: fresh.escalationLevel,
        resolved: fresh.resolved,
      };
      let result: ReturnType<typeof applyTransition>;
      try {
        result = applyTransition(
          slice,
          body.to as import('@ses/domain').EscalationStage,
          { id: user.id, email: user.email, displayName: user.displayName },
          body.reason.trim(),
          body.sourceAction.trim(),
        );
      } catch {
        throw new BadRequestException(`Illegal transition ${slice.stage} -> ${body.to}`);
      }
      const eventPayload = {
        ...result.eventPayload,
        at: new Date().toISOString(),
      };
      await tx.trackingEvent.create({
        data: {
          id: createId(),
          displayCode: await this.identifiers.nextTrackingEventCode(tx),
          trackingId: fresh.id,
          kind: 'stage_transition',
          channel: 'stage_transition',
          note: null,
          reason: body.reason.trim(),
          payload: eventPayload as any,
          triggeredById: user.id,
        },
      });
      const updated = await tx.trackingEntry.update({
        where: { id: fresh.id },
        data: {
          stage: result.next.stage as EscalationStage,
          escalationLevel: result.next.escalationLevel,
          resolved: result.next.resolved,
          rowVersion: { increment: 1 },
        },
        include: { events: { orderBy: { at: 'asc' } } },
      });
      await this.activity.append(tx, {
        actorId: user.id,
        actorEmail: user.email,
        processId: updated.processId,
        entityType: 'tracking_entry',
        entityId: updated.id,
        entityCode: updated.displayCode,
        action: 'tracking.stage_transition',
        after: { stage: updated.stage, previousStage: result.eventPayload.previousStage },
      });
      return serializeTrackingEntry(updated);
    });

    const process = await this.prisma.process.findFirstOrThrow({ where: { id: prior.processId } });
    this.realtime.emitToProcess(process.displayCode, 'tracking.updated', {
      trackingCode: prior.displayCode,
      trackingId: prior.id,
      managerKey: prior.managerKey,
      stage: body.to,
      resolved: applied.resolved,
    }, {
      actor: { id: user.id, code: user.displayCode, email: user.email, displayName: user.displayName },
    });
    return applied;
  }

  async listEvents(idOrCode: string, user: SessionUser) {
    const existing = await this.prisma.trackingEntry.findFirst({
      where: { OR: [{ id: idOrCode }, { displayCode: idOrCode }] },
    });
    if (!existing) throw new NotFoundException(`Tracking entry ${idOrCode} not found`);
    await this.processAccess.require(existing.processId, user, 'viewer');
    const events = await this.prisma.trackingEvent.findMany({
      where: { trackingId: existing.id },
      orderBy: { at: 'asc' },
      select: {
        id: true,
        displayCode: true,
        channel: true,
        kind: true,
        note: true,
        reason: true,
        payload: true,
        triggeredById: true,
        at: true,
      },
    });
    return events.map((e) => ({
      id: e.id,
      displayCode: e.displayCode,
      channel: e.channel,
      kind: e.kind,
      note: e.note,
      reason: e.reason,
      payload: e.payload,
      triggeredById: e.triggeredById,
      at: e.at.toISOString(),
    }));
  }
}

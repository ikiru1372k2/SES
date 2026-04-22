import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EscalationStage, Prisma } from '@prisma/client';
import type { SessionUser } from '@ses/domain';
import {
  assertTransition,
  buildFindingsByEngineMarkdown,
  createId,
  substitute,
  type EngineFindingLine,
  type EscalationStage as DomainEscalationStage,
} from '@ses/domain';
import { PrismaService } from '../common/prisma.service';
import { IdentifierService } from '../common/identifier.service';
import { ProcessAccessService } from '../common/process-access.service';
import { ActivityLogService } from '../common/activity-log.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { DEFAULT_TENANT_ID } from '../common/default-tenant';
import { EscalationsService } from '../escalations.service';
import { OutboundDeliveryService, type EscalationSendChannel } from '../outbound/outbound-delivery.service';

const LOCK_MS = 10 * 60 * 1000;

export type ComposeDraftPayload = {
  templateId?: string;
  subject: string;
  body: string;
  cc: string[];
  removedEngineIds?: string[];
  channel?: EscalationSendChannel;
};

function stageKeyForLevel(level: number): string {
  if (level >= 2) return 'ESCALATED_L2';
  if (level >= 1) return 'ESCALATED_L1';
  return 'NEW';
}

function firstName(full: string): string {
  const t = full.trim();
  if (!t) return '';
  return t.split(/\s+/)[0] ?? t;
}

@Injectable()
export class TrackingComposeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly processAccess: ProcessAccessService,
    private readonly identifiers: IdentifierService,
    private readonly activity: ActivityLogService,
    private readonly realtime: RealtimeGateway,
    private readonly escalations: EscalationsService,
    private readonly outbound: OutboundDeliveryService,
  ) {}

  private tenantId(_user: SessionUser) {
    return _user.tenantId ?? DEFAULT_TENANT_ID;
  }

  private async loadEntry(idOrCode: string, user: SessionUser) {
    const entry = await this.prisma.trackingEntry.findFirst({
      where: { OR: [{ id: idOrCode }, { displayCode: idOrCode }] },
      include: {
        process: true,
        draftLockUser: { select: { id: true, displayName: true, email: true } },
      },
    });
    if (!entry) throw new NotFoundException(`Tracking entry ${idOrCode} not found`);
    await this.processAccess.require(entry.processId, user, 'editor');
    return entry;
  }

  async composeStatus(idOrCode: string, user: SessionUser) {
    const entry = await this.loadEntry(idOrCode, user);
    const now = Date.now();
    const locked =
      entry.draftLockExpiresAt &&
      entry.draftLockExpiresAt.getTime() > now &&
      entry.draftLockUserId &&
      entry.draftLockUserId !== user.id;
    return {
      trackingId: entry.id,
      locked: Boolean(locked),
      lockedBy: locked ? entry.draftLockUser?.displayName ?? null : null,
      lockedUntil: locked ? entry.draftLockExpiresAt!.toISOString() : null,
    };
  }

  async preview(idOrCode: string, user: SessionUser, body: Partial<ComposeDraftPayload>) {
    const entry = await this.loadEntry(idOrCode, user);
    const { subject, text } = await this.resolveContent(entry, user, body);
    return { subject, body: text };
  }

  async saveDraft(idOrCode: string, user: SessionUser, body: ComposeDraftPayload) {
    const entry = await this.loadEntry(idOrCode, user);
    const now = new Date();
    if (
      entry.draftLockExpiresAt &&
      entry.draftLockExpiresAt > now &&
      entry.draftLockUserId &&
      entry.draftLockUserId !== user.id
    ) {
      throw new ConflictException('Another user is editing this draft.');
    }
    const expires = new Date(Date.now() + LOCK_MS);
    const from = entry.stage as DomainEscalationStage;
    if (from === EscalationStage.NEW) {
      assertTransition(from, EscalationStage.DRAFTED);
    }
    const nextStage = from === EscalationStage.NEW ? EscalationStage.DRAFTED : from;
    const draft = { ...body, savedAt: now.toISOString() };
    const updated = await this.prisma.trackingEntry.update({
      where: { id: entry.id },
      data: {
        composeDraft: draft as object,
        draftLockUserId: user.id,
        draftLockExpiresAt: expires,
        stage: nextStage,
        rowVersion: { increment: 1 },
      },
    });
    await this.activity.append(this.prisma, {
      actorId: user.id,
      actorEmail: user.email,
      processId: entry.processId,
      entityType: 'tracking_entry',
      entityId: entry.id,
      entityCode: entry.displayCode,
      action: 'tracking.compose_draft',
      after: { stage: updated.stage },
    });
    this.realtime.emitToProcess(entry.process.displayCode, 'tracking.updated', {
      trackingId: entry.id,
      stage: updated.stage,
    }, { actor: { id: user.id, code: user.displayCode, email: user.email, displayName: user.displayName } });
    return { ok: true, stage: updated.stage, lockExpiresAt: expires.toISOString() };
  }

  async discardDraft(idOrCode: string, user: SessionUser) {
    const entry = await this.loadEntry(idOrCode, user);
    if (entry.stage === EscalationStage.DRAFTED) {
      assertTransition(EscalationStage.DRAFTED, EscalationStage.NEW);
    }
    const updated = await this.prisma.trackingEntry.update({
      where: { id: entry.id },
      data: {
        composeDraft: Prisma.JsonNull,
        draftLockUserId: null,
        draftLockExpiresAt: null,
        stage: entry.stage === EscalationStage.DRAFTED ? EscalationStage.NEW : entry.stage,
        rowVersion: { increment: 1 },
      },
    });
    await this.activity.append(this.prisma, {
      actorId: user.id,
      actorEmail: user.email,
      processId: entry.processId,
      entityType: 'tracking_entry',
      entityId: entry.id,
      entityCode: entry.displayCode,
      action: 'tracking.compose_discard',
      after: { stage: updated.stage },
    });
    return { ok: true, stage: updated.stage };
  }

  async send(idOrCode: string, user: SessionUser, body: ComposeDraftPayload & { sources: string[] }) {
    const entry = await this.loadEntry(idOrCode, user);
    const now = new Date();
    if (
      entry.draftLockExpiresAt &&
      entry.draftLockExpiresAt > now &&
      entry.draftLockUserId &&
      entry.draftLockUserId !== user.id
    ) {
      throw new ForbiddenException('Another user holds the compose lock.');
    }
    if (entry.stage !== EscalationStage.NEW && entry.stage !== EscalationStage.DRAFTED) {
      throw new BadRequestException('Send is only allowed from NEW or DRAFTED.');
    }
    assertTransition(entry.stage as DomainEscalationStage, EscalationStage.SENT);
    assertTransition(EscalationStage.SENT, EscalationStage.AWAITING_RESPONSE);

    const { subject, text, channel } = await this.resolveContent(entry, user, body);
    const sendChannel: EscalationSendChannel = channel ?? 'email';
    const to = (entry.managerEmail ?? '').trim();
    if (!to) {
      throw new BadRequestException('Manager email is required before send.');
    }

    await this.outbound.sendEscalation({
      channel: sendChannel,
      to,
      cc: (body.cc ?? []).map((c) => c.trim()).filter(Boolean),
      subject,
      bodyText: text,
    });

    const slaHours = entry.process.slaInitialHours ?? 120;
    const slaDueAt = new Date(Date.now() + slaHours * 60 * 60 * 1000);
    const issueCount = body.sources?.length ? body.sources.length : 0;

    const logRow = await this.prisma.$transaction(async (tx) => {
      const log = await tx.notificationLog.create({
        data: {
          displayCode: await this.identifiers.nextNotificationLogCode(tx, entry.process.displayCode),
          processId: entry.processId,
          actorUserId: user.id,
          trackingEntryId: entry.id,
          managerEmail: to.toLowerCase(),
          managerName: entry.managerName,
          channel: sendChannel === 'both' ? 'both' : sendChannel,
          subject,
          bodyPreview: text.slice(0, 2000),
          resolvedBody: text,
          sources: body.sources as object,
          issueCount,
        },
      });
      await tx.trackingEvent.create({
        data: {
          id: createId(),
          displayCode: await this.identifiers.nextTrackingEventCode(tx),
          trackingId: entry.id,
          kind: 'escalation_sent',
          channel: sendChannel === 'both' ? 'sendAll' : sendChannel === 'teams' ? 'teams' : 'outlook',
          note: subject.slice(0, 200),
          reason: 'escalation_send',
          payload: { sources: body.sources, notificationLogId: log.id } as object,
          triggeredById: user.id,
        },
      });
      const outlookInc =
        sendChannel === 'email' || sendChannel === 'both' ? 1 : 0;
      const teamsInc = sendChannel === 'teams' || sendChannel === 'both' ? 1 : 0;
      await tx.trackingEntry.update({
        where: { id: entry.id },
        data: {
          stage: EscalationStage.AWAITING_RESPONSE,
          outlookCount: outlookInc ? { increment: outlookInc } : undefined,
          teamsCount: teamsInc ? { increment: teamsInc } : undefined,
          lastContactAt: new Date(),
          slaDueAt,
          composeDraft: Prisma.JsonNull,
          draftLockUserId: null,
          draftLockExpiresAt: null,
          rowVersion: { increment: 1 },
        },
      });
      await this.activity.append(tx, {
        actorId: user.id,
        actorEmail: user.email,
        processId: entry.processId,
        entityType: 'notification_log',
        entityId: log.id,
        entityCode: log.displayCode,
        action: 'notification.sent',
      });
      return log;
    });

    this.realtime.emitToProcess(entry.process.displayCode, 'notification.sent', {
      managerEmail: logRow.managerEmail,
      subject: logRow.subject,
      issueCount: logRow.issueCount,
    }, { actor: { id: user.id, code: user.displayCode, email: user.email, displayName: user.displayName } });

    return { ok: true, notificationLogId: logRow.id };
  }

  private async pickTemplate(tenantId: string, stageKey: string, templateId?: string) {
    if (templateId) {
      const t = await this.prisma.notificationTemplate.findFirst({ where: { id: templateId, active: true } });
      if (t && (t.tenantId === null || t.tenantId === tenantId)) return t;
    }
    const rows = await this.prisma.notificationTemplate.findMany({
      where: {
        stage: stageKey,
        active: true,
        OR: [{ tenantId: null }, { tenantId }],
      },
      orderBy: { version: 'desc' },
    });
    const org = rows.find((r) => r.tenantId === tenantId);
    return org ?? rows.find((r) => r.tenantId === null) ?? null;
  }

  private async resolveContent(
    entry: {
      id: string;
      processId: string;
      managerName: string;
      managerEmail: string | null;
      escalationLevel: number;
      process: { id: string; displayCode: string; name: string; slaInitialHours: number };
      composeDraft: unknown;
    },
    user: SessionUser,
    overrides: Partial<ComposeDraftPayload>,
  ): Promise<{ subject: string; text: string; channel: EscalationSendChannel }> {
    const tenantId = this.tenantId(user);
    const stageKey = stageKeyForLevel(entry.escalationLevel);
    const tpl = await this.pickTemplate(tenantId, stageKey, overrides.templateId);
    const draft = (entry.composeDraft ?? {}) as Partial<ComposeDraftPayload>;
    const baseSubject = (overrides.subject ?? draft.subject ?? tpl?.subject ?? 'Escalation').trim();
    const baseBody = (overrides.body ?? draft.body ?? tpl?.body ?? '').trim();
    const channel = (overrides.channel ?? draft.channel ?? (tpl?.channel as EscalationSendChannel) ?? 'email') as EscalationSendChannel;
    if (channel !== 'email' && channel !== 'teams' && channel !== 'both') {
      throw new BadRequestException('Invalid channel');
    }

    const esc = await this.escalations.getForProcess(entry.process.displayCode, user);
    const row = esc.rows.find((r) => r.trackingId === entry.id);
    const lines: EngineFindingLine[] = [];
    const removed = new Set((overrides.removedEngineIds ?? draft.removedEngineIds ?? []).map(String));
    if (row) {
      for (const engineId of esc.engineIds) {
        if (removed.has(engineId)) continue;
        const findings = row.findingsByEngine[engineId] ?? [];
        for (const f of findings) {
          lines.push({
            engineKey: engineId,
            engineLabel: engineId,
            projectNo: f.projectNo ?? '',
            projectName: f.projectName ?? '',
            severity: '',
            ruleName: '',
            notes: '',
          });
        }
      }
    }
    const findingsMd = buildFindingsByEngineMarkdown(lines);
    const latestRun = await this.prisma.auditRun.findFirst({
      where: { processId: entry.processId, OR: [{ status: 'completed' }, { completedAt: { not: null } }] },
      orderBy: { completedAt: 'desc' },
      include: { ranBy: { select: { displayName: true } } },
    });
    const slots: Record<string, string> = {
      managerFirstName: firstName(entry.managerName),
      processName: entry.process.name,
      findingsByEngine: findingsMd,
      slaDeadline: row?.slaDueAt ? new Date(row.slaDueAt).toISOString() : '',
      auditRunDate: latestRun?.completedAt?.toISOString() ?? latestRun?.startedAt.toISOString() ?? '',
      auditorName: latestRun?.ranBy.displayName ?? user.displayName,
    };
    const subject = substitute(baseSubject, slots);
    const text = substitute(baseBody, slots);
    return { subject, text, channel };
  }
}

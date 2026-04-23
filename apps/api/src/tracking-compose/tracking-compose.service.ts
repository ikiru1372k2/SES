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
  /** Auditor-only note persisted alongside the send. Not shown to the manager. */
  authorNote?: string;
  /** ISO-8601 date for the {{dueDate}} slot. */
  deadlineAt?: string | null;
};

/**
 * Issue #75: escalation cycle is outlook → outlook → teams, then the cycle
 * is complete. The server is the source of truth for the gate; the UI
 * mirrors it from `outlookCount` / `teamsCount` on the tracking entry.
 * Admin-only `forceReescalate` zeroes the counters to start a new cycle.
 */
function assertChannelAllowed(
  entry: { outlookCount: number; teamsCount: number },
  channel: EscalationSendChannel,
): void {
  const effective: 'outlook' | 'teams' = channel === 'teams' ? 'teams' : 'outlook';
  if (effective === 'outlook') {
    if (entry.outlookCount >= 2) {
      throw new ConflictException('Outlook limit reached for this cycle — escalate via Teams next.');
    }
    return;
  }
  if (entry.outlookCount < 2) {
    throw new ConflictException('Send two Outlook reminders before escalating to Teams.');
  }
  if (entry.teamsCount >= 1) {
    throw new ConflictException('Cycle complete — resolve or force re-escalate before sending again.');
  }
}

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
    // The ladder may be at any stage the cycle allows: NEW/DRAFTED for the
    // first Outlook, AWAITING_RESPONSE for the second Outlook, and
    // AWAITING_RESPONSE / ESCALATED_L1 / NO_RESPONSE for the Teams leg. Any
    // other stage is a bug in the client: refuse loudly.
    if (
      entry.stage !== EscalationStage.NEW &&
      entry.stage !== EscalationStage.DRAFTED &&
      entry.stage !== EscalationStage.AWAITING_RESPONSE &&
      entry.stage !== EscalationStage.ESCALATED_L1 &&
      entry.stage !== EscalationStage.NO_RESPONSE
    ) {
      throw new BadRequestException(`Send is not allowed from stage ${entry.stage}.`);
    }

    const { subject, text, channel, managerEmail } = await this.resolveContent(entry, user, body);
    const sendChannel: EscalationSendChannel = channel ?? 'email';
    // Channel gate (Issue #75): the 2-Outlooks-then-1-Teams cycle is
    // enforced here so race conditions between multiple auditors can't
    // punch through the counter.
    assertChannelAllowed({ outlookCount: entry.outlookCount, teamsCount: entry.teamsCount }, sendChannel);
    if (sendChannel === 'both') {
      // The client-handoff path opens one window per channel; mailto and
      // the Teams deep-link can't be atomically composed anyway. Force the
      // auditor to pick one explicitly.
      throw new BadRequestException('Channel "both" is no longer supported — pick Outlook or Teams.');
    }

    const to = (managerEmail ?? '').trim();
    if (!to) {
      throw new BadRequestException('Manager email is required before send.');
    }

    // Issue #75: no SMTP, no Teams webhook. The web client opens mailto: /
    // teams deep-link with the prefilled content after this endpoint
    // returns. We only RECORD the handoff here so the ladder advances and
    // the activity timeline reflects what happened.

    const slaHours = entry.process.slaInitialHours ?? 120;
    const slaDueAt = new Date(Date.now() + slaHours * 60 * 60 * 1000);
    const issueCount = body.sources?.length ? body.sources.length : 0;
    const deadlineAt = body.deadlineAt ? new Date(body.deadlineAt) : null;
    const authorNote = (body.authorNote ?? '').slice(0, 2000);

    // The Teams leg transitions to ESCALATED_L1 so the timeline clearly
    // distinguishes an Outlook reminder from a Teams escalation.
    const nextStage: EscalationStage =
      sendChannel === 'teams' ? EscalationStage.ESCALATED_L1 : EscalationStage.AWAITING_RESPONSE;

    const logRow = await this.prisma.$transaction(async (tx) => {
      const log = await tx.notificationLog.create({
        data: {
          displayCode: await this.identifiers.nextNotificationLogCode(tx, entry.process.displayCode),
          processId: entry.processId,
          actorUserId: user.id,
          trackingEntryId: entry.id,
          managerEmail: to.toLowerCase(),
          managerName: entry.managerName,
          channel: sendChannel,
          subject,
          bodyPreview: text.slice(0, 2000),
          resolvedBody: text,
          sources: body.sources as object,
          issueCount,
          authorNote,
          deadlineAt,
        },
      });
      await tx.trackingEvent.create({
        data: {
          id: createId(),
          displayCode: await this.identifiers.nextTrackingEventCode(tx),
          trackingId: entry.id,
          kind: 'escalation_sent',
          channel: sendChannel === 'teams' ? 'teams' : 'outlook',
          note: subject.slice(0, 200),
          reason: 'escalation_send',
          payload: {
            sources: body.sources,
            notificationLogId: log.id,
            deadlineAt: deadlineAt?.toISOString() ?? null,
            authorNote,
          } as object,
          triggeredById: user.id,
        },
      });
      const outlookInc = sendChannel === 'email' ? 1 : 0;
      const teamsInc = sendChannel === 'teams' ? 1 : 0;
      await tx.trackingEntry.update({
        where: { id: entry.id },
        data: {
          stage: nextStage,
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

    // Return the resolved content so the client can hand it to the user's
    // mail / Teams app immediately — no second round-trip for preview.
    return {
      ok: true,
      notificationLogId: logRow.id,
      channel: sendChannel,
      subject,
      body: text,
      to: to.toLowerCase(),
      cc: (body.cc ?? []).map((c) => c.trim()).filter(Boolean),
    };
  }

  /**
   * Admin-only cycle reset (Issue #75). Zeroes the Outlook / Teams
   * counters and stamps a `cycle_reset` TrackingEvent so the activity
   * feed explains why a manager is seeing a fresh round of reminders.
   * Transitions back to NEW so the gate reopens at Outlook #1.
   */
  async forceReescalate(idOrCode: string, user: SessionUser) {
    if (user.role !== 'admin') {
      throw new ForbiddenException('Admin role required to force a new cycle.');
    }
    const entry = await this.loadEntry(idOrCode, user);
    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await tx.trackingEntry.update({
        where: { id: entry.id },
        data: {
          outlookCount: 0,
          teamsCount: 0,
          stage: EscalationStage.NEW,
          slaDueAt: null,
          rowVersion: { increment: 1 },
        },
      });
      await tx.trackingEvent.create({
        data: {
          id: createId(),
          displayCode: await this.identifiers.nextTrackingEventCode(tx),
          trackingId: entry.id,
          kind: 'cycle_reset',
          channel: 'manual',
          note: 'Cycle reset — Outlook and Teams counters zeroed.',
          reason: 'force_reescalate',
          triggeredById: user.id,
        },
      });
      await this.activity.append(tx, {
        actorId: user.id,
        actorEmail: user.email,
        processId: entry.processId,
        entityType: 'tracking_entry',
        entityId: entry.id,
        entityCode: entry.displayCode,
        action: 'tracking.cycle_reset',
      });
      return row;
    });
    this.realtime.emitToProcess(entry.process.displayCode, 'tracking.updated', {
      trackingId: entry.id,
      stage: updated.stage,
    }, { actor: { id: user.id, code: user.displayCode, email: user.email, displayName: user.displayName } });
    return { ok: true, stage: updated.stage };
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
  ): Promise<{ subject: string; text: string; channel: EscalationSendChannel; managerEmail: string | null }> {
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
    const managerEmail = row?.resolvedEmail ?? row?.directoryEmail ?? entry.managerEmail ?? null;
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
    return { subject, text, channel, managerEmail };
  }
}

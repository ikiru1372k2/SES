import { BadRequestException, Injectable } from '@nestjs/common';
import {
  AUDIT_RULES_BY_CODE,
  buildFindingsByEngineHtmlTable,
  buildFindingsByEngineMarkdown,
  buildFindingsByEngineTextTable,
  getFunctionLabel,
  type EngineFindingLine,
  type FunctionId,
  type SessionUser,
} from '@ses/domain';
import { PrismaService } from '../../common/prisma.service';
import { EscalationsService } from '../../escalations.service';
import { DEFAULT_TENANT_ID } from '../../common/default-tenant';
import type { ComposeDraftPayload } from './compose.types';
import type { EscalationSendChannel } from '../../outbound/outbound-delivery.service';
import {
  DEFAULT_BODY_TEMPLATE,
  DEFAULT_SUBJECT_TEMPLATE,
  buildSubjectAndBody,
  escapeHtml,
  firstName,
  formatDueDate,
  stageKeyForLevel,
} from './compose-render.helpers';

export type ResolvedContent = {
  subject: string;
  text: string;
  html: string;
  channel: EscalationSendChannel;
  managerEmail: string | null;
};

type EntryShape = {
  id: string;
  processId: string;
  managerName: string;
  managerEmail: string | null;
  escalationLevel: number;
  process: { id: string; displayCode: string; name: string; slaInitialHours: number };
  composeDraft: unknown;
};

@Injectable()
export class ComposeRenderService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly escalations: EscalationsService,
  ) {}

  private tenantId(user: SessionUser): string {
    return user.tenantId ?? DEFAULT_TENANT_ID;
  }

  private async pickTemplate(tenantId: string, stageKey: string, templateId?: string) {
    if (templateId) {
      const t = await this.prisma.notificationTemplate.findFirst({ where: { id: templateId, active: true } });
      if (t && (t.tenantId === null || t.tenantId === tenantId)) return t;
    }
    const rows = await this.prisma.notificationTemplate.findMany({
      where: { stage: stageKey, active: true, OR: [{ tenantId: null }, { tenantId }] },
      orderBy: { version: 'desc' },
    });
    const org = rows.find((r) => r.tenantId === tenantId);
    return org ?? rows.find((r) => r.tenantId === null) ?? null;
  }

  async resolveContent(
    entry: EntryShape,
    user: SessionUser,
    overrides: Partial<ComposeDraftPayload>,
  ): Promise<ResolvedContent> {
    const tenantId = this.tenantId(user);
    const stageKey = stageKeyForLevel(entry.escalationLevel);
    const tpl = await this.pickTemplate(tenantId, stageKey, overrides.templateId);
    const draft = (entry.composeDraft ?? {}) as Partial<ComposeDraftPayload>;

    const subjectSource = overrides.subject ?? draft.subject ?? tpl?.subject ?? '';
    const bodySource = overrides.body ?? draft.body ?? tpl?.body ?? '';
    const baseSubject = (subjectSource.trim() || DEFAULT_SUBJECT_TEMPLATE).trim();
    const baseBody = (bodySource.trim() || DEFAULT_BODY_TEMPLATE).trim();
    const channel = (overrides.channel ?? draft.channel ?? (tpl?.channel as EscalationSendChannel) ?? 'email') as EscalationSendChannel;
    if (channel !== 'email' && channel !== 'teams' && channel !== 'both') {
      throw new BadRequestException('Invalid channel');
    }

    const esc = await this.escalations.getForProcess(entry.process.displayCode, user);
    const row = esc.rows.find((r) => r.trackingId === entry.id);
    const managerEmail = row?.resolvedEmail ?? row?.directoryEmail ?? entry.managerEmail ?? null;
    const removed = new Set((overrides.removedEngineIds ?? draft.removedEngineIds ?? []).map(String));

    const issueKeys: string[] = [];
    if (row) {
      for (const engineId of esc.engineIds) {
        if (removed.has(engineId)) continue;
        for (const f of row.findingsByEngine[engineId] ?? []) {
          if (f.issueKey) issueKeys.push(f.issueKey);
        }
      }
    }

    const issueDetails = issueKeys.length
      ? await this.prisma.auditIssue.findMany({
          where: { issueKey: { in: issueKeys }, auditRun: { processId: entry.processId } },
          select: {
            issueKey: true, ruleCode: true, severity: true, reason: true,
            thresholdLabel: true, recommendedAction: true, sheetName: true,
            projectManager: true, projectState: true, effort: true,
            missingMonths: true, zeroMonthCount: true,
            auditRun: { select: { completedAt: true, startedAt: true } },
          },
        })
      : [];

    const issueByKey = new Map<string, (typeof issueDetails)[number]>();
    for (const iss of issueDetails) {
      const prev = issueByKey.get(iss.issueKey);
      const t = (x: typeof iss) => x.auditRun.completedAt?.getTime() ?? x.auditRun.startedAt.getTime() ?? 0;
      if (!prev || t(iss) >= t(prev)) issueByKey.set(iss.issueKey, iss);
    }

    const linksRaw = (overrides.projectLinks ?? draft.projectLinks ?? {}) as Record<string, unknown>;
    const projectLinks = new Map<string, string>();
    for (const [pid, url] of Object.entries(linksRaw)) {
      if (typeof url !== 'string') continue;
      const trimmed = url.trim();
      if (trimmed && /^https?:\/\//i.test(trimmed)) projectLinks.set(pid.trim(), trimmed);
    }

    const lines: EngineFindingLine[] = [];
    if (row) {
      for (const engineId of esc.engineIds) {
        if (removed.has(engineId)) continue;
        for (const f of row.findingsByEngine[engineId] ?? []) {
          const iss = f.issueKey ? issueByKey.get(f.issueKey) : null;
          const ruleEntry = iss ? AUDIT_RULES_BY_CODE.get(iss.ruleCode) : null;
          const ruleName = ruleEntry?.name ?? '';
          const severity = iss?.severity ?? ruleEntry?.defaultSeverity ?? '';
          const missingFieldLabel = (() => {
            if (iss?.ruleCode?.startsWith('ai_')) return iss.reason ?? null;
            if (engineId === ('master-data' as FunctionId) && ruleName) {
              return ruleName.replace(/\s*required$/i, '').trim();
            }
            return null;
          })();
          const months = Array.isArray(iss?.missingMonths)
            ? (iss!.missingMonths as unknown[]).map((m) => String(m).trim()).filter(Boolean).join(', ')
            : null;
          lines.push({
            engineKey: engineId,
            engineLabel: getFunctionLabel(engineId as FunctionId),
            projectNo: f.projectNo ?? '',
            projectName: f.projectName ?? '',
            severity, ruleName, notes: iss?.reason ?? '', issueKey: f.issueKey,
            detail: {
              ruleCode: iss?.ruleCode ?? '', ruleName,
              ruleCategory: ruleEntry?.category ?? '', severity,
              reason: iss?.reason ?? null,
              thresholdLabel: iss?.thresholdLabel ?? null,
              recommendedAction: iss?.recommendedAction ?? null,
              sheetName: iss?.sheetName ?? null,
              projectManager: iss?.projectManager ?? null,
              projectState: iss?.projectState ?? null,
              effort: iss?.effort ?? null,
              affectedMonths: months,
              zeroMonthCount: iss?.zeroMonthCount ?? null,
              missingFieldLabel,
              projectLink: f.projectNo ? projectLinks.get(f.projectNo) ?? null : null,
            },
          });
        }
      }
    }

    const findingsMd = buildFindingsByEngineMarkdown(lines);
    const findingsTxt = buildFindingsByEngineTextTable(lines);
    const findingsHtml = buildFindingsByEngineHtmlTable(lines);

    const latestRun = await this.prisma.auditRun.findFirst({
      where: { processId: entry.processId, OR: [{ status: 'completed' }, { completedAt: { not: null } }] },
      orderBy: { completedAt: 'desc' },
      include: { ranBy: { select: { displayName: true } } },
    });

    const auditRunDate = latestRun?.completedAt
      ? latestRun.completedAt.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
      : latestRun?.startedAt
      ? latestRun.startedAt.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
      : '';
    const slaDeadline = row?.slaDueAt
      ? new Date(row.slaDueAt).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
      : '';
    const dueDate = formatDueDate(overrides.deadlineAt ?? draft.deadlineAt ?? null);
    const auditorName = latestRun?.ranBy.displayName ?? user.displayName;

    const textSlots: Record<string, string> = {
      managerFirstName: firstName(entry.managerName),
      managerName: entry.managerName,
      processName: entry.process.name,
      findingsByEngine: findingsTxt || findingsMd,
      findingsCount: String(lines.length),
      slaDeadline, dueDate: dueDate || slaDeadline || '',
      auditRunDate, auditorName,
    };
    const htmlSlots: Record<string, string> = {
      managerFirstName: escapeHtml(firstName(entry.managerName)),
      managerName: escapeHtml(entry.managerName),
      processName: escapeHtml(entry.process.name),
      findingsByEngine: findingsHtml,
      findingsCount: String(lines.length),
      slaDeadline: escapeHtml(slaDeadline),
      dueDate: escapeHtml(dueDate || slaDeadline || ''),
      auditRunDate: escapeHtml(auditRunDate),
      auditorName: escapeHtml(auditorName),
    };

    return { ...buildSubjectAndBody(baseSubject, baseBody, textSlots, htmlSlots), channel, managerEmail };
  }
}

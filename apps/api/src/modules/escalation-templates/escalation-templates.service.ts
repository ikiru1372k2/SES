import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { SessionUser } from '@ses/domain';
import { createId } from '@ses/domain';
import { PrismaService } from '../../common/prisma.service';
import { ActivityLogService } from '../../common/activity-log.service';
import { DEFAULT_TENANT_ID } from '../../common/default-tenant';

function serialize(t: {
  id: string;
  tenantId: string | null;
  parentId: string | null;
  stage: string;
  subject: string;
  body: string;
  channel: string;
  active: boolean;
  version: number;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: t.id,
    tenantId: t.tenantId,
    parentId: t.parentId,
    stage: t.stage,
    subject: t.subject,
    body: t.body,
    channel: t.channel,
    active: t.active,
    version: t.version,
    createdBy: t.createdBy,
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
  };
}

@Injectable()
export class EscalationTemplatesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly activity: ActivityLogService,
  ) {}

  private tenantId(_user: SessionUser) {
    return _user.tenantId ?? DEFAULT_TENANT_ID;
  }

  async listMerged(user: SessionUser, stageKey?: string, includeInactive?: boolean) {
    const tenantId = this.tenantId(user);
    const activeFilter = includeInactive ? {} : { active: true };
    if (includeInactive && user.role === 'admin') {
      const rows = await this.prisma.notificationTemplate.findMany({
        where: {
          OR: [{ tenantId: null }, { tenantId }],
          ...(stageKey ? { stage: stageKey } : {}),
        },
        orderBy: [{ stage: 'asc' }, { version: 'desc' }, { updatedAt: 'desc' }],
      });
      return rows.map(serialize);
    }
    const stages = stageKey
      ? [stageKey]
      : (await this.prisma.notificationTemplate.groupBy({
          by: ['stage'],
          where: { OR: [{ tenantId: null }, { tenantId }], ...activeFilter },
        })).map((s) => s.stage);
    const merged: ReturnType<typeof serialize>[] = [];
    for (const st of stages) {
      const org = await this.prisma.notificationTemplate.findFirst({
        where: { tenantId, stage: st, ...activeFilter },
        orderBy: { version: 'desc' },
      });
      const sys = await this.prisma.notificationTemplate.findFirst({
        where: { tenantId: null, stage: st, ...activeFilter },
        orderBy: { version: 'desc' },
      });
      const chosen = org ?? sys;
      if (chosen) merged.push(serialize(chosen));
    }
    return merged.sort((a, b) => a.stage.localeCompare(b.stage));
  }

  async listAllVersions(user: SessionUser, stageKey: string) {
    if (user.role !== 'admin') {
      throw new ForbiddenException('Only administrators can list template versions.');
    }
    const rows = await this.prisma.notificationTemplate.findMany({
      where: { stage: stageKey },
      orderBy: [{ version: 'desc' }, { updatedAt: 'desc' }],
    });
    return rows.map(serialize);
  }

  async createOverride(
    body: {
      stage?: string;
      subject?: string;
      body?: string;
      channel?: string;
      parentId?: string | null;
    },
    user: SessionUser,
  ) {
    if (user.role !== 'admin') {
      throw new ForbiddenException('Only administrators can create escalation template overrides.');
    }
    const tenantId = this.tenantId(user);
    return this.prisma.$transaction(async (tx) => {
      const template = await tx.notificationTemplate.create({
        data: {
          id: createId(),
          tenantId,
          parentId: body.parentId ?? null,
          stage: (body.stage ?? 'NEW').trim(),
          subject: (body.subject ?? '').trim() || '(no subject)',
          body: (body.body ?? '').trim(),
          channel: (body.channel ?? 'email').trim(),
          active: true,
          version: 1,
          createdBy: user.id,
        },
      });
      await this.activity.append(tx, {
        actorId: user.id,
        actorEmail: user.email,
        processId: null,
        entityType: 'escalation_template',
        entityId: template.id,
        entityCode: template.id,
        action: 'escalation_template.created',
        after: serialize(template),
      });
      return serialize(template);
    });
  }

  async publishPatch(
    id: string,
    body: { subject?: string; body?: string; channel?: string; active?: boolean },
    user: SessionUser,
  ) {
    if (user.role !== 'admin') {
      throw new ForbiddenException('Only administrators can publish template changes.');
    }
    const prior = await this.prisma.notificationTemplate.findFirst({ where: { id } });
    if (!prior) throw new NotFoundException('Template not found');
    if (prior.tenantId === null) {
      throw new ForbiddenException('System templates are immutable; clone to an org override.');
    }
    return this.prisma.$transaction(async (tx) => {
      await tx.notificationTemplate.update({
        where: { id: prior.id },
        data: { active: false },
      });
      const next = await tx.notificationTemplate.create({
        data: {
          id: createId(),
          tenantId: prior.tenantId,
          parentId: prior.parentId ?? prior.id,
          stage: prior.stage,
          subject: body.subject ?? prior.subject,
          body: body.body ?? prior.body,
          channel: body.channel ?? prior.channel,
          active: body.active ?? true,
          version: prior.version + 1,
          createdBy: user.id,
        },
      });
      await this.activity.append(tx, {
        actorId: user.id,
        actorEmail: user.email,
        processId: null,
        entityType: 'escalation_template',
        entityId: next.id,
        entityCode: next.id,
        action: 'escalation_template.published',
        after: serialize(next),
      });
      return serialize(next);
    });
  }
}

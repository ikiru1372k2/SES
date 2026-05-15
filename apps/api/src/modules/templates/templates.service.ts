import { ForbiddenException, Injectable } from '@nestjs/common';
import type { SessionUser } from '@ses/domain';
import { createId } from '@ses/domain';
import { PrismaService } from '../../common/prisma.service';
import { ActivityLogService } from '../../common/activity-log.service';
import { IdentifierService } from '../../common/identifier.service';
import { ProcessAccessService } from '../../common/process-access.service';

function serializeComposerTemplate(template: {
  id: string;
  displayCode: string;
  processId: string | null;
  name: string;
  theme: string;
  template: unknown;
  createdAt: Date;
}) {
  return {
    id: template.id,
    displayCode: template.displayCode,
    processId: template.processId,
    name: template.name,
    theme: template.theme,
    template: template.template,
    createdAt: template.createdAt.toISOString(),
  };
}

@Injectable()
export class TemplatesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly identifiers: IdentifierService,
    private readonly activity: ActivityLogService,
    private readonly processAccess: ProcessAccessService,
  ) {}

  async list(processIdOrCode: string | undefined, user: SessionUser) {
    if (processIdOrCode) {
      const process = await this.processAccess.findAccessibleProcessOrThrow(user, processIdOrCode);
      const templates = await this.prisma.composerNotificationTemplate.findMany({
        where: { processId: process.id },
        orderBy: { createdAt: 'desc' },
      });
      return templates.map(serializeComposerTemplate);
    }
    if (user.role === 'admin') {
      const templates = await this.prisma.composerNotificationTemplate.findMany({
        orderBy: { createdAt: 'desc' },
      });
      return templates.map(serializeComposerTemplate);
    }
    const processIds = await this.processAccess.listProcessIdsForUser(user.id);
    const templates = await this.prisma.composerNotificationTemplate.findMany({
      where: {
        OR: [{ ownerId: user.id }, { processId: { in: processIds } }],
      },
      orderBy: { createdAt: 'desc' },
    });
    return templates.map(serializeComposerTemplate);
  }

  async create(
    body: { processId?: string | null; name: string; theme: string; template: Record<string, unknown> },
    user: SessionUser,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const process = body.processId
        ? await this.processAccess.findAccessibleProcessOrThrow(user, String(body.processId), 'editor')
        : null;
      const template = await tx.composerNotificationTemplate.create({
        data: {
          id: createId(),
          displayCode: await this.identifiers.nextTemplateCode(tx),
          processId: process?.id ?? undefined,
          ownerId: user.id,
          name: body.name.trim(),
          theme: body.theme,
          template: body.template as any,
        },
      });
      await this.activity.append(tx, {
        actorId: user.id,
        actorEmail: user.email,
        processId: process?.id ?? null,
        entityType: 'composer_notification_template',
        entityId: template.id,
        entityCode: template.displayCode,
        action: 'template.saved',
        after: serializeComposerTemplate(template),
      });
      return serializeComposerTemplate(template);
    });
  }

  async delete(idOrCode: string, user: SessionUser) {
    const template = await this.prisma.composerNotificationTemplate.findFirst({
      where: { OR: [{ id: idOrCode }, { displayCode: idOrCode }] },
    });
    if (!template) return { ok: true };
    if (template.processId) {
      await this.processAccess.require(template.processId, user, 'editor');
    } else if (template.ownerId !== user.id && user.role !== 'admin') {
      throw new ForbiddenException();
    }
    return this.prisma.$transaction(async (tx) => {
      await tx.composerNotificationTemplate.delete({ where: { id: template.id } });
      await this.activity.append(tx, {
        actorId: user.id,
        actorEmail: user.email,
        processId: template.processId,
        entityType: 'composer_notification_template',
        entityId: template.id,
        entityCode: template.displayCode,
        action: 'template.deleted',
        before: serializeComposerTemplate(template),
      });
      return { ok: true };
    });
  }
}

import { Injectable } from '@nestjs/common';
import type { SessionUser } from '@ses/domain';
import { createId } from '@ses/domain';
import { IdentifierService } from './common/identifier.service';
import { PrismaService } from './common/prisma.service';

type NotificationRecord = {
  id: string;
  message: string;
  link: string | null;
  kind: string;
  createdAt: string;
  read: boolean;
};

type PreferenceData = {
  inAppReadIds?: string[];
  savedEscalationViews?: Array<{ id: string; name: string; filters: Record<string, string> }>;
};

@Injectable()
export class InAppNotificationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly identifiers: IdentifierService,
  ) {}

  private async readPreference(userId: string) {
    const pref = await this.prisma.userPreference.findUnique({ where: { userId } });
    const data = (pref?.data ?? {}) as PreferenceData;
    return { pref, data };
  }

  async list(user: SessionUser) {
    const [events, prefState] = await Promise.all([
      this.prisma.activityLog.findMany({
        where: { entityType: 'in_app_notification' },
        orderBy: { occurredAt: 'desc' },
        take: 50,
      }),
      this.readPreference(user.id),
    ]);
    const read = new Set(prefState.data.inAppReadIds ?? []);
    const items: NotificationRecord[] = events.map((event) => {
      const meta = (event.metadata ?? {}) as Record<string, unknown>;
      return {
        id: event.id,
        message: String(meta.message ?? event.action),
        link: meta.link ? String(meta.link) : null,
        kind: String(meta.kind ?? 'generic'),
        createdAt: event.occurredAt.toISOString(),
        read: read.has(event.id),
      };
    });
    const unreadCount = items.filter((item) => !item.read).length;
    return { items, unreadCount };
  }

  async markRead(user: SessionUser, id: string) {
    const { pref, data } = await this.readPreference(user.id);
    const read = new Set(data.inAppReadIds ?? []);
    read.add(id);
    await this.upsertPreference(user.id, pref?.id, { ...data, inAppReadIds: [...read] });
    return { ok: true };
  }

  async markAllRead(user: SessionUser) {
    const [all, prefState] = await Promise.all([
      this.prisma.activityLog.findMany({
        where: { entityType: 'in_app_notification' },
        select: { id: true },
      }),
      this.readPreference(user.id),
    ]);
    const read = new Set(prefState.data.inAppReadIds ?? []);
    for (const row of all) read.add(row.id);
    await this.upsertPreference(user.id, prefState.pref?.id, { ...prefState.data, inAppReadIds: [...read] });
    return { ok: true };
  }

  async publish(message: string, opts?: { link?: string; kind?: string }) {
    await this.prisma.activityLog.create({
      data: {
        id: createId(),
        displayCode: await this.identifiers.nextActivityCode(this.prisma),
        entityType: 'in_app_notification',
        action: 'notification.created',
        metadata: {
          message,
          ...(opts?.link ? { link: opts.link } : {}),
          ...(opts?.kind ? { kind: opts.kind } : {}),
        } as object,
      },
    });
  }

  private async upsertPreference(userId: string, currentId: string | undefined, data: PreferenceData) {
    if (currentId) {
      await this.prisma.userPreference.update({
        where: { id: currentId },
        data: { data: data as object },
      });
      return;
    }
    await this.prisma.userPreference.create({
      data: {
        id: await this.identifiers.nextUserPreferenceId(this.prisma),
        userId,
        data: data as object,
      },
    });
  }
}

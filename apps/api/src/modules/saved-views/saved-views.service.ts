import { BadRequestException, Injectable } from '@nestjs/common';
import type { SessionUser } from '@ses/domain';
import { createId } from '@ses/domain';
import { IdentifierService } from '../../common/identifier.service';
import { PrismaService } from '../../common/prisma.service';

type SavedView = { id: string; name: string; filters: Record<string, string> };
type PrefData = { savedEscalationViews?: SavedView[]; inAppReadIds?: string[] };

const DEFAULT_VIEWS: SavedView[] = [
  { id: 'default-my-overdue', name: 'My overdue', filters: { sla: 'breached', mine: '1' } },
  { id: 'default-l2', name: 'L2 escalations', filters: { stages: 'ESCALATED_L2' } },
  { id: 'default-awaiting-review', name: 'Awaiting my review', filters: { stages: 'DRAFTED', mine: '1' } },
];

@Injectable()
export class SavedViewsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly identifiers: IdentifierService,
  ) {}

  private async read(userId: string) {
    const pref = await this.prisma.userPreference.findUnique({ where: { userId } });
    const data = (pref?.data ?? {}) as PrefData;
    return { pref, data };
  }

  async list(user: SessionUser) {
    const { data } = await this.read(user.id);
    return { items: [...DEFAULT_VIEWS, ...(data.savedEscalationViews ?? [])] };
  }

  async create(user: SessionUser, body: { name: string; filters: Record<string, string> }) {
    const name = body.name.trim();
    if (!name) throw new BadRequestException('Name is required');
    const { pref, data } = await this.read(user.id);
    const next: SavedView = { id: createId(), name, filters: body.filters ?? {} };
    const savedEscalationViews = [...(data.savedEscalationViews ?? []), next];
    if (pref) {
      await this.prisma.userPreference.update({
        where: { id: pref.id },
        data: { data: { ...data, savedEscalationViews } as object },
      });
    } else {
      await this.prisma.userPreference.create({
        data: {
          id: await this.identifiers.nextUserPreferenceId(this.prisma),
          userId: user.id,
          data: { savedEscalationViews } as object,
        },
      });
    }
    return next;
  }
}

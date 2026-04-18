import { Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { SessionUser } from '@ses/domain';
import { PrismaService } from './common/prisma.service';
import { ProcessAccessService } from './common/process-access.service';

const exportMetaSelect = {
  id: true,
  displayCode: true,
  format: true,
  kind: true,
  status: true,
  processId: true,
  auditRunId: true,
  savedVersionId: true,
  requestedById: true,
  requestId: true,
  sizeBytes: true,
  contentType: true,
  createdAt: true,
  downloadedAt: true,
  expiresAt: true,
} satisfies Prisma.ExportSelect;

@Injectable()
export class ExportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly processAccess: ProcessAccessService,
  ) {}

  private exportAccessWhere(user: SessionUser): Prisma.ExportWhereInput | undefined {
    if (user.role === 'admin') {
      return undefined;
    }
    return {
      OR: [
        { processId: null, requestedById: user.id },
        { process: { members: { some: { userId: user.id } } } },
      ],
    };
  }

  private idMatch(idOrCode: string): Prisma.ExportWhereInput {
    return { OR: [{ id: idOrCode }, { displayCode: idOrCode }] };
  }

  async get(idOrCode: string, user: SessionUser) {
    const access = this.exportAccessWhere(user);
    const row = await this.prisma.export.findFirst({
      where: access ? { AND: [this.idMatch(idOrCode), access] } : this.idMatch(idOrCode),
      select: exportMetaSelect,
    });
    if (!row) {
      throw new NotFoundException(`Export ${idOrCode} not found`);
    }
    return row;
  }

  async download(idOrCode: string, user: SessionUser) {
    const access = this.exportAccessWhere(user);
    const row = await this.prisma.export.findFirst({
      where: access ? { AND: [this.idMatch(idOrCode), access] } : this.idMatch(idOrCode),
    });
    if (!row) {
      throw new NotFoundException(`Export ${idOrCode} not found`);
    }
    if (!row.content) {
      throw new NotFoundException(`Export ${idOrCode} not found`);
    }
    return row;
  }
}

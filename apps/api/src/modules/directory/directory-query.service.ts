import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { SessionUser } from '@ses/domain';
import { sanitizeHeader } from '@ses/domain';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma.service';
import { ActivityLogService } from '../../common/activity-log.service';
import { matchRawNameToDirectoryEntries } from '../../directory/directory-matching';

function parseAliases(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((x): x is string => typeof x === 'string');
}

function displayNameFromEntry(firstName: string, lastName: string): string {
  return `${sanitizeHeader(firstName)} ${sanitizeHeader(lastName)}`.trim();
}

function splitFullName(name: string): { firstName: string; lastName: string } {
  const parts = sanitizeHeader(name).trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return { firstName: '', lastName: '' };
  if (parts.length === 1) return { firstName: parts[0] ?? '', lastName: '' };
  return {
    firstName: parts.slice(0, -1).join(' '),
    lastName: parts[parts.length - 1] ?? '',
  };
}

export { parseAliases, displayNameFromEntry, splitFullName };

@Injectable()
export class DirectoryQueryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly activity: ActivityLogService,
  ) {}

  private requireTenant(user: SessionUser): string {
    if (!user.tenantId) throw new ForbiddenException('Missing tenant');
    return user.tenantId;
  }

  private requireManagerDirectoryEnabled(user: SessionUser): void {
    if (!user.managerDirectoryEnabled) {
      throw new ForbiddenException('Manager directory is disabled for this tenant');
    }
  }

  private requireAuditorOrAdmin(user: SessionUser): void {
    if (user.role !== 'admin' && user.role !== 'auditor') {
      throw new ForbiddenException('Insufficient permission');
    }
  }

  requireAdmin(user: SessionUser): void {
    if (user.role !== 'admin') {
      throw new ForbiddenException('Admin role required');
    }
  }

  async loadEntryOrThrow(tenantId: string, idOrCode: string) {
    const row = await this.prisma.managerDirectory.findFirst({
      where: {
        tenantId,
        OR: [{ id: idOrCode }, { displayCode: idOrCode }],
      },
    });
    if (!row) throw new NotFoundException('Directory entry not found');
    return row;
  }

  serializeEntry(row: {
    id: string;
    displayCode: string;
    firstName: string;
    lastName: string;
    email: string;
    normalizedKey: string;
    aliases: unknown;
    active: boolean;
    source: string;
    createdAt: Date;
    updatedAt: Date;
  }) {
    return {
      id: row.id,
      displayCode: row.displayCode,
      firstName: row.firstName,
      lastName: row.lastName,
      email: row.email,
      normalizedKey: row.normalizedKey,
      aliases: parseAliases(row.aliases),
      active: row.active,
      source: row.source,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  async list(
    user: SessionUser,
    query: { search?: string; filter?: 'active' | 'archived' | 'all'; limit?: number; offset?: number },
  ) {
    this.requireAdmin(user);
    this.requireManagerDirectoryEnabled(user);
    const tenantId = this.requireTenant(user);
    const filter = query.filter ?? 'active';
    const where: Prisma.ManagerDirectoryWhereInput = { tenantId };
    if (filter === 'active') where.active = true;
    else if (filter === 'archived') where.active = false;
    const search = query.search?.trim();
    if (search) {
      where.OR = [
        { email: { contains: search, mode: 'insensitive' } },
        { firstName: { contains: search, mode: 'insensitive' } },
        { lastName: { contains: search, mode: 'insensitive' } },
        { displayCode: { contains: search, mode: 'insensitive' } },
      ];
    }
    const take = Math.min(Math.max(query.limit ?? 50, 1), 200);
    const skip = Math.max(query.offset ?? 0, 0);
    const [items, total] = await Promise.all([
      this.prisma.managerDirectory.findMany({ where, orderBy: { updatedAt: 'desc' }, take, skip }),
      this.prisma.managerDirectory.count({ where }),
    ]);
    return { items: items.map((r) => this.serializeEntry(r)), total, limit: take, offset: skip };
  }

  async history(user: SessionUser, idOrCode: string) {
    this.requireAdmin(user);
    this.requireManagerDirectoryEnabled(user);
    const tenantId = this.requireTenant(user);
    const entry = await this.loadEntryOrThrow(tenantId, idOrCode);
    const issues = await this.prisma.auditIssue.findMany({
      where: {
        auditRun: {
          process: { tenantId },
          status: 'completed',
        },
        OR: [
          { email: { equals: entry.email, mode: 'insensitive' } },
          {
            AND: [
              { projectManager: { not: null } },
              { projectManager: { contains: entry.lastName, mode: 'insensitive' } },
              { projectManager: { contains: entry.firstName, mode: 'insensitive' } },
            ],
          },
        ],
      },
      include: {
        auditRun: {
          include: {
            process: { select: { displayCode: true, name: true } },
          },
        },
      },
      orderBy: { id: 'desc' },
      take: 200,
    });
    return {
      entry: this.serializeEntry(entry),
      runs: issues.map((i) => ({
        issueDisplayCode: i.displayCode,
        issueKey: i.issueKey,
        projectManager: i.projectManager,
        email: i.email,
        auditRunId: i.auditRun.id,
        auditRunCode: i.auditRun.displayCode,
        processId: i.auditRun.processId,
        processCode: i.auditRun.process.displayCode,
        processName: i.auditRun.process.name,
        completedAt: i.auditRun.completedAt?.toISOString() ?? null,
      })),
    };
  }

  async trackingImpact(user: SessionUser, idOrCode: string) {
    this.requireAdmin(user);
    this.requireManagerDirectoryEnabled(user);
    const tenantId = this.requireTenant(user);
    const entry = await this.loadEntryOrThrow(tenantId, idOrCode);
    const lower = entry.email.toLowerCase().trim();
    const count = await this.prisma.trackingEntry.count({
      where: {
        process: { tenantId },
        OR: [{ managerEmail: { equals: entry.email, mode: 'insensitive' } }, { managerKey: lower }],
      },
    });
    return { trackingRowsToRepoint: count, entryId: entry.id };
  }

  async suggestions(user: SessionUser, body: { rawNames: string[] }) {
    this.requireAuditorOrAdmin(user);
    this.requireManagerDirectoryEnabled(user);
    const tenantId = this.requireTenant(user);
    const entries = await this.prisma.managerDirectory.findMany({
      where: { tenantId, active: true },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        normalizedKey: true,
        aliases: true,
        active: true,
      },
    });
    const results: Record<
      string,
      { autoMatch: { id: string; email: string; score: number } | null; candidates: Array<{ id: string; email: string; score: number }>; collision: boolean }
    > = {};
    for (const raw of body.rawNames ?? []) {
      results[raw] = matchRawNameToDirectoryEntries(raw, entries);
    }
    return { results };
  }
}

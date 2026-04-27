import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { SessionUser } from '@ses/domain';
import {
  createId,
  isValidEmail,
  managerKey,
  normalizeManagerKey,
  sanitizeHeader,
  validateDirectoryRows,
  type DirectoryRowInput,
} from '@ses/domain';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma.service';
import { IdentifierService } from '../../common/identifier.service';
import { ActivityLogService } from '../../common/activity-log.service';
import { DirectoryBroadcastService } from './directory-broadcast.service';
import { DirectoryQueryService, parseAliases, displayNameFromEntry, splitFullName } from './directory-query.service';

@Injectable()
export class DirectoryMergeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly identifiers: IdentifierService,
    private readonly activity: ActivityLogService,
    private readonly broadcast: DirectoryBroadcastService,
    private readonly query: DirectoryQueryService,
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

  private requireAdmin(user: SessionUser): void {
    if (user.role !== 'admin') {
      throw new ForbiddenException('Admin role required');
    }
  }

  private async requireEditorOrAdmin(user: SessionUser, tenantId: string): Promise<void> {
    if (user.role === 'admin') return;
    const m = await this.prisma.processMember.findFirst({
      where: { userId: user.id, process: { tenantId }, permission: { in: ['owner', 'editor'] } },
    });
    if (!m) throw new ForbiddenException('Editor or admin permission required');
  }

  private async countTrackingRepointForEmail(tenantId: string, email: string): Promise<number> {
    const lower = email.toLowerCase().trim();
    return this.prisma.trackingEntry.count({
      where: {
        process: { tenantId },
        OR: [{ managerEmail: { equals: email, mode: 'insensitive' } }, { managerKey: lower }],
      },
    });
  }

  async mergeImpact(user: SessionUser, sourceId: string, targetId: string) {
    this.requireAdmin(user);
    this.requireManagerDirectoryEnabled(user);
    const tenantId = this.requireTenant(user);
    if (sourceId === targetId) throw new BadRequestException('source and target must differ');
    const source = await this.query.loadEntryOrThrow(tenantId, sourceId);
    const target = await this.query.loadEntryOrThrow(tenantId, targetId);
    const count = await this.countTrackingRepointForEmail(tenantId, source.email);
    return {
      trackingRowsToRepoint: count,
      source: this.query.serializeEntry(source),
      target: this.query.serializeEntry(target),
    };
  }

  async merge(user: SessionUser, body: { sourceId: string; targetId: string }) {
    this.requireAdmin(user);
    this.requireManagerDirectoryEnabled(user);
    const tenantId = this.requireTenant(user);
    const { sourceId, targetId } = body;
    if (sourceId === targetId) throw new BadRequestException('source and target must differ');
    const source = await this.query.loadEntryOrThrow(tenantId, sourceId);
    const target = await this.query.loadEntryOrThrow(tenantId, targetId);
    if (!source.active) throw new BadRequestException('Source entry is already archived');
    const srcEmail = source.email.toLowerCase().trim();
    const tgtEmail = target.email.toLowerCase().trim();
    const tgtName = displayNameFromEntry(target.firstName, target.lastName);
    const tgtKey = managerKey(tgtName, tgtEmail);
    const repointed = await this.prisma.$transaction(async (tx) => {
      const n = await tx.trackingEntry.updateMany({
        where: {
          process: { tenantId },
          OR: [{ managerEmail: { equals: source.email, mode: 'insensitive' } }, { managerKey: srcEmail }],
        },
        data: {
          managerEmail: tgtEmail,
          managerName: tgtName,
          managerKey: tgtKey,
          rowVersion: { increment: 1 },
        },
      });
      const aliasSet = new Set([
        ...parseAliases(target.aliases),
        ...parseAliases(source.aliases),
        `${source.firstName} ${source.lastName}`.trim(),
        srcEmail,
      ]);
      await tx.managerDirectory.update({
        where: { id: target.id },
        data: {
          aliases: [...aliasSet].filter(Boolean) as unknown as Prisma.InputJsonValue,
        },
      });
      await tx.managerDirectory.update({
        where: { id: source.id },
        data: { active: false },
      });
      await this.activity.append(tx, {
        actorId: user.id,
        actorEmail: user.email,
        processId: null,
        entityType: 'manager_directory',
        entityId: target.id,
        action: 'directory_merge',
        metadata: { sourceId: source.id, targetId: target.id, repointed: n.count },
      });
      return n.count;
    });
    await this.broadcast.broadcastDirectoryUpdate(tenantId, {
      action: 'merged',
      entryId: target.id,
      normalizedKeys: [source.normalizedKey, target.normalizedKey],
    });
    return { repointed, targetId: target.id };
  }

  async patchEntry(
    user: SessionUser,
    idOrCode: string,
    body: {
      firstName?: string;
      lastName?: string;
      email?: string;
      active?: boolean;
      applyEmailChange?: boolean;
    },
  ) {
    this.requireAdmin(user);
    this.requireManagerDirectoryEnabled(user);
    const tenantId = this.requireTenant(user);
    const entry = await this.query.loadEntryOrThrow(tenantId, idOrCode);
    const nextEmail = body.email !== undefined ? sanitizeHeader(body.email).toLowerCase() : entry.email;
    const emailChanging = body.email !== undefined && nextEmail !== entry.email.toLowerCase();
    if (emailChanging && body.applyEmailChange !== true) {
      const count = await this.countTrackingRepointForEmail(tenantId, entry.email);
      return { requiresConfirmation: true as const, trackingRowsToRepoint: count, entry: this.query.serializeEntry(entry) };
    }
    if (body.email !== undefined && !isValidEmail(nextEmail)) {
      throw new BadRequestException('Invalid email');
    }
    const nk =
      body.firstName !== undefined || body.lastName !== undefined
        ? normalizeManagerKey(body.firstName ?? entry.firstName, body.lastName ?? entry.lastName)
        : entry.normalizedKey;
    const tgtName = displayNameFromEntry(
      body.firstName ?? entry.firstName,
      body.lastName ?? entry.lastName,
    );
    const tgtKey = managerKey(tgtName, nextEmail);
    const updated = await this.prisma.$transaction(async (tx) => {
      if (emailChanging) {
        const dup = await tx.managerDirectory.findFirst({
          where: { tenantId, email: nextEmail, NOT: { id: entry.id } },
        });
        if (dup) throw new ConflictException('Email already used by another directory entry');
        await tx.trackingEntry.updateMany({
          where: {
            process: { tenantId },
            OR: [{ managerEmail: { equals: entry.email, mode: 'insensitive' } }, { managerKey: entry.email.toLowerCase() }],
          },
          data: {
            managerEmail: nextEmail,
            managerName: tgtName,
            managerKey: tgtKey,
            rowVersion: { increment: 1 },
          },
        });
      }
      const row = await tx.managerDirectory.update({
        where: { id: entry.id },
        data: {
          firstName: body.firstName ?? undefined,
          lastName: body.lastName ?? undefined,
          email: body.email !== undefined ? nextEmail : undefined,
          normalizedKey: nk,
          active: body.active ?? undefined,
        },
      });
      await this.activity.append(tx, {
        actorId: user.id,
        actorEmail: user.email,
        processId: null,
        entityType: 'manager_directory',
        entityId: entry.id,
        action: 'directory_patch',
        after: body as unknown as Record<string, unknown>,
      });
      return row;
    });
    await this.broadcast.broadcastDirectoryUpdate(tenantId, {
      action: 'updated',
      entryId: updated.id,
      normalizedKeys: [updated.normalizedKey],
    });
    return this.query.serializeEntry(updated);
  }

  async archiveBulk(user: SessionUser, body: { ids: string[] }) {
    this.requireAdmin(user);
    this.requireManagerDirectoryEnabled(user);
    const tenantId = this.requireTenant(user);
    const res = await this.prisma.managerDirectory.updateMany({
      where: { tenantId, id: { in: body.ids } },
      data: { active: false },
    });
    if (res.count > 0) {
      await this.broadcast.broadcastDirectoryUpdate(tenantId, { action: 'archived' });
    }
    return { archived: res.count };
  }

  async deleteManager(user: SessionUser, id: string): Promise<void> {
    this.requireAdmin(user);
    this.requireManagerDirectoryEnabled(user);
    const tenantId = this.requireTenant(user);
    const entry = await this.prisma.managerDirectory.findFirst({ where: { id, tenantId } });
    if (!entry) throw new NotFoundException('Manager not found');

    const activeAuditRuleRefs = await this.prisma.trackingEntry.count({
      where: {
        resolved: false,
        OR: [
          { managerEmail: { equals: entry.email, mode: 'insensitive' } },
          { managerKey: entry.email.toLowerCase().trim() },
        ],
        process: { tenantId, archivedAt: null },
      },
    });
    if (activeAuditRuleRefs > 0) {
      throw new ConflictException({
        message: `Cannot delete — manager is still used by ${activeAuditRuleRefs} active audit rules.`,
      });
    }

    await this.prisma.$transaction(async (tx) => {
      // Cascade cleanup: any AuditIssue rows that still carry this manager's
      // email would point at a directory entry that no longer exists. Clear
      // them to '' so the UI shows "Missing email — add to directory" again
      // and the next audit run (or a manual directory re-import) can
      // re-resolve the owner cleanly. Scoped to the tenant so cross-tenant
      // data is never touched.
      const scrubbed = await tx.auditIssue.updateMany({
        where: {
          email: { equals: entry.email, mode: 'insensitive' },
          auditRun: { process: { tenantId } },
        },
        data: { email: '' },
      });
      await tx.managerDirectory.delete({ where: { id: entry.id } });
      await this.activity.append(tx, {
        actorId: user.id,
        actorEmail: user.email,
        processId: null,
        entityType: 'manager_directory',
        entityId: entry.id,
        entityCode: entry.displayCode,
        action: 'directory.manager.deleted',
        metadata: {
          targetId: entry.id,
          targetCode: entry.displayCode,
          tenantId,
          scrubbedIssueCount: scrubbed.count,
        },
      });
    });
    await this.broadcast.broadcastDirectoryUpdate(tenantId, {
      action: 'deleted',
      entryId: entry.id,
      normalizedKeys: [entry.normalizedKey],
    });
  }

  async resolve(
    user: SessionUser,
    body: {
      rawName: string;
      directoryEntryId?: string;
      inline?: DirectoryRowInput;
    },
  ) {
    const tenantId = this.requireTenant(user);
    this.requireManagerDirectoryEnabled(user);
    await this.requireEditorOrAdmin(user, tenantId);
    const raw = sanitizeHeader(body.rawName).trim();
    if (!raw) throw new BadRequestException('rawName is required');
    if (body.inline) {
      this.requireAdmin(user);
      const inline = body.inline;
      const v = validateDirectoryRows([inline])[0];
      if (!v) throw new BadRequestException('Invalid inline row');
      if (v.issues.length) throw new BadRequestException({ issues: v.issues });
      const email = sanitizeHeader(inline.email).toLowerCase();
      const nk = normalizeManagerKey(inline.firstName, inline.lastName);
      const row = await this.prisma.$transaction(async (tx) => {
        const created = await tx.managerDirectory.create({
          data: {
            id: createId(),
            displayCode: await this.identifiers.nextManagerDirectoryCode(tx),
            tenantId,
            firstName: inline.firstName,
            lastName: inline.lastName,
            email,
            normalizedKey: nk,
            aliases: [raw],
            active: true,
            source: 'inline-resolved',
            createdById: user.id,
          },
        });
        await this.activity.append(tx, {
          actorId: user.id,
          actorEmail: user.email,
          processId: null,
          entityType: 'manager_directory',
          entityId: created.id,
          action: 'directory_resolve_inline',
          metadata: { rawName: raw },
        });
        return created;
      });
      await this.broadcast.broadcastDirectoryUpdate(tenantId, {
        action: 'created',
        entryId: row.id,
        normalizedKeys: [row.normalizedKey],
      });
      return this.query.serializeEntry(row);
    }
    if (!body.directoryEntryId) {
      throw new BadRequestException('directoryEntryId or inline required');
    }
    const entry = await this.query.loadEntryOrThrow(tenantId, body.directoryEntryId);
    if (!entry.active) throw new BadRequestException('Cannot resolve to archived entry');
    const aliases = parseAliases(entry.aliases);
    const lower = raw.toLowerCase();
    if (!aliases.some((a) => a.toLowerCase() === lower) && raw !== `${entry.firstName} ${entry.lastName}`.trim()) {
      aliases.push(raw);
    }
    const updated = await this.prisma.managerDirectory.update({
      where: { id: entry.id },
      data: { aliases: aliases as unknown as Prisma.InputJsonValue },
    });
    await this.activity.append(this.prisma, {
      actorId: user.id,
      actorEmail: user.email,
      processId: null,
      entityType: 'manager_directory',
      entityId: entry.id,
      action: 'directory_resolve_alias',
      metadata: { rawName: raw },
    });
    await this.broadcast.broadcastDirectoryUpdate(tenantId, {
      action: 'updated',
      entryId: updated.id,
      normalizedKeys: [updated.normalizedKey],
    });
    return this.query.serializeEntry(updated);
  }

  async resolveBatch(
    user: SessionUser,
    body: { items: Array<{ rawName: string; directoryEntryId: string }> },
  ) {
    const tenantId = this.requireTenant(user);
    this.requireManagerDirectoryEnabled(user);
    await this.requireEditorOrAdmin(user, tenantId);
    const results: Array<{ rawName: string; ok: boolean; error?: string }> = [];
    for (const item of body.items ?? []) {
      try {
        await this.resolve(user, { rawName: item.rawName, directoryEntryId: item.directoryEntryId });
        results.push({ rawName: item.rawName, ok: true });
      } catch (err) {
        const error = err instanceof Error ? err.message : 'error';
        results.push({ rawName: item.rawName, ok: false, error });
      }
    }
    return { results };
  }

  async createManualEntry(user: SessionUser, row: DirectoryRowInput) {
    this.requireAdmin(user);
    this.requireManagerDirectoryEnabled(user);
    const tenantId = this.requireTenant(user);
    const v = validateDirectoryRows([row])[0];
    if (!v || v.issues.length) {
      throw new BadRequestException({ issues: v?.issues ?? ['invalid'] });
    }
    const email = sanitizeHeader(v.input.email).toLowerCase();
    const nk = normalizeManagerKey(v.input.firstName, v.input.lastName);
    const created = await this.prisma.$transaction(async (tx) => {
      const dup = await tx.managerDirectory.findFirst({ where: { tenantId, email } });
      if (dup) throw new ConflictException('Email already exists in directory');
      return tx.managerDirectory.create({
        data: {
          id: createId(),
          displayCode: await this.identifiers.nextManagerDirectoryCode(tx),
          tenantId,
          firstName: v.input.firstName,
          lastName: v.input.lastName,
          email,
          normalizedKey: nk,
          aliases: [],
          active: true,
          source: 'manual',
          createdById: user.id,
        },
      });
    });
    await this.broadcast.broadcastDirectoryUpdate(tenantId, {
      action: 'created',
      entryId: created.id,
      normalizedKeys: [created.normalizedKey],
    });
    return this.query.serializeEntry(created);
  }

  async createManager(
    user: SessionUser,
    payload: { code: string; name: string; email: string; active?: boolean },
  ) {
    this.requireAdmin(user);
    this.requireManagerDirectoryEnabled(user);
    const tenantId = this.requireTenant(user);
    const code = sanitizeHeader(payload.code).trim().toUpperCase();
    const name = sanitizeHeader(payload.name).trim();
    const email = sanitizeHeader(payload.email).trim().toLowerCase();

    if (!/^[A-Z0-9_-]{2,16}$/.test(code)) {
      throw new BadRequestException({ field: 'code', message: 'Code must match ^[A-Z0-9_-]{2,16}$.' });
    }
    if (name.length < 2 || name.length > 80) {
      throw new BadRequestException({ field: 'name', message: 'Name must be 2-80 characters.' });
    }
    if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new BadRequestException({ field: 'email', message: 'Email is not valid.' });
    }

    const { firstName, lastName } = splitFullName(name);
    if (!firstName) throw new BadRequestException({ field: 'name', message: 'Name is required.' });
    const nk = normalizeManagerKey(firstName, lastName);

    let created;
    try {
      created = await this.prisma.$transaction(async (tx) => {
        const dupCode = await tx.managerDirectory.findFirst({
          where: { tenantId, displayCode: code },
          select: { id: true },
        });
        if (dupCode) throw new ConflictException({ field: 'code', message: 'Code already in use.' });
        const dupEmail = await tx.managerDirectory.findFirst({
          where: { tenantId, email },
          select: { id: true },
        });
        if (dupEmail) throw new ConflictException({ field: 'email', message: 'Email already in use.' });
        return tx.managerDirectory.create({
          data: {
            id: createId(),
            displayCode: code,
            tenantId,
            firstName,
            lastName,
            email,
            normalizedKey: nk,
            aliases: [],
            active: payload.active ?? true,
            source: 'manual',
            createdById: user.id,
          },
        });
      });
    } catch (error) {
      const prismaLike = error as { code?: string; meta?: { target?: string[] | string } };
      if (prismaLike.code === 'P2002') {
        const target = Array.isArray(prismaLike.meta?.target)
          ? prismaLike.meta?.target.join(',')
          : String(prismaLike.meta?.target ?? '');
        if (target.includes('email')) {
          throw new ConflictException({ field: 'email', message: 'Email already in use.' });
        }
        if (target.includes('displayCode')) {
          throw new ConflictException({ field: 'code', message: 'Code already in use.' });
        }
        throw new ConflictException({ field: 'code', message: 'Code already in use.' });
      }
      throw error;
    }
    await this.broadcast.broadcastDirectoryUpdate(tenantId, {
      action: 'created',
      entryId: created.id,
      normalizedKeys: [created.normalizedKey],
    });
    return this.query.serializeEntry(created);
  }
}

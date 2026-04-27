import {
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import type { SessionUser } from '@ses/domain';
import {
  createId,
  isValidEmail,
  normalizeManagerKey,
  sanitizeHeader,
  validateDirectoryRows,
  type DirectoryRowInput,
  type DirectoryRowValidation,
} from '@ses/domain';
import { PrismaService } from '../../common/prisma.service';
import { IdentifierService } from '../../common/identifier.service';
import { ActivityLogService } from '../../common/activity-log.service';
import { DirectoryBroadcastService } from './directory-broadcast.service';

@Injectable()
export class DirectoryImportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly identifiers: IdentifierService,
    private readonly activity: ActivityLogService,
    private readonly broadcast: DirectoryBroadcastService,
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

  async uploadPreview(
    user: SessionUser,
    body: { rows: DirectoryRowInput[]; strategy?: 'preview' },
  ) {
    this.requireAdmin(user);
    this.requireManagerDirectoryEnabled(user);
    const tenantId = this.requireTenant(user);
    const validated = validateDirectoryRows(body.rows ?? []);
    const existing = await this.prisma.managerDirectory.findMany({
      where: { tenantId, active: true },
      select: { email: true },
    });
    const existingEmails = new Set(existing.map((e) => e.email.toLowerCase()));
    type PreviewRow = DirectoryRowValidation & { dupDb: boolean; rowKind: 'ok' | 'invalid' | 'duplicate_db' };
    const preview: PreviewRow[] = validated.map((v: DirectoryRowValidation) => {
      const emailLower = v.input.email.toLowerCase();
      const dupDb = Boolean(v.input.email && isValidEmail(v.input.email) && existingEmails.has(emailLower));
      return {
        ...v,
        dupDb,
        rowKind: dupDb ? 'duplicate_db' : v.issues.length ? 'invalid' : 'ok',
      };
    });
    const counts = {
      total: preview.length,
      ok: preview.filter((p: PreviewRow) => p.rowKind === 'ok').length,
      invalid: preview.filter((p: PreviewRow) => p.rowKind === 'invalid').length,
      duplicateDb: preview.filter((p: PreviewRow) => p.rowKind === 'duplicate_db').length,
    };
    return { preview, counts };
  }

  async commit(
    user: SessionUser,
    body: {
      rows: DirectoryRowInput[];
      strategy: 'skip_duplicates' | 'update_existing';
    },
  ) {
    this.requireAdmin(user);
    this.requireManagerDirectoryEnabled(user);
    const tenantId = this.requireTenant(user);
    const validated = validateDirectoryRows(body.rows ?? []);
    const preview = await this.uploadPreview(user, { rows: body.rows });
    const created: string[] = [];
    const updated: string[] = [];
    const skipped: string[] = [];
    await this.prisma.$transaction(async (tx) => {
      for (const v of validated) {
        if (v.issues.length) continue;
        const email = sanitizeHeader(v.input.email).toLowerCase();
        const nk = normalizeManagerKey(v.input.firstName, v.input.lastName);
        const existing = await tx.managerDirectory.findFirst({
          where: { tenantId, email },
        });
        if (existing) {
          if (body.strategy === 'skip_duplicates') {
            skipped.push(email);
            continue;
          }
          await tx.managerDirectory.update({
            where: { id: existing.id },
            data: {
              firstName: v.input.firstName,
              lastName: v.input.lastName,
              normalizedKey: nk,
              source: 'upload',
              updatedAt: new Date(),
            },
          });
          updated.push(existing.id);
          continue;
        }
        const row = await tx.managerDirectory.create({
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
            source: 'upload',
            createdById: user.id,
          },
        });
        created.push(row.id);
      }
      await this.activity.append(tx, {
        actorId: user.id,
        actorEmail: user.email,
        processId: null,
        entityType: 'manager_directory',
        action: 'directory_commit',
        metadata: { created, updated, skipped, strategy: body.strategy, previewCounts: preview.counts },
      });
    });
    if (created.length > 0 || updated.length > 0) {
      await this.broadcast.broadcastDirectoryUpdate(tenantId, { action: 'updated' });
    }
    return { created, updated, skipped, previewCounts: preview.counts };
  }
}

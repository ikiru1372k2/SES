import { Injectable } from '@nestjs/common';
import type { Prisma, DataClient } from '../repositories/types';
import { ulid } from 'ulid';
import { IdentifierService } from './identifier.service';
import { requestContext } from './request-context';

type TxLike = Prisma.TransactionClient | DataClient;

export interface AppendActivityInput {
  actorId?: string;
  actorEmail?: string;
  processId?: string | null;
  entityType: string;
  entityId?: string | null;
  entityCode?: string | null;
  action: string;
  before?: unknown;
  after?: unknown;
  ipAddress?: string | null;
  userAgent?: string | null;
  metadata?: unknown;
}

@Injectable()
export class ActivityLogService {
  constructor(private readonly identifiers: IdentifierService) {}

  async append(tx: TxLike, input: AppendActivityInput): Promise<void> {
    const ctx = requestContext.get();
    await tx.activityLog.create({
      data: {
        id: ulid(),
        displayCode: await this.identifiers.nextActivityCode(tx),
        actorId: input.actorId,
        actorEmail: input.actorEmail,
        processId: input.processId ?? undefined,
        entityType: input.entityType,
        entityId: input.entityId ?? undefined,
        entityCode: input.entityCode ?? undefined,
        action: input.action,
        // PRISMA-JSON: before/after/metadata are Json columns; `as never` + `as any` suppress JsonValue mismatch
        before: input.before as never,
        after: input.after as never,
        requestId: ctx.requestId,
        ipAddress: input.ipAddress ?? undefined,
        userAgent: input.userAgent ?? undefined,
        metadata: input.metadata as never,
      } as any, // PRISMA-JSON: unavoidable until Prisma 6 supports typed JSON columns
    });
  }
}

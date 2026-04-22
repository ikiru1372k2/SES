import { Injectable } from '@nestjs/common';
import type { Prisma, PrismaClient } from '@prisma/client';
import { ulid } from 'ulid';

type TxLike = Prisma.TransactionClient | PrismaClient;

function pad(value: number, width: number): string {
  return String(value).padStart(width, '0');
}

@Injectable()
export class IdentifierService {
  async nextSequence(
    tx: TxLike,
    prefix: string,
    scopeKey = 'tenant',
    year = new Date().getUTCFullYear(),
  ): Promise<number> {
    const result = await tx.$queryRaw<Array<{ currentValue: number }>>`
      INSERT INTO "IdentifierCounter" ("id", "prefix", "scopeKey", "year", "currentValue", "createdAt", "updatedAt")
      VALUES (${ulid()}, ${prefix}, ${scopeKey}, ${year}, 1, NOW(), NOW())
      ON CONFLICT ("prefix", "scopeKey", "year")
      DO UPDATE SET "currentValue" = "IdentifierCounter"."currentValue" + 1, "updatedAt" = NOW()
      RETURNING "currentValue"
    `;
    return result[0]?.currentValue ?? 1;
  }

  async nextProcessCode(tx: TxLike, year = new Date().getUTCFullYear()): Promise<string> {
    const value = await this.nextSequence(tx, 'PRC', 'tenant', year);
    return `PRC-${year}-${pad(value, 4)}`;
  }

  async nextMemberCode(tx: TxLike, processCode: string): Promise<string> {
    const value = await this.nextSequence(tx, 'MBR', processCode);
    return `MBR-${processCode}-${pad(value, 2)}`;
  }

  async nextFileCode(tx: TxLike, processCode: string): Promise<string> {
    const value = await this.nextSequence(tx, 'FIL', processCode);
    return `FIL-${processCode}-${pad(value, 3)}`;
  }

  async nextSheetCode(tx: TxLike, fileCode: string): Promise<string> {
    const value = await this.nextSequence(tx, 'SHT', fileCode);
    return `SHT-${fileCode}-${pad(value, 2)}`;
  }

  async nextRunCode(tx: TxLike, processCode: string): Promise<string> {
    const value = await this.nextSequence(tx, 'RUN', processCode);
    return `RUN-${processCode}-${pad(value, 3)}`;
  }

  async nextVersionCode(tx: TxLike, processCode: string): Promise<string> {
    const value = await this.nextSequence(tx, 'VER', processCode);
    return `VER-${processCode}-${pad(value, 3)}`;
  }

  async nextIssueCode(tx: TxLike, runCode: string): Promise<string> {
    const value = await this.nextSequence(tx, 'ISS', runCode);
    return `ISS-${runCode}-${pad(value, 5)}`;
  }

  async nextTrackingCode(tx: TxLike, processCode: string): Promise<string> {
    const value = await this.nextSequence(tx, 'MGR', processCode);
    return `MGR-${processCode}-${pad(value, 3)}`;
  }

  async nextTrackingEventCode(tx: TxLike): Promise<string> {
    const value = await this.nextSequence(tx, 'EVT');
    return `EVT-${pad(value, 9)}`;
  }

  async nextCommentCode(tx: TxLike): Promise<string> {
    const value = await this.nextSequence(tx, 'CMT');
    return `CMT-${pad(value, 9)}`;
  }

  async nextCorrectionCode(tx: TxLike, issueKey: string): Promise<string> {
    const value = await this.nextSequence(tx, 'COR', issueKey);
    return `COR-${issueKey}-${pad(value, 2)}`;
  }

  async acknowledgmentCode(_tx: TxLike, issueKey: string): Promise<string> {
    return `ACK-${issueKey}`;
  }

  async nextTemplateCode(tx: TxLike): Promise<string> {
    const value = await this.nextSequence(tx, 'TPL');
    return `TPL-${pad(value, 3)}`;
  }

  async nextNotificationCode(tx: TxLike, processCode: string): Promise<string> {
    const value = await this.nextSequence(tx, 'NOT', processCode);
    return `NOT-${processCode}-${pad(value, 4)}`;
  }

  async nextActivityCode(tx: TxLike, year = new Date().getUTCFullYear()): Promise<string> {
    const value = await this.nextSequence(tx, 'ACT', 'tenant', year);
    return `ACT-${year}-${pad(value, 8)}`;
  }

  async nextExportCode(tx: TxLike): Promise<string> {
    const value = await this.nextSequence(tx, 'EXP');
    return `EXP-${pad(value, 8)}`;
  }

  async nextJobCode(tx: TxLike): Promise<string> {
    const value = await this.nextSequence(tx, 'JOB');
    return `JOB-${pad(value, 8)}`;
  }

  async nextNotificationLogCode(tx: TxLike, processCode: string): Promise<string> {
    const value = await this.nextSequence(tx, 'NTL', processCode);
    return `NTL-${processCode}-${pad(value, 4)}`;
  }

  async nextUserPreferenceId(tx: TxLike): Promise<string> {
    return ulid();
  }

  async nextManagerDirectoryCode(tx: TxLike): Promise<string> {
    const value = await this.nextSequence(tx, 'MDR', 'tenant');
    return `MDR-${pad(value, 6)}`;
  }
}

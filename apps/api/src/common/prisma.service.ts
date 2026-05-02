/**
 * Backwards-compatible name for the data-access client. The class is
 * still called `PrismaService` so existing services keep injecting it
 * under that symbol — but **there is no Prisma**. Internally it is a
 * hand-written pg-backed client (see
 * `apps/api/src/repositories/pg-data-client.ts`). The schema authority
 * is `apps/api/db/migrations/*.sql`.
 *
 * The class extends `PgDataClient` semantics by attaching the model
 * proxies in the constructor. The interface is *re-declared* as an
 * intersection at the top of the file and re-exported via type-cast on
 * the symbol so Nest's reflect-metadata sees a real injectable class
 * (interface-class merging breaks DI on some TS configurations).
 */

import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Pool } from 'pg';
import { buildPgDataClient, PgDataClient, ModelProxy } from '../repositories/pg-data-client';

@Injectable()
export class PrismaService implements OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);
  private readonly pool: Pool;

  // Model accessors — declared as fields so TypeScript sees them on the
  // class without needing an interface merge (which breaks Nest DI).
  identifierCounter!: ModelProxy;
  tenant!: ModelProxy;
  user!: ModelProxy;
  process!: ModelProxy;
  managerDirectory!: ModelProxy;
  systemFunction!: ModelProxy;
  processFunction!: ModelProxy;
  functionAuditRequest!: ModelProxy;
  processMember!: ModelProxy;
  processMemberScopePermission!: ModelProxy;
  workbookFile!: ModelProxy;
  fileBlob!: ModelProxy;
  fileVersion!: ModelProxy;
  fileDraft!: ModelProxy;
  workbookSheet!: ModelProxy;
  auditRule!: ModelProxy;
  aiPilotRuleMeta!: ModelProxy;
  aiPilotSandboxSession!: ModelProxy;
  aiPilotAuditLog!: ModelProxy;
  auditRun!: ModelProxy;
  savedVersion!: ModelProxy;
  auditIssue!: ModelProxy;
  issueComment!: ModelProxy;
  issueCorrection!: ModelProxy;
  issueAcknowledgment!: ModelProxy;
  trackingEntry!: ModelProxy;
  trackingStageComment!: ModelProxy;
  trackingAttachment!: ModelProxy;
  trackingEvent!: ModelProxy;
  composerNotificationTemplate!: ModelProxy;
  notificationTemplate!: ModelProxy;
  notification!: ModelProxy;
  activityLog!: ModelProxy;
  export!: ModelProxy;
  job!: ModelProxy;
  userPreference!: ModelProxy;
  apiToken!: ModelProxy;
  webhookEndpoint!: ModelProxy;
  liveSession!: ModelProxy;
  signedLink!: ModelProxy;
  notificationLog!: ModelProxy;

  $transaction!: PgDataClient['$transaction'];
  $connect!: () => Promise<void>;
  $disconnect!: () => Promise<void>;
  $queryRaw!: PgDataClient['$queryRaw'];
  $executeRaw!: PgDataClient['$executeRaw'];

  constructor() {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error('DATABASE_URL is not set');
    this.pool = new Pool({
      connectionString,
      max: Number(process.env.DB_POOL_MAX ?? 10),
    });
    this.pool.on('error', (err) =>
      this.logger.error(`pg pool error: ${err.message}`),
    );
    Object.assign(this, buildPgDataClient(this.pool));
  }

  async onModuleDestroy(): Promise<void> {
    if (this.pool) await this.pool.end();
  }
}

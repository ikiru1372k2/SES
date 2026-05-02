import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { config as loadEnv } from 'dotenv';
import { Pool, PoolClient } from 'pg';
import {
  AUDIT_RULE_CATALOG,
  FUNCTION_REGISTRY,
  createDefaultAuditPolicy,
  createId,
} from '@ses/domain';
import { DEFAULT_TENANT_ID } from '../src/common/default-tenant';

const cwd = process.cwd();
for (const envPath of [resolve(cwd, '.env'), resolve(cwd, '..', '..', '.env')]) {
  if (existsSync(envPath)) {
    loadEnv({ path: envPath });
    break;
  }
}

async function seed(client: PoolClient): Promise<void> {
  await client.query(
    `INSERT INTO "Tenant" ("id", "name", "updatedAt")
     VALUES ($1, $2, now())
     ON CONFLICT ("id") DO UPDATE SET "name" = EXCLUDED."name", "updatedAt" = now()`,
    [DEFAULT_TENANT_ID, 'Default organization'],
  );

  const users = [
    {
      id: createId(),
      displayCode: 'USR-000001',
      email: 'admin@ses.local',
      displayName: 'SES Admin',
      role: 'admin',
    },
    {
      id: createId(),
      displayCode: 'USR-000002',
      email: 'auditor@ses.local',
      displayName: 'SES Auditor',
      role: 'auditor',
    },
  ];

  for (const u of users) {
    await client.query(
      `INSERT INTO "User" ("id","displayCode","email","displayName","role","isActive","updatedAt")
       VALUES ($1,$2,$3,$4,$5,true,now())
       ON CONFLICT ("email") DO UPDATE
         SET "displayName" = EXCLUDED."displayName",
             "role" = EXCLUDED."role",
             "isActive" = true,
             "updatedAt" = now()`,
      [u.id, u.displayCode, u.email, u.displayName, u.role],
    );
  }

  for (const fn of FUNCTION_REGISTRY) {
    await client.query(
      `INSERT INTO "SystemFunction" ("id","label","displayOrder","isSystem","updatedAt")
       VALUES ($1,$2,$3,true,now())
       ON CONFLICT ("id") DO UPDATE
         SET "label" = EXCLUDED."label",
             "displayOrder" = EXCLUDED."displayOrder",
             "isSystem" = true,
             "updatedAt" = now()`,
      [fn.id, fn.label, fn.displayOrder],
    );
  }

  for (const rule of AUDIT_RULE_CATALOG) {
    const functionId = rule.functionId ?? 'over-planning';
    await client.query(
      `INSERT INTO "AuditRule" ("id","ruleCode","functionId","name","category","description","defaultSeverity","isEnabledDefault","paramsSchema","version")
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10)
       ON CONFLICT ("ruleCode") DO UPDATE
         SET "functionId" = EXCLUDED."functionId",
             "name" = EXCLUDED."name",
             "category" = EXCLUDED."category",
             "description" = EXCLUDED."description",
             "defaultSeverity" = EXCLUDED."defaultSeverity",
             "isEnabledDefault" = EXCLUDED."isEnabledDefault",
             "paramsSchema" = EXCLUDED."paramsSchema",
             "version" = EXCLUDED."version"`,
      [
        createId(),
        rule.ruleCode,
        functionId,
        rule.name,
        rule.category,
        rule.description,
        rule.defaultSeverity,
        rule.isEnabledDefault,
        JSON.stringify(rule.paramsSchema ?? {}),
        rule.version,
      ],
    );
  }

  const DEMO_DC = 'PRC-SEED-DEMO';
  const admin = (
    await client.query<{ id: string }>(`SELECT "id" FROM "User" WHERE "email" = $1`, [
      'admin@ses.local',
    ])
  ).rows[0]!;
  const auditor = (
    await client.query<{ id: string }>(`SELECT "id" FROM "User" WHERE "email" = $1`, [
      'auditor@ses.local',
    ])
  ).rows[0]!;

  await client.query(
    `INSERT INTO "Process"
       ("id","displayCode","name","description","auditPolicy","createdById","tenantId","updatedAt")
     VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,now())
     ON CONFLICT ("displayCode") DO UPDATE
       SET "name" = EXCLUDED."name",
           "description" = EXCLUDED."description",
           "tenantId" = EXCLUDED."tenantId",
           "updatedAt" = now()`,
    [
      createId(),
      DEMO_DC,
      'Demo shared process (seed)',
      'Both seeded users are members (admin owner, auditor editor) for collaboration / realtime testing. Safe to archive or delete later.',
      JSON.stringify(createDefaultAuditPolicy()),
      admin.id,
      DEFAULT_TENANT_ID,
    ],
  );
  const demo = (
    await client.query<{ id: string }>(`SELECT "id" FROM "Process" WHERE "displayCode" = $1`, [
      DEMO_DC,
    ])
  ).rows[0]!;

  await client.query(
    `INSERT INTO "ProcessMember"
       ("id","displayCode","processId","userId","permission","addedById")
     VALUES ($1,$2,$3,$4,'owner',$3)
     ON CONFLICT ("processId","userId") DO UPDATE
       SET "permission" = EXCLUDED."permission",
           "addedById" = EXCLUDED."addedById"`,
    [createId(), `MBR-SEED-${DEMO_DC}-ADM`, demo.id, admin.id],
  );
  await client.query(
    `INSERT INTO "ProcessMember"
       ("id","displayCode","processId","userId","permission","addedById")
     VALUES ($1,$2,$3,$4,'editor',$5)
     ON CONFLICT ("processId","userId") DO UPDATE
       SET "permission" = EXCLUDED."permission",
           "addedById" = EXCLUDED."addedById"`,
    [createId(), `MBR-SEED-${DEMO_DC}-AUD`, demo.id, auditor.id, admin.id],
  );

  const tpls: Array<{ stage: string; subject: string; body: string; channel: string }> = [
    {
      stage: 'NEW',
      subject: 'Action required: {processName} — findings for {managerFirstName}',
      body: 'Hello {managerFirstName},\n\nPlease review the following:\n\n{findingsByEngine}\n\nSLA: {slaDeadline}\nLast audit: {auditRunDate}\nAuditor: {auditorName}\n\nThank you.',
      channel: 'both',
    },
    {
      stage: 'ESCALATED_L1',
      subject: 'Escalation (L1): {processName}',
      body: 'Hello {managerFirstName},\n\nThis is an L1 escalation.\n\n{findingsByEngine}\n\nSLA: {slaDeadline}\n{auditRunDate} — {auditorName}',
      channel: 'email',
    },
    {
      stage: 'ESCALATED_L2',
      subject: 'Escalation (L2): {processName}',
      body: 'Hello {managerFirstName},\n\nThis is an L2 escalation.\n\n{findingsByEngine}\n\nSLA: {slaDeadline}\n{auditRunDate} — {auditorName}',
      channel: 'email',
    },
  ];
  for (const t of tpls) {
    const existing = await client.query<{ id: string }>(
      `SELECT "id" FROM "NotificationTemplate"
        WHERE "tenantId" IS NULL AND "stage" = $1 AND "active" = true
        LIMIT 1`,
      [t.stage],
    );
    if (existing.rowCount === 0) {
      await client.query(
        `INSERT INTO "NotificationTemplate"
           ("id","tenantId","parentId","stage","subject","body","channel","active","version","createdBy","updatedAt")
         VALUES ($1,NULL,NULL,$2,$3,$4,$5,true,1,$6,now())`,
        [createId(), t.stage, t.subject, t.body, t.channel, admin.id],
      );
    }
  }
}

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is not set');
  const pool = new Pool({ connectionString: databaseUrl, max: 1 });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await seed(client);
    await client.query('COMMIT');
    console.log('seed: ok');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error('seed failed:', err instanceof Error ? err.message : err);
    process.exit(1);
  });
}

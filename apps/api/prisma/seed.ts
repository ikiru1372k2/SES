import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { config as loadEnv } from 'dotenv';
import { PrismaClient } from '@prisma/client';
import { AUDIT_RULE_CATALOG, createDefaultAuditPolicy, createId } from '@ses/domain';

const cwd = process.cwd();
for (const envPath of [resolve(cwd, '.env'), resolve(cwd, '..', '..', '.env')]) {
  if (existsSync(envPath)) {
    loadEnv({ path: envPath });
    break;
  }
}

const prisma = new PrismaClient();

async function main() {
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

  for (const user of users) {
    await prisma.user.upsert({
      where: { email: user.email },
      update: {
        displayName: user.displayName,
        role: user.role,
        isActive: true,
      },
      create: user,
    });
  }

  for (const rule of AUDIT_RULE_CATALOG) {
    await prisma.auditRule.upsert({
      where: { ruleCode: rule.ruleCode },
      update: {
        name: rule.name,
        category: rule.category,
        description: rule.description,
        defaultSeverity: rule.defaultSeverity,
        isEnabledDefault: rule.isEnabledDefault,
        paramsSchema: rule.paramsSchema as any,
        version: rule.version,
      },
      create: {
        id: createId(),
        ruleCode: rule.ruleCode,
        name: rule.name,
        category: rule.category,
        description: rule.description,
        defaultSeverity: rule.defaultSeverity,
        isEnabledDefault: rule.isEnabledDefault,
        paramsSchema: rule.paramsSchema as any,
        version: rule.version,
      },
    });
  }

  const DEMO_PROCESS_DISPLAY_CODE = 'PRC-SEED-DEMO';
  const admin = await prisma.user.findUniqueOrThrow({ where: { email: 'admin@ses.local' } });
  const auditor = await prisma.user.findUniqueOrThrow({ where: { email: 'auditor@ses.local' } });

  const demoProcess = await prisma.process.upsert({
    where: { displayCode: DEMO_PROCESS_DISPLAY_CODE },
    create: {
      id: createId(),
      displayCode: DEMO_PROCESS_DISPLAY_CODE,
      name: 'Demo shared process (seed)',
      description:
        'Both seeded users are members (admin owner, auditor editor) for collaboration / realtime testing. Safe to archive or delete later.',
      auditPolicy: createDefaultAuditPolicy() as object,
      createdById: admin.id,
    },
    update: {
      name: 'Demo shared process (seed)',
      description:
        'Both seeded users are members (admin owner, auditor editor) for collaboration / realtime testing. Safe to archive or delete later.',
    },
  });

  await prisma.processMember.upsert({
    where: { processId_userId: { processId: demoProcess.id, userId: admin.id } },
    create: {
      id: createId(),
      displayCode: `MBR-SEED-${DEMO_PROCESS_DISPLAY_CODE}-ADM`,
      processId: demoProcess.id,
      userId: admin.id,
      permission: 'owner',
      addedById: admin.id,
    },
    update: { permission: 'owner', addedById: admin.id },
  });

  await prisma.processMember.upsert({
    where: { processId_userId: { processId: demoProcess.id, userId: auditor.id } },
    create: {
      id: createId(),
      displayCode: `MBR-SEED-${DEMO_PROCESS_DISPLAY_CODE}-AUD`,
      processId: demoProcess.id,
      userId: auditor.id,
      permission: 'editor',
      addedById: admin.id,
    },
    update: { permission: 'editor', addedById: admin.id },
  });
}

main()
  .finally(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });

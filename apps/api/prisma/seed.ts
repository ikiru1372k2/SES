import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { config as loadEnv } from 'dotenv';
import { PrismaClient } from '@prisma/client';
import { AUDIT_RULE_CATALOG } from '@ses/domain';
import { createId } from '@ses/domain';

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

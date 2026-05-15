import { BadRequestException, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { AUDIT_RULE_CATALOG, isFunctionId, type FunctionId } from '@ses/domain';
import { createId } from '@ses/domain';
import { PrismaService } from '../../common/prisma.service';

@Injectable()
export class RulesService implements OnModuleInit {
  private readonly logger = new Logger(RulesService.name);

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit(): Promise<void> {
    await this.syncCatalog();
  }

  async syncCatalog(): Promise<void> {
    for (const rule of AUDIT_RULE_CATALOG) {
      const functionId = (rule.functionId ?? 'over-planning') as FunctionId;
      await this.prisma.auditRule.upsert({
        where: { ruleCode: rule.ruleCode },
        update: {
          functionId,
          name: rule.name,
          category: rule.category,
          description: rule.description,
          defaultSeverity: rule.defaultSeverity,
          isEnabledDefault: rule.isEnabledDefault,
          paramsSchema: rule.paramsSchema as object,
          version: rule.version,
        },
        create: {
          id: createId(),
          ruleCode: rule.ruleCode,
          functionId,
          name: rule.name,
          category: rule.category,
          description: rule.description,
          defaultSeverity: rule.defaultSeverity,
          isEnabledDefault: rule.isEnabledDefault,
          paramsSchema: rule.paramsSchema as object,
          version: rule.version,
        },
      });
    }
    this.logger.log(`Synced ${AUDIT_RULE_CATALOG.length} audit rules`);
  }

  async list(functionId?: string) {
    const where = functionId && isFunctionId(functionId) ? { functionId } : {};
    const rules = await this.prisma.auditRule.findMany({ where, orderBy: { ruleCode: 'asc' } });
    if (rules.length) return rules;
    return AUDIT_RULE_CATALOG
      .filter((rule) => !functionId || rule.functionId === functionId)
      .map((rule) => ({
        id: rule.ruleCode,
        ruleCode: rule.ruleCode,
        functionId: (rule.functionId ?? 'over-planning') as FunctionId,
        name: rule.name,
        category: rule.category,
        description: rule.description,
        defaultSeverity: rule.defaultSeverity,
        isEnabledDefault: rule.isEnabledDefault,
        paramsSchema: rule.paramsSchema,
        version: rule.version,
        createdAt: new Date(),
      }));
  }

  async get(ruleCode: string) {
    if (!/^[A-Za-z0-9._-]{1,80}$/.test(ruleCode)) {
      throw new BadRequestException('Invalid rule code');
    }
    return this.prisma.auditRule.findUniqueOrThrow({ where: { ruleCode } });
  }
}

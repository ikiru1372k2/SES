import { BadRequestException, Injectable } from '@nestjs/common';
import { AUDIT_RULE_CATALOG } from '@ses/domain';
import { PrismaService } from './common/prisma.service';

@Injectable()
export class RulesService {
  constructor(private readonly prisma: PrismaService) {}

  async list() {
    const rules = await this.prisma.auditRule.findMany({ orderBy: { ruleCode: 'asc' } });
    if (rules.length) return rules;
    return AUDIT_RULE_CATALOG.map((rule) => ({
      id: rule.ruleCode,
      ruleCode: rule.ruleCode,
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

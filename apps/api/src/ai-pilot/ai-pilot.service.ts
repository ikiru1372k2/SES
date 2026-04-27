import { Injectable, Logger } from '@nestjs/common';
import { PROMPT_EXAMPLES } from '@ses/domain';
import type { AiRuleSpec, FunctionId, IssueCategory, Severity } from '@ses/domain';
import { PrismaService } from '../common/prisma.service';
import { AiClientService } from './ai-client.service';

@Injectable()
export class AiPilotService {
  private readonly logger = new Logger(AiPilotService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly aiClient: AiClientService,
  ) {}

  async health() {
    return this.aiClient.health();
  }

  getPromptExamples(functionId: FunctionId): string[] {
    return PROMPT_EXAMPLES[functionId] ?? [];
  }

  /** Called by the audit runner to load active specs for a given engine. */
  async loadActiveSpecs(functionId: string): Promise<AiRuleSpec[]> {
    try {
      const rows = await this.prisma.auditRule.findMany({
        where: { functionId, source: 'ai-pilot', status: 'active' },
        include: { aiMeta: true },
      });
      const specs: AiRuleSpec[] = [];
      for (const row of rows) {
        if (!row.aiMeta) continue;
        specs.push({
          ruleCode: row.ruleCode,
          ruleVersion: row.version,
          functionId: row.functionId as FunctionId,
          name: row.name,
          category: row.category as IssueCategory,
          severity: row.defaultSeverity as Severity,
          flagMessage: row.aiMeta.flagMessage,
          logic: row.aiMeta.logic as AiRuleSpec['logic'],
        });
      }
      return specs;
    } catch (err) {
      this.logger.error(
        `loadActiveSpecs(${functionId}) failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return [];
    }
  }
}

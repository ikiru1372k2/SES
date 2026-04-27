import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ulid } from 'ulid';
import { validateSpec } from '@ses/domain';
import type {
  AiRuleSpec,
  FunctionId,
  IssueCategory,
  Severity,
  SessionUser,
} from '@ses/domain';
import { PrismaService } from '../common/prisma.service';
import { requireOwnedSession } from './ai-pilot-session.helpers';

type SerializableRule = {
  ruleCode: string;
  name: string;
  category: string;
  description: string;
  defaultSeverity: string;
  version: number;
  source: string;
  status: string;
  functionId: string;
  createdAt: Date;
  aiMeta: {
    description: string;
    logic: unknown;
    flagMessage: string;
    sourcePrompt: string;
    authoredBy?: { displayName: string; email: string } | null;
    createdAt: Date;
    updatedAt: Date;
  } | null;
};

@Injectable()
export class AiPilotRulesService {
  private readonly logger = new Logger(AiPilotRulesService.name);

  constructor(private readonly prisma: PrismaService) {}

  async listRulesForFunction(functionId: FunctionId) {
    const rows = await this.prisma.auditRule.findMany({
      where: { functionId, source: 'ai-pilot' },
      include: { aiMeta: { include: { authoredBy: { select: { displayName: true, email: true } } } } },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((r) => this.serializeRule(r));
  }

  async getRule(ruleCode: string) {
    const row = await this.prisma.auditRule.findUnique({
      where: { ruleCode },
      include: { aiMeta: { include: { authoredBy: { select: { displayName: true, email: true } } } } },
    });
    if (!row || row.source !== 'ai-pilot') throw new NotFoundException(`AI rule ${ruleCode} not found`);
    return this.serializeRule(row);
  }

  async setStatus(user: SessionUser, ruleCode: string, status: 'active' | 'paused' | 'archived') {
    const existing = await this.prisma.auditRule.findUnique({ where: { ruleCode } });
    if (!existing || existing.source !== 'ai-pilot') throw new NotFoundException(`AI rule ${ruleCode} not found`);
    const updated = await this.prisma.auditRule.update({ where: { ruleCode }, data: { status } });
    await this.log(
      user.id,
      `rule.${status === 'paused' ? 'pause' : status === 'active' ? 'resume' : 'archive'}`,
      ruleCode,
      { previousStatus: existing.status },
    );
    return { ruleCode, status: updated.status };
  }

  async saveRule(
    user: SessionUser,
    specInput: unknown,
    sandboxSessionId: string,
    previewedAt: string,
  ) {
    if (!previewedAt) throw new BadRequestException('previewedAt is required (preview must run before save)');
    const session = await requireOwnedSession(this.prisma, user, sandboxSessionId);

    const validation = validateSpec(specInput);
    if (!validation.ok) throw new BadRequestException(`Invalid spec: ${validation.error}`);
    const spec = validation.spec;
    if (spec.functionId !== session.functionId) throw new BadRequestException('functionId mismatch');

    const newRuleCode = spec.ruleCode.startsWith('ai_') ? spec.ruleCode : `ai_${ulid().toLowerCase()}`;

    const persisted = await this.prisma.$transaction(async (tx) => {
      const auditRule = await tx.auditRule.create({
        data: {
          id: ulid(),
          ruleCode: newRuleCode,
          functionId: spec.functionId,
          name: spec.name,
          category: spec.category,
          description: spec.flagMessage,
          defaultSeverity: spec.severity,
          isEnabledDefault: true,
          paramsSchema: {},
          version: spec.ruleVersion,
          source: 'ai-pilot',
          status: 'active',
        },
      });
      const meta = await tx.aiPilotRuleMeta.create({
        data: {
          id: ulid(),
          ruleCode: newRuleCode,
          description: spec.flagMessage,
          logic: spec.logic as object,
          flagMessage: spec.flagMessage,
          authoredById: user.id,
          sourcePrompt: '',
          sourceSessionId: session.id,
        },
      });
      return { auditRule, meta };
    });

    await this.log(user.id, 'rule.save', newRuleCode, {
      sessionId: session.id,
      previewedAt,
      severity: spec.severity,
      category: spec.category,
    });

    return this.serializeRule({
      ...persisted.auditRule,
      aiMeta: {
        ...persisted.meta,
        authoredBy: { displayName: user.displayName, email: user.email },
      },
    });
  }

  async listAuditLog(opts: { ruleCode?: string; actorId?: string; limit?: number }) {
    return this.prisma.aiPilotAuditLog.findMany({
      where: {
        ...(opts.ruleCode ? { ruleCode: opts.ruleCode } : {}),
        ...(opts.actorId ? { actorId: opts.actorId } : {}),
      },
      include: { actor: { select: { displayName: true, email: true } } },
      orderBy: { createdAt: 'desc' },
      take: Math.min(opts.limit ?? 50, 200),
    });
  }

  async getWelcomeState(user: SessionUser) {
    const pref = await this.prisma.userPreference.findUnique({
      where: { userId: user.id },
      select: { data: true },
    });
    const data = (pref?.data ?? {}) as Record<string, unknown>;
    return { aiPilotWelcomeDismissed: data.aiPilotWelcomeDismissed === true };
  }

  async dismissWelcome(user: SessionUser) {
    const pref = await this.prisma.userPreference.findUnique({ where: { userId: user.id } });
    const data = ((pref?.data as Record<string, unknown> | null) ?? {});
    const next = { ...data, aiPilotWelcomeDismissed: true };
    if (pref) {
      await this.prisma.userPreference.update({ where: { userId: user.id }, data: { data: next } });
    } else {
      await this.prisma.userPreference.create({ data: { id: ulid(), userId: user.id, data: next } });
    }
    return { aiPilotWelcomeDismissed: true };
  }

  private async log(actorId: string, action: string, ruleCode: string | null, payload: unknown) {
    try {
      await this.prisma.aiPilotAuditLog.create({
        data: { id: ulid(), actorId, action, ruleCode, payload: payload as object },
      });
    } catch (err) {
      this.logger.warn(`audit log failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private serializeRule(row: SerializableRule) {
    return {
      ruleCode: row.ruleCode,
      name: row.name,
      functionId: row.functionId,
      category: row.category,
      severity: row.defaultSeverity,
      status: row.status,
      version: row.version,
      createdAt: row.createdAt.toISOString(),
      aiMeta: row.aiMeta
        ? {
            description: row.aiMeta.description,
            flagMessage: row.aiMeta.flagMessage,
            logic: row.aiMeta.logic,
            authoredBy: row.aiMeta.authoredBy ?? null,
            createdAt: row.aiMeta.createdAt.toISOString(),
            updatedAt: row.aiMeta.updatedAt.toISOString(),
          }
        : null,
    };
  }
}

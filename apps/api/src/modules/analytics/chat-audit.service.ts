import { Injectable, Logger } from '@nestjs/common';
import { PgService } from '../../db/pg.service';

interface AppendInput {
  userId: string;
  processCode: string;
  functionId: string | null;
  versionRef: string | null;
  question: string;
  generatedSql?: string | null;
  toolCalls?: unknown[];
  resultHash?: string | null;
  finalAnswer: string;
  chartSpec: unknown;
  modelName: string | null;
  modelDigest: string | null;
  latencyMs: number;
}

@Injectable()
export class ChatAuditService {
  private readonly logger = new Logger(ChatAuditService.name);

  constructor(private readonly pg: PgService) {}

  async append(input: AppendInput): Promise<void> {
    try {
      await this.pg.query(
        `INSERT INTO ai_chat_audit
          (user_id, process_code, function_id, version_ref, question,
           generated_sql, tool_calls, result_hash, final_answer, chart_spec,
           model_name, model_digest, latency_ms)
         VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10::jsonb,$11,$12,$13)`,
        [
          input.userId,
          input.processCode,
          input.functionId,
          input.versionRef,
          input.question,
          input.generatedSql ?? null,
          JSON.stringify(input.toolCalls ?? []),
          input.resultHash ?? null,
          input.finalAnswer,
          input.chartSpec === null || input.chartSpec === undefined
            ? null
            : JSON.stringify(input.chartSpec),
          input.modelName,
          input.modelDigest,
          input.latencyMs,
        ],
      );
    } catch (err) {
      this.logger.error(`ai_chat_audit append failed: ${(err as Error).message}`);
    }
  }

  async recent(processCode: string, functionId: string | undefined, limit = 50) {
    const rows = await this.pg.query<{
      id: string;
      question: string;
      final_answer: string;
      chart_spec: unknown;
      created_at: Date;
      model_name: string | null;
      latency_ms: number | null;
    }>(
      `SELECT id, question, final_answer, chart_spec, created_at, model_name, latency_ms
         FROM ai_chat_audit
        WHERE process_code = $1
          AND ($2::text IS NULL OR function_id = $2)
        ORDER BY created_at DESC
        LIMIT $3`,
      [processCode, functionId ?? null, limit],
    );
    return rows;
  }

  /**
   * F11: retention. ai_chat_audit holds raw prompts + generated SQL +
   * answers, which can be business-confidential. Delete rows older than the
   * configured window (default 90 days) so the table doesn't retain
   * sensitive content indefinitely. Called by AnalyticsRetentionCron.
   */
  async purgeOlderThan(retentionDays: number): Promise<number> {
    const days = Number.isFinite(retentionDays) && retentionDays > 0 ? Math.floor(retentionDays) : 90;
    const rows = await this.pg.query<{ deleted: number }>(
      `WITH del AS (
         DELETE FROM ai_chat_audit
          WHERE created_at < now() - ($1 || ' days')::interval
         RETURNING 1
       )
       SELECT COUNT(*)::int AS deleted FROM del`,
      [String(days)],
    );
    return rows[0]?.deleted ?? 0;
  }
}

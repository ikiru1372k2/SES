import { Injectable, Logger } from '@nestjs/common';
import { PgService } from '../../db/pg.service';

export interface PinnedChartRow {
  id: string;
  title: string;
  question: string | null;
  functionId: string | null;
  chartSpec: unknown;
  position: number;
  createdAt: string;
}

interface PinInput {
  userId: string;
  processCode: string;
  functionId: string | null;
  title: string;
  question: string | null;
  chartSpec: unknown;
}

/**
 * Persistence for the analytics "Pinned workbench". One row per chart a user
 * pinned from a chat answer. Per (process_code, user_id) — the workbench is
 * the auditor's own pinned set, not shared. Mirrors ChatAuditService's
 * PgService usage (parameterised SQL, jsonb casts).
 */
@Injectable()
export class PinnedChartsService {
  private readonly logger = new Logger(PinnedChartsService.name);

  constructor(private readonly pg: PgService) {}

  async list(userId: string, processCode: string): Promise<PinnedChartRow[]> {
    const rows = await this.pg.query<{
      id: string;
      title: string;
      question: string | null;
      function_id: string | null;
      chart_spec: unknown;
      position: number;
      created_at: Date;
    }>(
      `SELECT id, title, question, function_id, chart_spec, position, created_at
         FROM pinned_analytics_charts
        WHERE process_code = $1 AND user_id = $2
        ORDER BY position ASC, created_at ASC`,
      [processCode, userId],
    );
    return rows.map((r) => ({
      id: String(r.id),
      title: r.title,
      question: r.question,
      functionId: r.function_id,
      chartSpec: r.chart_spec,
      position: r.position,
      createdAt: new Date(r.created_at).toISOString(),
    }));
  }

  async pin(input: PinInput): Promise<PinnedChartRow> {
    // New pins go to the end of the user's workbench for this process.
    // The aggregate always yields exactly one row (COALESCE handles empty).
    const { next_pos } = await this.pg.one<{ next_pos: number }>(
      `SELECT COALESCE(MAX(position), -1) + 1 AS next_pos
         FROM pinned_analytics_charts
        WHERE process_code = $1 AND user_id = $2`,
      [input.processCode, input.userId],
    );
    const row = await this.pg.one<{
      id: string;
      title: string;
      question: string | null;
      function_id: string | null;
      chart_spec: unknown;
      position: number;
      created_at: Date;
    }>(
      `INSERT INTO pinned_analytics_charts
         (user_id, process_code, function_id, title, question, chart_spec, position)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7)
       RETURNING id, title, question, function_id, chart_spec, position, created_at`,
      [
        input.userId,
        input.processCode,
        input.functionId,
        input.title,
        input.question,
        JSON.stringify(input.chartSpec),
        next_pos ?? 0,
      ],
    );
    return {
      id: String(row.id),
      title: row.title,
      question: row.question,
      functionId: row.function_id,
      chartSpec: row.chart_spec,
      position: row.position,
      createdAt: new Date(row.created_at).toISOString(),
    };
  }

  async unpin(userId: string, processCode: string, id: string): Promise<void> {
    await this.pg.query(
      `DELETE FROM pinned_analytics_charts
        WHERE id = $1 AND process_code = $2 AND user_id = $3`,
      [id, processCode, userId],
    );
  }

  /**
   * Persist a manual drag-reorder. `orderedIds` is the full list of this
   * user's pin ids for the process in the desired top-first order; positions
   * are rewritten in one transaction so a partial failure can't scramble the
   * workbench. Ids not belonging to (user, process) are ignored.
   */
  async reorder(userId: string, processCode: string, orderedIds: string[]): Promise<void> {
    if (orderedIds.length === 0) return;
    await this.pg.tx(async (client) => {
      for (let i = 0; i < orderedIds.length; i += 1) {
        await client.query(
          `UPDATE pinned_analytics_charts
              SET position = $1
            WHERE id = $2 AND process_code = $3 AND user_id = $4`,
          [i, orderedIds[i], processCode, userId],
        );
      }
    });
  }
}

-- Pinned analytics charts ("Pinned workbench").
--
-- Each row is one chart a user pinned from the analytics chat answer to the
-- process-level workbench. chart_spec is the same JSON ChartSpec the chat
-- renders, stored verbatim so the workbench re-renders without re-querying
-- the LLM. position drives manual drag-reorder (ascending = top-first).
--
-- Scoped per (process_code, user_id): the workbench is the auditor's own
-- pinned set for that process, not shared (mirrors how chat history is
-- per-user). function_id is nullable for process-level pins.

CREATE TABLE IF NOT EXISTS pinned_analytics_charts (
  id            BIGSERIAL PRIMARY KEY,
  user_id       TEXT NOT NULL,
  process_code  TEXT NOT NULL,
  function_id   TEXT,
  title         TEXT NOT NULL,
  question      TEXT,
  chart_spec    JSONB NOT NULL,
  position      INTEGER NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Workbench read path: all pins for a (process, user), ordered for display.
CREATE INDEX IF NOT EXISTS ix_pinned_charts_scope
  ON pinned_analytics_charts (process_code, user_id, position ASC, created_at ASC);

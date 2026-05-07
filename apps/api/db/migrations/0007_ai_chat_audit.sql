-- AI chat audit log: every analytics chat call writes one row.
-- TODO: partitioning + retention policy deferred to a later phase.
-- Expect heavy growth — auditors are heavy chat users.

CREATE TABLE IF NOT EXISTS ai_chat_audit (
  id            BIGSERIAL PRIMARY KEY,
  user_id       TEXT NOT NULL,
  process_code  TEXT NOT NULL,
  function_id   TEXT,
  version_ref   TEXT,
  question      TEXT NOT NULL,
  generated_sql TEXT,
  tool_calls    JSONB NOT NULL DEFAULT '[]'::jsonb,
  result_hash   TEXT,
  final_answer  TEXT,
  chart_spec    JSONB,
  model_name    TEXT,
  model_digest  TEXT,
  latency_ms    INTEGER,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_ai_chat_audit_scope
  ON ai_chat_audit(process_code, function_id, created_at DESC);

CREATE INDEX IF NOT EXISTS ix_ai_chat_audit_user
  ON ai_chat_audit(user_id, created_at DESC);

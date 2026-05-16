-- F11: ai_chat_audit retention.
--
-- Migration 0007 deferred a retention policy. ai_chat_audit holds raw
-- prompts, LLM-generated SQL, and answers — potentially business-
-- confidential — so it must not grow unbounded / retain content forever.
--
-- Enforcement is application-side: AnalyticsRetentionCron runs daily and
-- deletes rows older than ANALYTICS_AUDIT_RETENTION_DAYS (default 90).
-- The supporting index below keeps that DELETE cheap as the table grows.
--
-- (A time-range partitioning scheme is the longer-term plan for very high
--  volume; the daily purge + this index is sufficient for current scale
--  and is the documented, enforced policy.)

CREATE INDEX IF NOT EXISTS ix_ai_chat_audit_created_at
  ON ai_chat_audit (created_at);

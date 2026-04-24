-- Function-rate engine context: every zero-rate month label for an issue's
-- row (as a JSON array of strings) and the cardinality of that list. Both
-- nullable so rows produced by other engines stay as-is with NULL values.
ALTER TABLE "AuditIssue"
  ADD COLUMN "missingMonths"  JSONB,
  ADD COLUMN "zeroMonthCount" INTEGER;

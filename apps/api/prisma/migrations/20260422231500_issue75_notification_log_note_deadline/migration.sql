-- Issue #75: the auditor's own mail/Teams client now does the send. The
-- server records intent and counts; these two columns capture context that
-- was previously only communicated in the body of the email.
ALTER TABLE "notification_log"
  ADD COLUMN "authorNote" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "deadlineAt" TIMESTAMPTZ NULL;

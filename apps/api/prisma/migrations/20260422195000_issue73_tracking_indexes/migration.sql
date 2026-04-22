-- Issue #73: tighten tracking query performance for SLA + process scoped lookups

CREATE INDEX "TrackingEntry_processId_stage_slaDueAt_idx"
ON "TrackingEntry"("processId", "stage", "slaDueAt");

CREATE INDEX "TrackingEntry_processId_managerEmail_idx"
ON "TrackingEntry"("processId", "managerEmail");

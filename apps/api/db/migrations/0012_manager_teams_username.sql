-- Add a dedicated Teams username column to the manager directory.
-- Nullable, no backfill: existing rows stay NULL and the Teams deep link
-- falls back to the manager email until an admin fills this in.
ALTER TABLE "ManagerDirectory" ADD COLUMN "teamsUsername" TEXT;

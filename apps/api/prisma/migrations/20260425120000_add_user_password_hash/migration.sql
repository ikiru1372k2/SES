-- Add password hash column for email/password authentication.
ALTER TABLE "User" ADD COLUMN "passwordHash" TEXT;

-- AlterTable: per-user opt-out for the Dealcore Daily Brief.
-- Defaults true so existing team members are enrolled on deploy.
-- Table is "users" (model User is @@map'd), not "User".
ALTER TABLE "users" ADD COLUMN "digestEnabled" BOOLEAN NOT NULL DEFAULT true;

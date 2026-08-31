-- Per-campaign sending number for TEXT steps.
-- Nullable with no default, so every existing campaign keeps resolving its
-- number the way it does today (sticky thread, else the org default).
ALTER TABLE "campaigns" ADD COLUMN "fromNumber" TEXT;

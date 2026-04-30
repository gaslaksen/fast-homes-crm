-- ROLLBACK SQL for migration 20260430131255_provider_cleanup_and_batchdata
--
-- This file is NOT applied automatically by Prisma. It exists as documentation
-- and a quick-recovery script if the forward migration ships and breaks prod.
--
-- HOW TO USE:
-- 1. Restore data first if available (pre-migration pg_dump):
--      psql "$DATABASE_URL" < backup-pre-batchdata-<timestamp>.sql
--    The dump contains the original column data. If you don't have a dump,
--    skip this step — the columns come back empty.
--
-- 2. If you only need the schema back (no data restore needed), apply this
--    file directly:
--      psql "$DATABASE_URL" < ROLLBACK.sql
--
-- 3. Then revert the application commit and redeploy so code matches schema:
--      git revert <forward-migration-commit-sha>
--      git push origin master
--
-- 4. Mark the failed migration as rolled-back in Prisma:
--      DELETE FROM "_prisma_migrations" WHERE migration_name =
--        '20260430131255_provider_cleanup_and_batchdata';
--    (Or use `npx prisma migrate resolve --rolled-back ...`)

-- ── Restore dropped Lead columns (empty) ───────────────────────────────────
ALTER TABLE "leads"
  ADD COLUMN IF NOT EXISTS "attomAvmConfidence" DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "attomMortgageData" JSONB,
  ADD COLUMN IF NOT EXISTS "attomSaleHistory" JSONB,
  ADD COLUMN IF NOT EXISTS "avmExcellentLow" DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "avmGoodHigh" DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "avmGoodLow" DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "avmPoorLow" DOUBLE PRECISION;

-- ── Drop the BatchData additions ───────────────────────────────────────────
ALTER TABLE "leads"
  DROP COLUMN IF EXISTS "batchdataLookupData",
  DROP COLUMN IF EXISTS "batchdataLookupFetchedAt",
  DROP COLUMN IF EXISTS "dataProviderConflicts";

-- Note: the DELETE FROM "comps" data step is not reversible without a backup.
-- If those rows matter, restore from the pre-migration pg_dump.

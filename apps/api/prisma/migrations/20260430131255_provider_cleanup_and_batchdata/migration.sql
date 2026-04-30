-- Provider cleanup + BatchData additive fields.
--
-- Drops Lead columns whose only writers were the now-removed RentCast and
-- ATTOM-from-comps code paths. Deal Search still writes attomId,
-- attomEnrichedAt, attomAvm, attomAvmLow, attomAvmHigh, avmPoorHigh,
-- avmExcellentHigh — those columns are intentionally preserved.
--
-- Adds BatchData enrichment columns for the validation-phase build.
--
-- Cleans up Comp rows whose source is no longer a valid provider.

-- ── Drop columns from Lead (no longer written by any code path) ────────────
ALTER TABLE "leads"
  DROP COLUMN IF EXISTS "attomAvmConfidence",
  DROP COLUMN IF EXISTS "attomMortgageData",
  DROP COLUMN IF EXISTS "attomSaleHistory",
  DROP COLUMN IF EXISTS "avmExcellentLow",
  DROP COLUMN IF EXISTS "avmGoodHigh",
  DROP COLUMN IF EXISTS "avmGoodLow",
  DROP COLUMN IF EXISTS "avmPoorLow";

-- ── Add BatchData enrichment columns ───────────────────────────────────────
ALTER TABLE "leads"
  ADD COLUMN "batchdataLookupData" JSONB,
  ADD COLUMN "batchdataLookupFetchedAt" TIMESTAMP(3),
  ADD COLUMN "dataProviderConflicts" JSONB;

-- ── Remove orphan Comp rows from removed providers ─────────────────────────
-- Analysis-linked rows are kept (they're snapshots inside saved CompAnalysis
-- records); only lead-level comps from rentcast/attom go away. A fresh REAPI
-- fetch repopulates.
DELETE FROM "comps"
  WHERE source IN ('rentcast', 'attom')
    AND "analysisId" IS NULL;

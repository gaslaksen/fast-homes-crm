-- Phase D — Deal Math tab consolidation
-- Adds canonical Lead-level fields for strategy, repair estimate, strategy
-- inputs, and computed deal numbers; introduces a new photo_analysis_results
-- table for append-on-reanalyze condition reports.
--
-- Column casing matches the existing Prisma convention in this schema
-- (camelCase, no @map directives on fields). Table names are snake_case via @@map.

ALTER TABLE "leads"
  ADD COLUMN "dispositionStrategy"             TEXT,
  ADD COLUMN "currentRepairEstimate"           DOUBLE PRECISION,
  ADD COLUMN "currentRepairEstimateMethod"     TEXT,
  ADD COLUMN "currentRepairEstimateMetadata"   JSONB,
  ADD COLUMN "currentRepairEstimateUpdatedAt"  TIMESTAMP(3),
  ADD COLUMN "dealMathInputs"                  JSONB DEFAULT '{}'::jsonb,
  ADD COLUMN "currentDealNumbers"              JSONB,
  ADD COLUMN "currentDealNumbersUpdatedAt"     TIMESTAMP(3);

CREATE TABLE "photo_analysis_results" (
  "id"              TEXT PRIMARY KEY,
  "leadId"          TEXT NOT NULL,
  "resultJson"      JSONB NOT NULL,
  "rangeLow"        DOUBLE PRECISION,
  "rangeHigh"       DOUBLE PRECISION,
  "midpoint"        DOUBLE PRECISION,
  "photosAnalyzed"  INTEGER,
  "analyzedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "photo_analysis_results_leadId_fkey"
    FOREIGN KEY ("leadId") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "photo_analysis_results_leadId_analyzedAt_idx"
  ON "photo_analysis_results" ("leadId", "analyzedAt" DESC);

-- ── Backfill ────────────────────────────────────────────────────────────────
-- 1) currentRepairEstimate from the most recent CompAnalysis row per lead.
--    Method inference: photo midpoint match → PHOTO_ANALYSIS, else
--    repairFinishLevel set → MANUAL_BUILDER, else MANUAL_OVERRIDE.
WITH latest_ca AS (
  SELECT DISTINCT ON ("leadId")
    "leadId",
    "repairCosts",
    "repairFinishLevel",
    "repairItems",
    "repairNotes",
    "photoAnalysis",
    "photoRepairLow",
    "photoRepairHigh",
    "updatedAt"
  FROM "comp_analyses"
  WHERE "repairCosts" IS NOT NULL
  ORDER BY "leadId", "updatedAt" DESC
)
UPDATE "leads" l
SET
  "currentRepairEstimate" = lc."repairCosts",
  "currentRepairEstimateMethod" = CASE
    WHEN lc."photoAnalysis" IS NOT NULL
      AND lc."photoRepairLow" IS NOT NULL
      AND lc."photoRepairHigh" IS NOT NULL
      AND lc."repairCosts" = ((lc."photoRepairLow" + lc."photoRepairHigh") / 2.0)
        THEN 'PHOTO_ANALYSIS'
    WHEN lc."repairFinishLevel" IS NOT NULL THEN 'MANUAL_BUILDER'
    ELSE 'MANUAL_OVERRIDE'
  END,
  "currentRepairEstimateMetadata" = jsonb_strip_nulls(jsonb_build_object(
    'finishLevel', lc."repairFinishLevel",
    'items',       lc."repairItems",
    'notes',       lc."repairNotes",
    'rangeLow',    lc."photoRepairLow",
    'rangeHigh',   lc."photoRepairHigh"
  )),
  "currentRepairEstimateUpdatedAt" = lc."updatedAt"
FROM latest_ca lc
WHERE lc."leadId" = l."id";

-- 2) dispositionStrategy from Contract.exitStrategy (preferred) or
--    DispositionPlan.exitStrategy (fallback).
UPDATE "leads" l
SET "dispositionStrategy" = COALESCE(
  (SELECT "exitStrategy" FROM "contracts"
    WHERE "leadId" = l."id"
    ORDER BY "createdAt" DESC
    LIMIT 1),
  (SELECT "exitStrategy" FROM "disposition_plans"
    WHERE "leadId" = l."id"
    ORDER BY "createdAt" DESC
    LIMIT 1)
)
WHERE "dispositionStrategy" IS NULL;

-- 3) Backfill photo_analysis_results from existing CompAnalysis.photoAnalysis
--    so the drawer has historical data on first load. One row per CompAnalysis
--    that has a photoAnalysis blob.
INSERT INTO "photo_analysis_results"
  ("id", "leadId", "resultJson", "rangeLow", "rangeHigh", "midpoint",
   "photosAnalyzed", "analyzedAt")
SELECT
  ca."id" || '_phase_d_backfill',
  ca."leadId",
  ca."photoAnalysis"::jsonb,
  ca."photoRepairLow"::double precision,
  ca."photoRepairHigh"::double precision,
  CASE
    WHEN ca."photoRepairLow" IS NOT NULL AND ca."photoRepairHigh" IS NOT NULL
      THEN (ca."photoRepairLow" + ca."photoRepairHigh") / 2.0
    ELSE NULL
  END,
  NULL,
  ca."updatedAt"
FROM "comp_analyses" ca
WHERE ca."photoAnalysis" IS NOT NULL
  AND ca."photoAnalysis" <> ''
  -- Tolerate any rows where photoAnalysis isn't valid JSON; only attempt
  -- rows whose text starts with `{` or `[` after optional whitespace.
  AND ca."photoAnalysis" ~ '^\s*[{\[]'
ON CONFLICT DO NOTHING;

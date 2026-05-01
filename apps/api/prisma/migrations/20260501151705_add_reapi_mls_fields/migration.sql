-- REAPI MLS add-on enrichment fields.
--
-- Trial access to REAPI's MLS add-on (v2/MLSDetail + v2/MLSSearch) was granted
-- 2026-05-01. These columns store the per-lead MLS data captured by
-- ReapiService.enrichLead → getMlsDetail and surfaced in the Lead Overview's
-- "MLS Listing History" card.
--
-- All columns are nullable — leads in non-MLS-covered areas, off-market
-- properties, and properties where the trial key fails will simply leave them
-- empty. No backfill needed.

ALTER TABLE "leads"
  ADD COLUMN "reapiMlsListingId"     TEXT,
  ADD COLUMN "reapiMlsNumber"        TEXT,
  ADD COLUMN "reapiMlsStatus"        TEXT,
  ADD COLUMN "reapiMlsListPrice"     DOUBLE PRECISION,
  ADD COLUMN "reapiMlsSoldPrice"     DOUBLE PRECISION,
  ADD COLUMN "reapiMlsListDate"      TIMESTAMP(3),
  ADD COLUMN "reapiMlsSoldDate"      TIMESTAMP(3),
  ADD COLUMN "reapiMlsDaysOnMarket"  INTEGER,
  ADD COLUMN "reapiMlsHistory"       JSONB,
  ADD COLUMN "reapiMlsPhotos"        JSONB,
  ADD COLUMN "reapiMlsAgent"         JSONB,
  ADD COLUMN "reapiMlsRemarks"       TEXT;

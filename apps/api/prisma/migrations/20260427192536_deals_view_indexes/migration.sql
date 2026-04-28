-- Indexes to support the /deals portfolio view.
-- - profitBucket+status: drives summary aggregations and bucket filter
-- - soldDate: drives the Realized time-period filter and sort
-- - stageChangedAt: drives the Days-in-Phase sort

CREATE INDEX IF NOT EXISTS "leads_organizationId_profitBucket_status_idx"
  ON "leads"("organizationId", "profitBucket", "status");

CREATE INDEX IF NOT EXISTS "leads_organizationId_soldDate_idx"
  ON "leads"("organizationId", "soldDate");

CREATE INDEX IF NOT EXISTS "leads_organizationId_stageChangedAt_idx"
  ON "leads"("organizationId", "stageChangedAt");

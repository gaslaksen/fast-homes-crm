-- AlterTable
ALTER TABLE "leads" ADD COLUMN "dealPencils" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "leads_organizationId_tier_idx" ON "leads"("organizationId", "tier");

-- CreateIndex
CREATE INDEX "leads_organizationId_status_idx" ON "leads"("organizationId", "status");

-- CreateIndex
CREATE INDEX "leads_organizationId_totalScore_idx" ON "leads"("organizationId", "totalScore");

-- CreateIndex
CREATE INDEX "leads_organizationId_createdAt_idx" ON "leads"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "leads_organizationId_lastTouchedAt_idx" ON "leads"("organizationId", "lastTouchedAt");

-- CreateIndex
CREATE INDEX "leads_organizationId_propertyState_idx" ON "leads"("organizationId", "propertyState");

-- CreateIndex
CREATE INDEX "leads_organizationId_scoreBand_idx" ON "leads"("organizationId", "scoreBand");

-- CreateIndex
CREATE INDEX "leads_organizationId_source_idx" ON "leads"("organizationId", "source");

-- Backfill dealPencils for existing leads
UPDATE "leads" SET "dealPencils" = true
WHERE "arv" IS NOT NULL AND "askingPrice" IS NOT NULL AND ("arv" * 0.7 - 55000) >= "askingPrice";

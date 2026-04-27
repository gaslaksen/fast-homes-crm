-- Disposition v2: post-acquisition tracking columns on leads.
-- All nullable / defaulted; existing rows unaffected.
ALTER TABLE "leads" ADD COLUMN "acquiredDate" TIMESTAMP(3);
ALTER TABLE "leads" ADD COLUMN "soldDate" TIMESTAMP(3);
ALTER TABLE "leads" ADD COLUMN "realizedProfit" DOUBLE PRECISION;
ALTER TABLE "leads" ADD COLUMN "profitBucket" TEXT DEFAULT 'potential';
ALTER TABLE "leads" ADD COLUMN "targetSalePrice" DOUBLE PRECISION;

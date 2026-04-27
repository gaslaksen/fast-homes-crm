-- Disposition v2: extend contracts with acquisition fields and link to accepted Offer.
ALTER TABLE "contracts" ADD COLUMN "acceptedOfferId" TEXT;
ALTER TABLE "contracts" ADD COLUMN "acquisitionClosingCosts" DOUBLE PRECISION;
ALTER TABLE "contracts" ADD COLUMN "fundingSource" TEXT;
ALTER TABLE "contracts" ADD COLUMN "acquiredAt" TIMESTAMP(3);

-- Idempotent backfill: link each Contract to the most recent accepted Offer
-- on the same lead (if any). Picks the newest by createdAt to avoid arbitrary
-- order if multiple offers were ever marked accepted.
UPDATE "contracts" c
SET "acceptedOfferId" = sub.id
FROM (
  SELECT DISTINCT ON ("leadId") id, "leadId"
  FROM "offers"
  WHERE status = 'accepted'
  ORDER BY "leadId", "createdAt" DESC
) sub
WHERE c."leadId" = sub."leadId"
  AND c."acceptedOfferId" IS NULL;

-- Unique + FK constraint must be added AFTER backfill so duplicates would fail loudly.
CREATE UNIQUE INDEX "contracts_acceptedOfferId_key" ON "contracts"("acceptedOfferId");
ALTER TABLE "contracts"
  ADD CONSTRAINT "contracts_acceptedOfferId_fkey"
  FOREIGN KEY ("acceptedOfferId") REFERENCES "offers"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- When we last told the claimant anything, for the monthly-update cadence.
ALTER TABLE "surplus_details" ADD COLUMN "lastClaimantUpdateAt" TIMESTAMP(3);

-- A people search can say the claimant is dead. Until 2026-09-14 the trace
-- parsed Endato's death record from a field the response does not carry, so
-- every death Endato reported was dropped and deceased claimants were put in
-- Call now. These columns record the date and where it came from, and when a
-- claimant's identity was last checked for a death record.
ALTER TABLE "surplus_details" ADD COLUMN "dateOfDeath" TIMESTAMP(3);
ALTER TABLE "surplus_details" ADD COLUMN "deathSource" TEXT;
ALTER TABLE "surplus_details" ADD COLUMN "deathCheckedAt" TIMESTAMP(3);

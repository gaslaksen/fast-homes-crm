-- The name-first skip trace (Endato) stamps every claimant it has searched,
-- hit or miss, so a re-run skips the misses instead of paying for them again.
-- The 2026-09-12 uncapped runs repeated about 58 of the previous day's
-- capped searches for exactly this lack.
ALTER TABLE "surplus_details" ADD COLUMN "nameSearchedAt" TIMESTAMP(3);

-- Backfill from the trace log, which recorded every Endato search that ran
-- before the stamp existed. Without this the next run would re-buy all 736
-- of the searches made on 11 and 12 September.
UPDATE "surplus_details" d
SET "nameSearchedAt" = a."last"
FROM (
  SELECT "surplusDetailId", MAX("ranAt") AS "last"
  FROM "surplus_trace_attempts"
  WHERE "source" = 'endato'
  GROUP BY "surplusDetailId"
) a
WHERE a."surplusDetailId" = d."id";

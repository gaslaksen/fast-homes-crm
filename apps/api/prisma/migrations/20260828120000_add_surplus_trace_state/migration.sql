-- Per-claimant skip trace state.
--
-- Until now the only record of a trace was a sentence appended to callNotes, so
-- "never traced" and "traced and found nothing" looked identical in the UI. On
-- a board of 75 claimants where the nightly poll never traces at all, that read
-- as a system failure. These three columns make the attempt itself a fact.
ALTER TABLE "surplus_details" ADD COLUMN "tracedAt" TIMESTAMP(3);
ALTER TABLE "surplus_details" ADD COLUMN "traceOutcome" TEXT;
ALTER TABLE "surplus_details" ADD COLUMN "traceDetail" TEXT;

-- Backfill from the notes the trace service already writes, so the rows traced
-- by hand before this migration do not show as never attempted. Deliberately
-- conservative: only rows carrying a trace sentence are touched, and the
-- timestamp is the row's own updatedAt rather than a guess.
UPDATE "surplus_details"
SET "traceOutcome" = CASE
      WHEN "contactMismatch" = true THEN 'mismatch'
      WHEN "callNotes" LIKE '%Skip trace returned no matched person%' THEN 'no_person'
      WHEN "callNotes" LIKE '%but returned no phone or email%' THEN 'no_contact'
      WHEN "callNotes" LIKE '%Skip trace matched%' THEN 'matched'
      ELSE 'unverified'
    END,
    "tracedAt" = "updatedAt"
WHERE "callNotes" LIKE '%Skip trace%';

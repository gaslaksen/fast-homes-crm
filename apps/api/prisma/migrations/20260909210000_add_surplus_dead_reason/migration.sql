-- Why a surplus claim was retired. Required to enter Dead from here on;
-- claims already Dead are backfilled as "other" with a note so the rule
-- holds for every row.
ALTER TABLE "surplus_details" ADD COLUMN "deadReason" TEXT;
ALTER TABLE "surplus_details" ADD COLUMN "deadNote" TEXT;
ALTER TABLE "surplus_details" ADD COLUMN "deadAt" TIMESTAMP(3);

UPDATE "surplus_details"
SET "deadReason" = 'other',
    "deadNote" = 'Marked dead before reasons were recorded',
    "deadAt" = "updatedAt"
WHERE "stage" = 'Dead' AND "deadReason" IS NULL;

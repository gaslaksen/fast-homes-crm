-- Per-number DNC flags on surplus leads, plus a record of a skip trace
-- that came back with the wrong person. Additive only.

ALTER TABLE "surplus_details" ADD COLUMN "phone1Dnc" TEXT;
ALTER TABLE "surplus_details" ADD COLUMN "phone2Dnc" TEXT;
ALTER TABLE "surplus_details" ADD COLUMN "phone3Dnc" TEXT;
ALTER TABLE "surplus_details" ADD COLUMN "phone4Dnc" TEXT;
ALTER TABLE "surplus_details" ADD COLUMN "dncScrubbedAt" TIMESTAMP(3);
ALTER TABLE "surplus_details" ADD COLUMN "contactMismatch" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "surplus_details" ADD COLUMN "mismatchedName" TEXT;

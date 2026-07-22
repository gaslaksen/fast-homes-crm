-- AlterTable: per-card tracking fields for the Foreclosures tab
ALTER TABLE "foreclosure_details" ADD COLUMN "callNotes" TEXT;
ALTER TABLE "foreclosure_details" ADD COLUMN "touchDays" JSONB;
ALTER TABLE "foreclosure_details" ADD COLUMN "touchWeek" TEXT;
ALTER TABLE "foreclosure_details" ADD COLUMN "touchCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "foreclosure_details" ADD COLUMN "phone1Type" TEXT;
ALTER TABLE "foreclosure_details" ADD COLUMN "phone2Type" TEXT;

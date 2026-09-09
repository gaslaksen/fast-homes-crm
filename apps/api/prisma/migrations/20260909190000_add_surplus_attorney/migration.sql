-- The attorney on a surplus claim, where the county requires one. Once
-- engaged, all county and court contact goes through them.
ALTER TABLE "surplus_details" ADD COLUMN "attorneyRequired" BOOLEAN;
ALTER TABLE "surplus_details" ADD COLUMN "attorneyName" TEXT;
ALTER TABLE "surplus_details" ADD COLUMN "attorneyFirm" TEXT;
ALTER TABLE "surplus_details" ADD COLUMN "attorneyPhone" TEXT;
ALTER TABLE "surplus_details" ADD COLUMN "attorneyEmail" TEXT;
ALTER TABLE "surplus_details" ADD COLUMN "attorneySource" TEXT;
ALTER TABLE "surplus_details" ADD COLUMN "attorneyEngagedAt" TIMESTAMP(3);
ALTER TABLE "surplus_details" ADD COLUMN "attorneyNotes" TEXT;

-- AlterTable: up to 4 phones + 2 emails per foreclosure lead
ALTER TABLE "foreclosure_details" ADD COLUMN "phone3" TEXT;
ALTER TABLE "foreclosure_details" ADD COLUMN "phone4" TEXT;
ALTER TABLE "foreclosure_details" ADD COLUMN "phone3Type" TEXT;
ALTER TABLE "foreclosure_details" ADD COLUMN "phone4Type" TEXT;
ALTER TABLE "foreclosure_details" ADD COLUMN "email2" TEXT;

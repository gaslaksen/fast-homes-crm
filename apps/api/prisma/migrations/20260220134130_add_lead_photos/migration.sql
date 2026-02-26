-- AlterTable
ALTER TABLE "leads" ADD COLUMN     "photos" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "primaryPhoto" TEXT;

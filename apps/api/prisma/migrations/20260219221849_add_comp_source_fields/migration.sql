-- AlterTable
ALTER TABLE "comps" ADD COLUMN     "correlation" DOUBLE PRECISION,
ADD COLUMN     "features" JSONB,
ADD COLUMN     "latitude" DOUBLE PRECISION,
ADD COLUMN     "longitude" DOUBLE PRECISION,
ADD COLUMN     "source" TEXT NOT NULL DEFAULT 'manual';

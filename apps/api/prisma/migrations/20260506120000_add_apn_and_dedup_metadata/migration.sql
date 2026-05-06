-- AlterTable
ALTER TABLE "comps" ADD COLUMN "apn" TEXT;

-- AlterTable
ALTER TABLE "ai_comp_curations" ADD COLUMN "rawCandidateCount" INTEGER;
ALTER TABLE "ai_comp_curations" ADD COLUMN "uniqueCandidateCount" INTEGER;
ALTER TABLE "ai_comp_curations" ADD COLUMN "dedupMetadata" JSONB;

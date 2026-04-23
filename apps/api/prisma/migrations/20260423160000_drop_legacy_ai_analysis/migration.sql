-- Drop the legacy lead-attached AI Analysis columns. Replaced by aiInsight (cached one-line summary).
-- aiRecommendation is kept (separate next-action recommendation populated by pipeline.service).
ALTER TABLE "leads" DROP COLUMN IF EXISTS "aiAnalysis";
ALTER TABLE "leads" DROP COLUMN IF EXISTS "aiDealRating";
ALTER TABLE "leads" DROP COLUMN IF EXISTS "aiDealWorthiness";
ALTER TABLE "leads" DROP COLUMN IF EXISTS "aiProfitPotential";
ALTER TABLE "leads" DROP COLUMN IF EXISTS "aiConfidence";
ALTER TABLE "leads" DROP COLUMN IF EXISTS "aiLastUpdated";
ALTER TABLE "leads" DROP COLUMN IF EXISTS "aiSummary";

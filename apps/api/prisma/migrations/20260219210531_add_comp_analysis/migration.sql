-- AlterTable
ALTER TABLE "comps" ADD COLUMN     "adjustedPrice" DOUBLE PRECISION,
ADD COLUMN     "adjustmentAmount" DOUBLE PRECISION,
ADD COLUMN     "adjustmentNotes" TEXT,
ADD COLUMN     "analysisId" TEXT,
ADD COLUMN     "hasGarage" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "hasPool" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "hoaFees" DOUBLE PRECISION,
ADD COLUMN     "isRenovated" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "lotSize" DOUBLE PRECISION,
ADD COLUMN     "notes" TEXT,
ADD COLUMN     "photoUrl" TEXT,
ADD COLUMN     "propertyType" TEXT,
ADD COLUMN     "schoolDistrict" TEXT,
ADD COLUMN     "selected" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "yearBuilt" INTEGER;

-- CreateTable
CREATE TABLE "comp_analyses" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "mode" TEXT NOT NULL DEFAULT 'ARV',
    "maxDistance" DOUBLE PRECISION NOT NULL DEFAULT 3,
    "timeFrameMonths" INTEGER NOT NULL DEFAULT 12,
    "propertyStatus" JSONB NOT NULL DEFAULT '["Sold"]',
    "propertyType" TEXT NOT NULL DEFAULT 'Auto',
    "confidenceScore" INTEGER NOT NULL DEFAULT 0,
    "aiSummary" TEXT,
    "arvEstimate" DOUBLE PRECISION,
    "arvLow" DOUBLE PRECISION,
    "arvHigh" DOUBLE PRECISION,
    "arvMethod" TEXT NOT NULL DEFAULT 'average',
    "avgAdjustment" DOUBLE PRECISION,
    "pricePerSqft" DOUBLE PRECISION,
    "adjustmentsEnabled" BOOLEAN NOT NULL DEFAULT true,
    "adjustmentConfig" JSONB,
    "repairCosts" DOUBLE PRECISION,
    "repairFinishLevel" TEXT,
    "repairNotes" TEXT,
    "repairItems" JSONB,
    "dealType" TEXT NOT NULL DEFAULT 'wholesale',
    "assignmentFee" DOUBLE PRECISION NOT NULL DEFAULT 15000,
    "maoPercent" DOUBLE PRECISION NOT NULL DEFAULT 70,
    "savedToLead" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "comp_analyses_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "comps" ADD CONSTRAINT "comps_analysisId_fkey" FOREIGN KEY ("analysisId") REFERENCES "comp_analyses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comp_analyses" ADD CONSTRAINT "comp_analyses_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

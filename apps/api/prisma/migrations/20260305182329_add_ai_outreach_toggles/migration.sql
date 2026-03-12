-- AlterTable
ALTER TABLE "comp_analyses" ADD COLUMN     "aiAssessment" TEXT,
ADD COLUMN     "photoAnalysis" TEXT,
ADD COLUMN     "photoRepairHigh" INTEGER,
ADD COLUMN     "photoRepairLow" INTEGER;

-- AlterTable
ALTER TABLE "comps" ADD COLUMN     "similarityScore" INTEGER;

-- AlterTable
ALTER TABLE "drip_settings" ADD COLUMN     "aiCallEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "aiSmsEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "callDelayMs" INTEGER NOT NULL DEFAULT 120000;

-- AlterTable
ALTER TABLE "leads" ADD COLUMN     "aiAnalysis" TEXT,
ADD COLUMN     "aiConfidence" INTEGER,
ADD COLUMN     "aiDealRating" INTEGER,
ADD COLUMN     "aiDealWorthiness" TEXT,
ADD COLUMN     "aiLastUpdated" TIMESTAMP(3),
ADD COLUMN     "aiProfitPotential" TEXT,
ADD COLUMN     "aiRecommendation" TEXT,
ADD COLUMN     "aiSummary" TEXT,
ADD COLUMN     "daysInStage" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "hoaFee" DOUBLE PRECISION,
ADD COLUMN     "lastSaleDate" TIMESTAMP(3),
ADD COLUMN     "lastSalePrice" DOUBLE PRECISION,
ADD COLUMN     "lastTouchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "latitude" DOUBLE PRECISION,
ADD COLUMN     "longitude" DOUBLE PRECISION,
ADD COLUMN     "lotSize" DOUBLE PRECISION,
ADD COLUMN     "organizationId" TEXT,
ADD COLUMN     "ownerOccupied" BOOLEAN,
ADD COLUMN     "sellerMotivation" TEXT,
ADD COLUMN     "stageChangedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "taxAssessedValue" DOUBLE PRECISION,
ADD COLUMN     "touchCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "yearBuilt" INTEGER;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "organizationId" TEXT;

-- CreateTable
CREATE TABLE "organizations" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "plan" TEXT NOT NULL DEFAULT 'FREE',
    "maxUsers" INTEGER NOT NULL DEFAULT 10,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "organizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "call_logs" (
    "id" TEXT NOT NULL,
    "leadId" TEXT,
    "vapiCallId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "type" TEXT NOT NULL DEFAULT 'ai_outbound',
    "transcript" TEXT,
    "duration" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "call_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "organizations_slug_key" ON "organizations"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "call_logs_vapiCallId_key" ON "call_logs"("vapiCallId");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "call_logs" ADD CONSTRAINT "call_logs_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "leads"("id") ON DELETE SET NULL ON UPDATE CASCADE;

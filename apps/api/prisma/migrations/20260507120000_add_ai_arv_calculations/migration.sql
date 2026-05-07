-- CreateTable
CREATE TABLE "ai_arv_calculations" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "curationId" TEXT,
    "inputHash" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "arv" DOUBLE PRECISION NOT NULL,
    "arvLow" DOUBLE PRECISION,
    "arvHigh" DOUBLE PRECISION,
    "pricePerSqft" DOUBLE PRECISION,
    "confidence" INTEGER NOT NULL,
    "confidenceLabel" TEXT NOT NULL,
    "resultJson" JSONB NOT NULL,
    "selectedCompIds" TEXT[],
    "reapiAvmAtCalc" DOUBLE PRECISION,
    "modelUsed" TEXT,
    "promptVersion" TEXT,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "computedByUserId" TEXT,

    CONSTRAINT "ai_arv_calculations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ai_arv_calculations_leadId_computedAt_idx" ON "ai_arv_calculations"("leadId", "computedAt" DESC);

-- CreateIndex
CREATE INDEX "ai_arv_calculations_leadId_inputHash_idx" ON "ai_arv_calculations"("leadId", "inputHash");

-- AddForeignKey
ALTER TABLE "ai_arv_calculations" ADD CONSTRAINT "ai_arv_calculations_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable: add Lead.currentArvCalculationId + currentArvUpdatedAt
ALTER TABLE "leads" ADD COLUMN "currentArvCalculationId" TEXT;
ALTER TABLE "leads" ADD COLUMN "currentArvUpdatedAt" TIMESTAMP(3);

-- AddForeignKey: Lead.currentArvCalculationId -> ai_arv_calculations.id
ALTER TABLE "leads" ADD CONSTRAINT "leads_currentArvCalculationId_fkey" FOREIGN KEY ("currentArvCalculationId") REFERENCES "ai_arv_calculations"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

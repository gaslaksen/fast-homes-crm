-- CreateTable
CREATE TABLE "ai_comp_curations" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "subjectSnapshot" JSONB NOT NULL,
    "valuationMode" TEXT NOT NULL,
    "hardConstraints" JSONB NOT NULL,
    "candidateIds" TEXT[],
    "excludedTypeMismatches" JSONB NOT NULL,
    "excludedConstraints" JSONB NOT NULL,
    "searchExpansion" JSONB NOT NULL,
    "promptText" TEXT NOT NULL,
    "promptVersion" TEXT NOT NULL,
    "rawResponse" JSONB NOT NULL,
    "parsedResponse" JSONB,
    "modelMetadata" JSONB NOT NULL,
    "isValidationRun" BOOLEAN NOT NULL DEFAULT false,
    "validationPropertyId" TEXT,
    "cacheKey" TEXT NOT NULL,

    CONSTRAINT "ai_comp_curations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ai_comp_curations_leadId_createdAt_idx" ON "ai_comp_curations"("leadId", "createdAt");

-- CreateIndex
CREATE INDEX "ai_comp_curations_cacheKey_idx" ON "ai_comp_curations"("cacheKey");

-- AddForeignKey
ALTER TABLE "ai_comp_curations" ADD CONSTRAINT "ai_comp_curations_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_comp_curations" ADD CONSTRAINT "ai_comp_curations_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

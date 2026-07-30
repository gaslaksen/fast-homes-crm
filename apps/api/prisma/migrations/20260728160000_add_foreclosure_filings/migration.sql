-- CreateTable: structured fields extracted from one filing's text. One row per
-- document; re-extraction updates in place. verifiedFields lists the fields a
-- user corrected by hand, which re-extraction must never overwrite.
CREATE TABLE "foreclosure_filings" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "leadId" TEXT,
    "organizationId" TEXT,
    "extractionVersion" INTEGER NOT NULL DEFAULT 1,
    "caseNumber" TEXT,
    "county" TEXT,
    "filedAt" TIMESTAMP(3),
    "submittedAt" TIMESTAMP(3),
    "recordOwnerNames" TEXT[],
    "substituteTrustee" TEXT,
    "trusteeAttorney" TEXT,
    "trusteeAttorneyBarNo" TEXT,
    "trusteeFirm" TEXT,
    "trusteeFirmAddress" TEXT,
    "trusteeFirmPhone" TEXT,
    "trusteeFileNumber" TEXT,
    "holderName" TEXT,
    "holderAddress" TEXT,
    "originalBeneficiary" TEXT,
    "dotDate" TIMESTAMP(3),
    "dotBook" TEXT,
    "dotPage" TEXT,
    "originalPrincipal" DOUBLE PRECISION,
    "propertyAddress" TEXT,
    "taxParcelId" TEXT,
    "hearingAt" TIMESTAMP(3),
    "hearingMethod" TEXT,
    "saleAt" TIMESTAMP(3),
    "fieldConfidence" JSONB,
    "verifiedByUserAt" TIMESTAMP(3),
    "verifiedFields" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "foreclosure_filings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "foreclosure_filings_documentId_key" ON "foreclosure_filings"("documentId");

-- CreateIndex
CREATE INDEX "foreclosure_filings_organizationId_caseNumber_idx" ON "foreclosure_filings"("organizationId", "caseNumber");

-- CreateIndex
CREATE INDEX "foreclosure_filings_leadId_idx" ON "foreclosure_filings"("leadId");

-- AddForeignKey
ALTER TABLE "foreclosure_filings" ADD CONSTRAINT "foreclosure_filings_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "foreclosure_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "foreclosure_filings" ADD CONSTRAINT "foreclosure_filings_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

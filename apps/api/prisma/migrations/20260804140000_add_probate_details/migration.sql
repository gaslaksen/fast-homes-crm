-- CreateTable
CREATE TABLE "probate_details" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "organizationId" TEXT,
    "dedupeUid" TEXT NOT NULL,
    "importBatch" TEXT,
    "caseNumber" TEXT,
    "caseFiledDate" TIMESTAMP(3),
    "county" TEXT,
    "deceasedName" TEXT,
    "monthsSinceDeath" DOUBLE PRECISION,
    "heirCity" TEXT,
    "absenteeHeir" BOOLEAN NOT NULL DEFAULT false,
    "consensusRank" INTEGER,
    "consensusScore" DOUBLE PRECISION,
    "consensusTier" TEXT,
    "agreement" TEXT,
    "eslPriority" DOUBLE PRECISION,
    "eslTier" TEXT,
    "motivationScore" DOUBLE PRECISION,
    "motivationTier" TEXT,
    "whyThisLead" TEXT,
    "estValue" DOUBLE PRECISION,
    "phone1Type" TEXT,
    "phone2" TEXT,
    "phone2Type" TEXT,
    "email2" TEXT,
    "moreOnFile" TEXT,
    "contactKey" TEXT,
    "primaryContact" BOOLEAN NOT NULL DEFAULT true,
    "workStatus" TEXT DEFAULT 'NOT_CONTACTED',
    "doNotCall" BOOLEAN NOT NULL DEFAULT false,
    "callNotes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "probate_details_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "probate_details_leadId_key" ON "probate_details"("leadId");

-- CreateIndex
CREATE INDEX "probate_details_organizationId_consensusTier_idx" ON "probate_details"("organizationId", "consensusTier");

-- CreateIndex
CREATE INDEX "probate_details_organizationId_workStatus_idx" ON "probate_details"("organizationId", "workStatus");

-- CreateIndex
CREATE INDEX "probate_details_organizationId_contactKey_idx" ON "probate_details"("organizationId", "contactKey");

-- CreateIndex
CREATE UNIQUE INDEX "probate_details_organizationId_dedupeUid_key" ON "probate_details"("organizationId", "dedupeUid");

-- AddForeignKey
ALTER TABLE "probate_details" ADD CONSTRAINT "probate_details_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

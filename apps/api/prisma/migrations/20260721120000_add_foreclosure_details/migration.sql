-- CreateTable
CREATE TABLE "foreclosure_details" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "organizationId" TEXT,
    "dedupeUid" TEXT NOT NULL,
    "noticeId" TEXT,
    "noticeType" TEXT,
    "noticeUrl" TEXT,
    "caseNumber" TEXT,
    "county" TEXT,
    "trustee" TEXT,
    "rawSnippet" TEXT,
    "sourceKind" TEXT,
    "saleDate" TIMESTAMP(3),
    "hearingDate" TIMESTAMP(3),
    "loanDate" TIMESTAMP(3),
    "loanAmount" DOUBLE PRECISION,
    "assessedValue" DOUBLE PRECISION,
    "priority" TEXT DEFAULT 'LOW',
    "leadScore" INTEGER DEFAULT 0,
    "equityPct" DOUBLE PRECISION,
    "equitySpread" DOUBLE PRECISION,
    "workStatus" TEXT DEFAULT 'NOT_CONTACTED',
    "doNotCall" BOOLEAN NOT NULL DEFAULT false,
    "countyOwner" TEXT,
    "ownerOccupied" TEXT,
    "mailingAddress" TEXT,
    "mailCity" TEXT,
    "mailState" TEXT,
    "mailZip" TEXT,
    "skipStatus" TEXT,
    "phone2" TEXT,
    "parcelId" TEXT,
    "parcelUrl" TEXT,
    "parcelType" TEXT,
    "parcelLabel" TEXT,
    "zillowUrl" TEXT,
    "realtorQuery" TEXT,
    "realtorZip" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "foreclosure_details_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "foreclosure_details_leadId_key" ON "foreclosure_details"("leadId");

-- CreateIndex
CREATE INDEX "foreclosure_details_organizationId_priority_idx" ON "foreclosure_details"("organizationId", "priority");

-- CreateIndex
CREATE INDEX "foreclosure_details_organizationId_saleDate_idx" ON "foreclosure_details"("organizationId", "saleDate");

-- CreateIndex
CREATE INDEX "foreclosure_details_organizationId_workStatus_idx" ON "foreclosure_details"("organizationId", "workStatus");

-- CreateIndex
CREATE UNIQUE INDEX "foreclosure_details_organizationId_dedupeUid_key" ON "foreclosure_details"("organizationId", "dedupeUid");

-- CreateIndex
CREATE UNIQUE INDEX "foreclosure_details_organizationId_noticeId_key" ON "foreclosure_details"("organizationId", "noticeId");

-- AddForeignKey
ALTER TABLE "foreclosure_details" ADD CONSTRAINT "foreclosure_details_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

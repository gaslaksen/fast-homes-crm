-- Tax Sales and Surplus Funds pipelines: one 1:1 detail table per new
-- Lead.source value (TAX_SALE, SURPLUS). Additive only, no existing table
-- is touched, so this is safe to run against a populated database.

-- CreateTable
CREATE TABLE "tax_sale_details" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "organizationId" TEXT,
    "dedupeUid" TEXT NOT NULL,
    "importBatch" TEXT,
    "fileNumber" TEXT,
    "method" TEXT,
    "statute" TEXT,
    "deedType" TEXT,
    "filedBy" TEXT,
    "county" TEXT,
    "parcelId" TEXT,
    "countyOwner" TEXT,
    "propertyType" TEXT,
    "acreage" DOUBLE PRECISION,
    "ownedSince" TEXT,
    "occupancy" TEXT DEFAULT 'UNKNOWN',
    "saleDate" TIMESTAMP(3),
    "upsetDeadline" TIMESTAMP(3),
    "assessedValue" DOUBLE PRECISION,
    "taxesOwed" DOUBLE PRECISION,
    "redemptionAmount" DOUBLE PRECISION,
    "openingBid" DOUBLE PRECISION,
    "currentBid" DOUBLE PRECISION,
    "depositPct" DOUBLE PRECISION DEFAULT 20,
    "delinquentYears" JSONB,
    "cityTaxes" BOOLEAN NOT NULL DEFAULT false,
    "hasMortgage" BOOLEAN NOT NULL DEFAULT false,
    "hasIrsLien" BOOLEAN NOT NULL DEFAULT false,
    "stage" TEXT DEFAULT 'JUDGMENT_DOCKETED',
    "priority" TEXT DEFAULT 'LOW',
    "leadScore" INTEGER NOT NULL DEFAULT 0,
    "equityPct" DOUBLE PRECISION,
    "equitySpread" DOUBLE PRECISION,
    "workStatus" TEXT DEFAULT 'NOT_CONTACTED',
    "doNotCall" BOOLEAN NOT NULL DEFAULT false,
    "callNotes" TEXT,
    "tags" JSONB,
    "workup" JSONB,
    "touchDays" JSONB,
    "touchWeek" TEXT,
    "touchCount" INTEGER NOT NULL DEFAULT 0,
    "phone2" TEXT,
    "phone3" TEXT,
    "phone4" TEXT,
    "phone1Type" TEXT,
    "phone2Type" TEXT,
    "phone3Type" TEXT,
    "phone4Type" TEXT,
    "email2" TEXT,
    "phone1Dnc" TEXT,
    "phone2Dnc" TEXT,
    "phone3Dnc" TEXT,
    "phone4Dnc" TEXT,
    "dncScrubbedAt" TIMESTAMP(3),
    "parcelUrl" TEXT,
    "zillowUrl" TEXT,
    "realtorQuery" TEXT,
    "realtorZip" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tax_sale_details_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "surplus_details" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "organizationId" TEXT,
    "dedupeUid" TEXT NOT NULL,
    "importBatch" TEXT,
    "county" TEXT,
    "caseNumber" TEXT,
    "parcelId" TEXT,
    "claimantType" TEXT DEFAULT 'previous_owner',
    "deceased" BOOLEAN NOT NULL DEFAULT false,
    "heirsRequired" BOOLEAN NOT NULL DEFAULT false,
    "competingLien" BOOLEAN NOT NULL DEFAULT false,
    "surplusType" TEXT DEFAULT 'tax_deed',
    "fundLocation" TEXT DEFAULT 'clerk',
    "saleDate" TIMESTAMP(3),
    "salePrice" DOUBLE PRECISION,
    "noticeDate" TIMESTAMP(3),
    "noticeConfirmed" BOOLEAN NOT NULL DEFAULT false,
    "certOfDisbursements" TIMESTAMP(3),
    "grossSurplus" DOUBLE PRECISION,
    "liens" JSONB,
    "arrangement" TEXT DEFAULT 'assignment',
    "totalConsideration" DOUBLE PRECISION DEFAULT 0,
    "licensedRepId" TEXT,
    "stage" TEXT DEFAULT 'New',
    "tier" TEXT DEFAULT 'U',
    "entitlementVerified" BOOLEAN NOT NULL DEFAULT false,
    "titleSearchComplete" BOOLEAN NOT NULL DEFAULT false,
    "disclosures" JSONB,
    "docs" JSONB,
    "doNotCall" BOOLEAN NOT NULL DEFAULT false,
    "callNotes" TEXT,
    "touchDays" JSONB,
    "touchWeek" TEXT,
    "touchCount" INTEGER NOT NULL DEFAULT 0,
    "phone2" TEXT,
    "phone3" TEXT,
    "phone4" TEXT,
    "phone1Type" TEXT,
    "phone2Type" TEXT,
    "phone3Type" TEXT,
    "phone4Type" TEXT,
    "email2" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "surplus_details_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tax_sale_details_leadId_key" ON "tax_sale_details"("leadId");

-- CreateIndex
CREATE INDEX "tax_sale_details_organizationId_priority_idx" ON "tax_sale_details"("organizationId", "priority");

-- CreateIndex
CREATE INDEX "tax_sale_details_organizationId_saleDate_idx" ON "tax_sale_details"("organizationId", "saleDate");

-- CreateIndex
CREATE INDEX "tax_sale_details_organizationId_stage_idx" ON "tax_sale_details"("organizationId", "stage");

-- CreateIndex
CREATE INDEX "tax_sale_details_organizationId_workStatus_idx" ON "tax_sale_details"("organizationId", "workStatus");

-- CreateIndex
CREATE INDEX "tax_sale_details_organizationId_county_idx" ON "tax_sale_details"("organizationId", "county");

-- CreateIndex
CREATE INDEX "tax_sale_details_phone2_idx" ON "tax_sale_details"("phone2");

-- CreateIndex
CREATE INDEX "tax_sale_details_phone3_idx" ON "tax_sale_details"("phone3");

-- CreateIndex
CREATE INDEX "tax_sale_details_phone4_idx" ON "tax_sale_details"("phone4");

-- CreateIndex
CREATE UNIQUE INDEX "tax_sale_details_organizationId_dedupeUid_key" ON "tax_sale_details"("organizationId", "dedupeUid");

-- CreateIndex
CREATE UNIQUE INDEX "surplus_details_leadId_key" ON "surplus_details"("leadId");

-- CreateIndex
CREATE INDEX "surplus_details_organizationId_stage_idx" ON "surplus_details"("organizationId", "stage");

-- CreateIndex
CREATE INDEX "surplus_details_organizationId_tier_idx" ON "surplus_details"("organizationId", "tier");

-- CreateIndex
CREATE INDEX "surplus_details_organizationId_county_idx" ON "surplus_details"("organizationId", "county");

-- CreateIndex
CREATE INDEX "surplus_details_organizationId_noticeDate_idx" ON "surplus_details"("organizationId", "noticeDate");

-- CreateIndex
CREATE INDEX "surplus_details_organizationId_grossSurplus_idx" ON "surplus_details"("organizationId", "grossSurplus");

-- CreateIndex
CREATE INDEX "surplus_details_phone2_idx" ON "surplus_details"("phone2");

-- CreateIndex
CREATE INDEX "surplus_details_phone3_idx" ON "surplus_details"("phone3");

-- CreateIndex
CREATE INDEX "surplus_details_phone4_idx" ON "surplus_details"("phone4");

-- CreateIndex
CREATE UNIQUE INDEX "surplus_details_organizationId_dedupeUid_key" ON "surplus_details"("organizationId", "dedupeUid");

-- AddForeignKey
ALTER TABLE "tax_sale_details" ADD CONSTRAINT "tax_sale_details_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "surplus_details" ADD CONSTRAINT "surplus_details_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;


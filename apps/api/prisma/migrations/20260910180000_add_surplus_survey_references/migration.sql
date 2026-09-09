-- The satisfaction survey that goes out with the claimant's check, and the
-- reference library built from paid claimants who consented to be named.
ALTER TABLE "surplus_details" ADD COLUMN "surveySentAt" TIMESTAMP(3);
ALTER TABLE "surplus_details" ADD COLUMN "surveyReturnedAt" TIMESTAMP(3);
ALTER TABLE "surplus_details" ADD COLUMN "surveyBonusPaidAt" TIMESTAMP(3);
ALTER TABLE "surplus_details" ADD COLUMN "surveyScore" INTEGER;
ALTER TABLE "surplus_details" ADD COLUMN "surveyComments" TEXT;

CREATE TABLE "surplus_references" (
    "id" TEXT NOT NULL,
    "surplusDetailId" TEXT NOT NULL,
    "organizationId" TEXT,
    "claimantName" TEXT NOT NULL,
    "county" TEXT,
    "state" TEXT NOT NULL DEFAULT 'FL',
    "consented" BOOLEAN NOT NULL DEFAULT false,
    "consentedAt" TIMESTAMP(3),
    "story" TEXT,
    "quote" TEXT,
    "amountRecovered" DOUBLE PRECISION,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "surplus_references_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "surplus_references_surplusDetailId_key" ON "surplus_references"("surplusDetailId");
CREATE INDEX "surplus_references_organizationId_consented_county_idx" ON "surplus_references"("organizationId", "consented", "county");

ALTER TABLE "surplus_references" ADD CONSTRAINT "surplus_references_surplusDetailId_fkey"
    FOREIGN KEY ("surplusDetailId") REFERENCES "surplus_details"("id") ON DELETE CASCADE ON UPDATE CASCADE;

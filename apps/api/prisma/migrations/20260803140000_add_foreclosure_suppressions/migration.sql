-- Tombstones for foreclosure notices the team deleted. Deleting a Lead cascades
-- its foreclosure_details row away, and that row held the only record that a
-- notice had been seen, so the next feed pull recreated it. These rows outlive
-- the delete.
CREATE TABLE "foreclosure_suppressions" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT,
    "dedupeUid" TEXT NOT NULL,
    "noticeId" TEXT,
    "caseNumber" TEXT,
    "addressKey" TEXT,
    "propertyAddress" TEXT,
    "reason" TEXT NOT NULL DEFAULT 'deleted',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "foreclosure_suppressions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "foreclosure_suppressions_organizationId_dedupeUid_idx" ON "foreclosure_suppressions"("organizationId", "dedupeUid");
CREATE INDEX "foreclosure_suppressions_organizationId_addressKey_idx" ON "foreclosure_suppressions"("organizationId", "addressKey");
CREATE INDEX "foreclosure_suppressions_organizationId_caseNumber_idx" ON "foreclosure_suppressions"("organizationId", "caseNumber");

-- Normalized "same property" key, so a re-filed notice with no case number and
-- a moved sale date finds its existing lead instead of forking a twin.
ALTER TABLE "foreclosure_details" ADD COLUMN "addressKey" TEXT;

CREATE INDEX "foreclosure_details_organizationId_addressKey_idx" ON "foreclosure_details"("organizationId", "addressKey");

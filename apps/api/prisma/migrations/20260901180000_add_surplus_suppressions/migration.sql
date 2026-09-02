-- Surplus cases the team removed, kept so the county poll cannot recreate them.
--
-- Deleting a lead cascades surplus_details away, and with it the dedupeUid the
-- poll matches on, so the case looked brand new the next morning and came back
-- with every note, edited number and Dead marking gone.
CREATE TABLE "surplus_suppressions" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT,
    "dedupeUid" TEXT NOT NULL,
    "county" TEXT,
    "caseNumber" TEXT,
    "claimant" TEXT,
    "propertyAddress" TEXT,
    "reason" TEXT NOT NULL DEFAULT 'deleted',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "surplus_suppressions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "surplus_suppressions_organizationId_dedupeUid_idx" ON "surplus_suppressions"("organizationId", "dedupeUid");
CREATE INDEX "surplus_suppressions_organizationId_caseNumber_idx" ON "surplus_suppressions"("organizationId", "caseNumber");

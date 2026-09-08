-- What each county requires to file a surplus claim, once per county. Rows
-- are created per organization on first read from the county list in code,
-- so nothing is inserted here.
CREATE TABLE "surplus_counties" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT,
    "name" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'FL',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "courtRecordsUrl" TEXT,
    "surplusListUrl" TEXT,
    "claimFormUrl" TEXT,
    "assignmentPreference" TEXT,
    "acceptedMethods" TEXT,
    "signatureRequired" BOOLEAN,
    "attorneyRequired" BOOLEAN,
    "clerkContactName" TEXT,
    "clerkContactPhone" TEXT,
    "clerkContactEmail" TEXT,
    "clerkAddress" TEXT,
    "notes" TEXT,
    "practiceRunAt" TIMESTAMP(3),
    "lastVerifiedAt" TIMESTAMP(3),
    "verifiedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "surplus_counties_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "surplus_counties_organizationId_name_key" ON "surplus_counties"("organizationId", "name");

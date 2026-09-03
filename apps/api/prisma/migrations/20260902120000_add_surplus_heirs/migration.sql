-- Living people who inherited a deceased claimant's interest, read off a
-- probate filing that somebody downloaded and confirmed.
--
-- Attached to surplus_details rather than promoted to leads: the money belongs
-- to the property and the claim is filed against one case, so separate leads
-- would put one surplus on two boards and let somebody work half of it.
CREATE TABLE "surplus_heirs" (
    "id" TEXT NOT NULL,
    "surplusDetailId" TEXT NOT NULL,
    "organizationId" TEXT,
    "name" TEXT NOT NULL,
    "relationship" TEXT,
    "share" TEXT,
    "street" TEXT,
    "city" TEXT,
    "state" TEXT,
    "zip" TEXT,
    "deceased" BOOLEAN NOT NULL DEFAULT false,
    "dateOfDeath" TIMESTAMP(3),
    "phone1" TEXT,
    "phone2" TEXT,
    "phone3" TEXT,
    "phone4" TEXT,
    "phone1Type" TEXT,
    "phone2Type" TEXT,
    "phone3Type" TEXT,
    "phone4Type" TEXT,
    "phone1Dnc" TEXT,
    "phone2Dnc" TEXT,
    "phone3Dnc" TEXT,
    "phone4Dnc" TEXT,
    "email1" TEXT,
    "email2" TEXT,
    "tracedAt" TIMESTAMP(3),
    "traceOutcome" TEXT,
    "traceDetail" TEXT,
    "contactMismatch" BOOLEAN NOT NULL DEFAULT false,
    "mismatchedName" TEXT,
    "doNotCall" BOOLEAN NOT NULL DEFAULT false,
    "callNotes" TEXT,
    "sourceCaseNumber" TEXT,
    "sourceDocument" TEXT,
    "sourceKind" TEXT DEFAULT 'probate_petition',
    "addedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "surplus_heirs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "surplus_heirs_surplusDetailId_idx" ON "surplus_heirs"("surplusDetailId");
CREATE INDEX "surplus_heirs_organizationId_name_idx" ON "surplus_heirs"("organizationId", "name");
-- Reverse lookup for an inbound call or text from an heir's number.
CREATE INDEX "surplus_heirs_phone1_idx" ON "surplus_heirs"("phone1");

ALTER TABLE "surplus_heirs" ADD CONSTRAINT "surplus_heirs_surplusDetailId_fkey"
  FOREIGN KEY ("surplusDetailId") REFERENCES "surplus_details"("id") ON DELETE CASCADE ON UPDATE CASCADE;

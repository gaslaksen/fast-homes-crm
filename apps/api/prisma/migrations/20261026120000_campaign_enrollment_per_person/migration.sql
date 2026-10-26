-- A drip enrollment can now be for a person on a surplus case (an heir, a
-- relative, a neighbor) rather than only the claimant. Null heirId is the
-- claimant, which every existing row is.
ALTER TABLE "campaign_enrollments" ADD COLUMN "heirId" TEXT;
ALTER TABLE "campaign_enrollments" ADD COLUMN "recipientKey" TEXT NOT NULL DEFAULT '';

ALTER TABLE "campaign_enrollments"
  ADD CONSTRAINT "campaign_enrollments_heirId_fkey"
  FOREIGN KEY ("heirId") REFERENCES "surplus_heirs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "campaign_enrollments_heirId_idx" ON "campaign_enrollments"("heirId");

-- One enrollment per person per campaign. Every existing row has
-- recipientKey '', so the old (campaignId, leadId) uniqueness carries over.
DROP INDEX "campaign_enrollments_campaignId_leadId_key";
CREATE UNIQUE INDEX "campaign_enrollments_campaignId_leadId_recipientKey_key"
  ON "campaign_enrollments"("campaignId", "leadId", "recipientKey");

-- The footer clock for texts to this person, apart from the claimant's.
ALTER TABLE "surplus_heirs" ADD COLUMN "complianceFooterSentAt" TIMESTAMP(3);

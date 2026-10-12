-- The address a campaign enrollment emails, when the lead has more than one.
ALTER TABLE "campaign_enrollments" ADD COLUMN "toEmail" TEXT;

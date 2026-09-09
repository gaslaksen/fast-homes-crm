-- How a surplus claim package went to the county and what the county said.
ALTER TABLE "surplus_details" ADD COLUMN "submissionMethod" TEXT;
ALTER TABLE "surplus_details" ADD COLUMN "submissionTrackingNumber" TEXT;
ALTER TABLE "surplus_details" ADD COLUMN "submissionSignatureRequired" BOOLEAN;
ALTER TABLE "surplus_details" ADD COLUMN "submittedAt" TIMESTAMP(3);
ALTER TABLE "surplus_details" ADD COLUMN "countyAcknowledgedAt" TIMESTAMP(3);
ALTER TABLE "surplus_details" ADD COLUMN "clerkContactName" TEXT;
ALTER TABLE "surplus_details" ADD COLUMN "clerkStatusNote" TEXT;
ALTER TABLE "surplus_details" ADD COLUMN "additionalDocsRequested" TEXT;
ALTER TABLE "surplus_details" ADD COLUMN "expectedDisbursementAt" TIMESTAMP(3);

-- The money coming back on a surplus claim: the county's check, the fee,
-- the itemized expenses, the signed disbursement report, the thirty-day
-- clearing, and the claimant's check sent tracked.
ALTER TABLE "surplus_details" ADD COLUMN "checkReceivedAt" TIMESTAMP(3);
ALTER TABLE "surplus_details" ADD COLUMN "checkAmount" DOUBLE PRECISION;
ALTER TABLE "surplus_details" ADD COLUMN "feePercent" DOUBLE PRECISION;
ALTER TABLE "surplus_details" ADD COLUMN "expensesFromClaimantShare" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "surplus_details" ADD COLUMN "disbursementReportSignedAt" TIMESTAMP(3);
ALTER TABLE "surplus_details" ADD COLUMN "clearingDueAt" TIMESTAMP(3);
ALTER TABLE "surplus_details" ADD COLUMN "checkSentAt" TIMESTAMP(3);
ALTER TABLE "surplus_details" ADD COLUMN "checkSentMethod" TEXT;
ALTER TABLE "surplus_details" ADD COLUMN "checkSentTrackingNumber" TEXT;
ALTER TABLE "surplus_details" ADD COLUMN "claimantShare" DOUBLE PRECISION;
ALTER TABLE "surplus_details" ADD COLUMN "companyShare" DOUBLE PRECISION;
ALTER TABLE "surplus_details" ADD COLUMN "companyNet" DOUBLE PRECISION;

CREATE TABLE "surplus_expenses" (
    "id" TEXT NOT NULL,
    "surplusDetailId" TEXT NOT NULL,
    "organizationId" TEXT,
    "kind" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "incurredAt" TIMESTAMP(3) NOT NULL,
    "note" TEXT,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "surplus_expenses_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "surplus_expenses_surplusDetailId_idx" ON "surplus_expenses"("surplusDetailId");

ALTER TABLE "surplus_expenses" ADD CONSTRAINT "surplus_expenses_surplusDetailId_fkey"
    FOREIGN KEY ("surplusDetailId") REFERENCES "surplus_details"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable: lender name patterns that classify the debt being foreclosed.
-- A lookup table, not a model inference, so the reverse-mortgage catch is
-- reliable and the team can extend it as new filing patterns appear.
CREATE TABLE "lender_profiles" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT,
    "matchPattern" TEXT NOT NULL,
    "matchType" TEXT NOT NULL DEFAULT 'substring',
    "lenderName" TEXT NOT NULL,
    "loanType" TEXT NOT NULL,
    "servicerType" TEXT,
    "notes" TEXT,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lender_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "lender_profiles_organizationId_matchPattern_key" ON "lender_profiles"("organizationId", "matchPattern");

-- CreateIndex
CREATE INDEX "lender_profiles_organizationId_active_idx" ON "lender_profiles"("organizationId", "active");

-- AlterTable: rules-engine output on the foreclosure lead. debtFigureReliable
-- is false for a HECM, where equityPct/equitySpread are left null rather than
-- computed from a recorded principal that overstates the debt.
ALTER TABLE "foreclosure_details" ADD COLUMN "loanType" TEXT;
ALTER TABLE "foreclosure_details" ADD COLUMN "lenderName" TEXT;
ALTER TABLE "foreclosure_details" ADD COLUMN "debtFigureReliable" BOOLEAN NOT NULL DEFAULT true;

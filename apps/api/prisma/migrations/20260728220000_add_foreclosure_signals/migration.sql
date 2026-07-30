-- CreateTable: typed, actionable flags derived from a filing's extracted facts
-- plus the deterministic rules output. evidence is never empty - an ungrounded
-- signal is dropped before it reaches this table.
CREATE TABLE "foreclosure_signals" (
    "id" TEXT NOT NULL,
    "filingId" TEXT NOT NULL,
    "leadId" TEXT,
    "organizationId" TEXT,
    "analysisVersion" INTEGER NOT NULL DEFAULT 1,
    "signalCode" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "headline" TEXT NOT NULL,
    "evidence" TEXT[],
    "recommendedActions" TEXT[],
    "completedActions" TEXT[],
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "foreclosure_signals_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "foreclosure_signals_filingId_signalCode_key" ON "foreclosure_signals"("filingId", "signalCode");

-- CreateIndex
CREATE INDEX "foreclosure_signals_leadId_severity_idx" ON "foreclosure_signals"("leadId", "severity");

-- CreateIndex
CREATE INDEX "foreclosure_signals_organizationId_signalCode_idx" ON "foreclosure_signals"("organizationId", "signalCode");

-- AddForeignKey
ALTER TABLE "foreclosure_signals" ADD CONSTRAINT "foreclosure_signals_filingId_fkey" FOREIGN KEY ("filingId") REFERENCES "foreclosure_filings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "foreclosure_signals" ADD CONSTRAINT "foreclosure_signals_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

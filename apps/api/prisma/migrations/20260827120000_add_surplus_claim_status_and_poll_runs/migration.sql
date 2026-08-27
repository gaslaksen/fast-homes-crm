-- Surplus claim status, notice-time amount, mail verdict, document ledger and
-- source provenance, plus the poll-run table for the county ingest.
--
-- claimStatus is a different axis from `tier`: tier bands the dollars, this
-- bands whether anybody else has a hand on them. It is read off the case
-- document list and never off the posted balance, because Duval case
-- 2025-0774TD carries three Surplus Distribution filings while the search grid
-- still shows the full $27,929.98.

-- AlterTable
ALTER TABLE "surplus_details" ADD COLUMN     "claimLedger" JSONB,
ADD COLUMN     "claimStatus" TEXT DEFAULT 'unknown',
ADD COLUMN     "lastPolledAt" TIMESTAMP(3),
ADD COLUMN     "mailVerdict" TEXT,
ADD COLUMN     "sourceCaseId" TEXT,
ADD COLUMN     "sourceSystem" TEXT,
ADD COLUMN     "sourceUrl" TEXT,
ADD COLUMN     "surplusAtNotice" DOUBLE PRECISION;

-- CreateIndex
CREATE INDEX "surplus_details_organizationId_claimStatus_idx" ON "surplus_details"("organizationId", "claimStatus");

-- CreateTable
CREATE TABLE "surplus_poll_runs" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT,
    "trigger" TEXT NOT NULL,
    "source" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "ok" BOOLEAN NOT NULL DEFAULT false,
    "scanned" INTEGER NOT NULL DEFAULT 0,
    "created" INTEGER NOT NULL DEFAULT 0,
    "updated" INTEGER NOT NULL DEFAULT 0,
    "skipped" INTEGER NOT NULL DEFAULT 0,
    "belowFloor" INTEGER NOT NULL DEFAULT 0,
    "classified" INTEGER NOT NULL DEFAULT 0,
    "dead" INTEGER NOT NULL DEFAULT 0,
    "errors" INTEGER NOT NULL DEFAULT 0,
    "message" TEXT,

    CONSTRAINT "surplus_poll_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "surplus_poll_runs_startedAt_idx" ON "surplus_poll_runs"("startedAt");

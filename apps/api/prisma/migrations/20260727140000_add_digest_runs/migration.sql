-- One row per Daily Brief send. Lets the next run avoid repeating yesterday's
-- lead story, and gives day-over-day deltas a baseline to diff against.
CREATE TABLE "digest_runs" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "bigThingKey" TEXT,
    "metrics" JSONB,
    CONSTRAINT "digest_runs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "digest_runs_organizationId_sentAt_idx" ON "digest_runs"("organizationId", "sentAt");

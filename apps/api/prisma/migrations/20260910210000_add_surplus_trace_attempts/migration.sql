-- One row per search run for a surplus claimant, heir or associate, by
-- channel, so nothing is run twice and the free routes are provably tried
-- before a paid one. Past BatchData runs are backfilled from the trace
-- state already on the rows.
CREATE TABLE "surplus_trace_attempts" (
    "id" TEXT NOT NULL,
    "surplusDetailId" TEXT NOT NULL,
    "heirId" TEXT,
    "organizationId" TEXT,
    "channel" TEXT NOT NULL,
    "source" TEXT,
    "result" TEXT NOT NULL,
    "summary" TEXT,
    "cost" DOUBLE PRECISION,
    "ranAt" TIMESTAMP(3) NOT NULL,
    "byUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "surplus_trace_attempts_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "surplus_trace_attempts_surplusDetailId_ranAt_idx" ON "surplus_trace_attempts"("surplusDetailId", "ranAt");
CREATE INDEX "surplus_trace_attempts_organizationId_channel_idx" ON "surplus_trace_attempts"("organizationId", "channel");

ALTER TABLE "surplus_trace_attempts" ADD CONSTRAINT "surplus_trace_attempts_surplusDetailId_fkey"
    FOREIGN KEY ("surplusDetailId") REFERENCES "surplus_details"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "surplus_trace_attempts" ADD CONSTRAINT "surplus_trace_attempts_heirId_fkey"
    FOREIGN KEY ("heirId") REFERENCES "surplus_heirs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill: every claimant already traced becomes one paid-database attempt
-- with the outcome the row carries, so the log starts from what was spent.
INSERT INTO "surplus_trace_attempts" ("id", "surplusDetailId", "organizationId", "channel", "source", "result", "summary", "ranAt", "createdAt")
SELECT
    'sta_' || md5(random()::text || clock_timestamp()::text || "id"),
    "id",
    "organizationId",
    'paid_db',
    'batchdata',
    CASE
        WHEN "traceOutcome" IN ('matched', 'relative', 'unverified') THEN 'found'
        WHEN "traceOutcome" = 'mismatch' THEN 'mismatch'
        WHEN "traceOutcome" = 'skipped' THEN 'skipped'
        ELSE 'nothing'
    END,
    "traceDetail",
    "tracedAt",
    "tracedAt"
FROM "surplus_details"
WHERE "tracedAt" IS NOT NULL;

INSERT INTO "surplus_trace_attempts" ("id", "surplusDetailId", "heirId", "organizationId", "channel", "source", "result", "summary", "ranAt", "createdAt")
SELECT
    'sta_' || md5(random()::text || clock_timestamp()::text || h."id"),
    h."surplusDetailId",
    h."id",
    h."organizationId",
    'paid_db',
    'batchdata',
    CASE
        WHEN h."traceOutcome" IN ('matched', 'relative', 'unverified') THEN 'found'
        WHEN h."traceOutcome" = 'mismatch' THEN 'mismatch'
        WHEN h."traceOutcome" = 'skipped' THEN 'skipped'
        ELSE 'nothing'
    END,
    h."traceDetail",
    h."tracedAt",
    h."tracedAt"
FROM "surplus_heirs" h
WHERE h."tracedAt" IS NOT NULL;

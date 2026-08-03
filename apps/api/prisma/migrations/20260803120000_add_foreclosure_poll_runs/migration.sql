-- One row per Mecklenburg Times feed poll, cron or manual. Gives the
-- foreclosures page a last-pulled timestamp and counts, so a cron that has
-- silently stopped is visible in the app instead of only in Railway logs.
CREATE TABLE "foreclosure_poll_runs" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT,
    "trigger" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "ok" BOOLEAN NOT NULL DEFAULT false,
    "scanned" INTEGER NOT NULL DEFAULT 0,
    "created" INTEGER NOT NULL DEFAULT 0,
    "skipped" INTEGER NOT NULL DEFAULT 0,
    "pastDated" INTEGER NOT NULL DEFAULT 0,
    "errors" INTEGER NOT NULL DEFAULT 0,
    "message" TEXT,
    CONSTRAINT "foreclosure_poll_runs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "foreclosure_poll_runs_startedAt_idx" ON "foreclosure_poll_runs"("startedAt");

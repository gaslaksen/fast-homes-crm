-- Endato ran up $534.78 in four days (2026-09-11 to 09-14) with nothing
-- counting it in the app. Every paid vendor call is now counted per month and
-- the Endato service refuses calls past ENDATO_MONTHLY_BUDGET.
CREATE TABLE "vendor_usage" (
    "id" TEXT NOT NULL,
    "vendor" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "calls" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vendor_usage_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "vendor_usage_vendor_period_key" ON "vendor_usage"("vendor", "period");

-- September 2026 so far, from the card: $17.49 (09-11) + $271.32 (09-12) +
-- $245.97 (09-14) = $534.78 at $0.35 per Person Search match, 1,528 calls.
-- Seeded so the month's budget counts money already spent.
INSERT INTO "vendor_usage" ("id", "vendor", "period", "calls", "updatedAt")
VALUES ('endato-2026-09-seed', 'endato', '2026-09', 1528, CURRENT_TIMESTAMP);

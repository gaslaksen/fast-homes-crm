-- The obituary search: Claude with web search looks for an obituary for a
-- claimant, marks them dead on a strong match, flags a possible one for a
-- person, and files the survivors it names. Its cost is tokens plus searches,
-- so the usage table gains a dollar total.
ALTER TABLE "surplus_details" ADD COLUMN "obituaryCheckedAt" TIMESTAMP(3);
ALTER TABLE "surplus_details" ADD COLUMN "obituaryMatch" TEXT;
ALTER TABLE "surplus_details" ADD COLUMN "obituary" JSONB;
ALTER TABLE "vendor_usage" ADD COLUMN "spend" DOUBLE PRECISION NOT NULL DEFAULT 0;

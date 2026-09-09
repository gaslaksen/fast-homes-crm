-- One row per envelope on a surplus claim, so the letter cadence and the
-- "third unanswered letter" escalation can be counted. letterMailedAt and
-- letterMailedTo on surplus_details stay as a cache of the latest.
CREATE TABLE "surplus_letters" (
    "id" TEXT NOT NULL,
    "surplusDetailId" TEXT NOT NULL,
    "heirId" TEXT,
    "organizationId" TEXT,
    "mailedAt" TIMESTAMP(3) NOT NULL,
    "recipientName" TEXT,
    "address" TEXT,
    "templateKind" TEXT,
    "templateVersion" INTEGER,
    "mailType" TEXT NOT NULL DEFAULT 'standard',
    "trackingNumber" TEXT,
    "note" TEXT,
    "sentByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "surplus_letters_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "surplus_letters_surplusDetailId_mailedAt_idx" ON "surplus_letters"("surplusDetailId", "mailedAt");
CREATE INDEX "surplus_letters_organizationId_mailedAt_idx" ON "surplus_letters"("organizationId", "mailedAt");

ALTER TABLE "surplus_letters" ADD CONSTRAINT "surplus_letters_surplusDetailId_fkey"
    FOREIGN KEY ("surplusDetailId") REFERENCES "surplus_details"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "surplus_letters" ADD CONSTRAINT "surplus_letters_heirId_fkey"
    FOREIGN KEY ("heirId") REFERENCES "surplus_heirs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- How often a letter goes out while nobody has replied. Null is the default
-- of fourteen days.
ALTER TABLE "surplus_details" ADD COLUMN "letterCadenceDays" INTEGER;

-- History starts with what is already on file: every claimant marked as
-- mailed becomes one standard letter, so the first cadence check does not
-- read those as never written to.
INSERT INTO "surplus_letters" ("id", "surplusDetailId", "organizationId", "mailedAt", "address", "mailType", "createdAt")
SELECT
    'sl_' || md5(random()::text || clock_timestamp()::text || "id"),
    "id",
    "organizationId",
    "letterMailedAt",
    "letterMailedTo",
    'standard',
    "letterMailedAt"
FROM "surplus_details"
WHERE "letterMailedAt" IS NOT NULL;

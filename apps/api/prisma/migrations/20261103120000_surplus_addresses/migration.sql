-- Every address on record for a surplus claimant. The clerk mails one owner
-- at several addresses and the card keeps one; this table keeps them all.
-- New table only, nothing existing is changed. Each claimant's current
-- notice address is copied in so the table starts complete; the weekly pull
-- adds the other addresses the clerk mailed as it refreshes each case.
CREATE TABLE "surplus_addresses" (
    "id" TEXT NOT NULL,
    "surplusDetailId" TEXT NOT NULL,
    "organizationId" TEXT,
    "street" TEXT NOT NULL,
    "city" TEXT,
    "state" TEXT,
    "zip" TEXT,
    "country" TEXT,
    "nameOnRecord" TEXT,
    "source" TEXT NOT NULL,
    "delivery" TEXT,
    "addressKey" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'untried',
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "surplus_addresses_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "surplus_addresses_surplusDetailId_addressKey_key" ON "surplus_addresses"("surplusDetailId", "addressKey");
CREATE INDEX "surplus_addresses_surplusDetailId_status_idx" ON "surplus_addresses"("surplusDetailId", "status");

ALTER TABLE "surplus_addresses" ADD CONSTRAINT "surplus_addresses_surplusDetailId_fkey" FOREIGN KEY ("surplusDetailId") REFERENCES "surplus_details"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- The address already on each card. The key matches surplusAddressKey in
-- surplus-address.util.ts: street upper case with everything but letters and
-- digits removed, a bar, then the first five digits of the zip.
INSERT INTO "surplus_addresses" (
    "id", "surplusDetailId", "organizationId", "street", "city", "state", "zip", "country",
    "nameOnRecord", "source", "addressKey", "updatedAt"
)
SELECT
    'sad_' || md5(random()::text || clock_timestamp()::text || "id"),
    "id",
    "organizationId",
    "ownerMailingStreet",
    "ownerMailingCity",
    "ownerMailingState",
    "ownerMailingZip",
    "ownerMailingCountry",
    "noticeRecipient",
    COALESCE(NULLIF("ownerAddressSource", ''), 'manual'),
    upper(regexp_replace("ownerMailingStreet", '[^A-Za-z0-9]', '', 'g')) || '|' ||
        left(regexp_replace(COALESCE("ownerMailingZip", ''), '[^0-9]', '', 'g'), 5),
    CURRENT_TIMESTAMP
FROM "surplus_details"
WHERE "ownerMailingStreet" IS NOT NULL AND btrim("ownerMailingStreet") <> ''
ON CONFLICT ("surplusDetailId", "addressKey") DO NOTHING;

-- Twilio refactor: drop the seller portal and the Smrtphone integration,
-- add the messaging-compliance footer settings and the photo-request gate.

-- 1. Seller portal removal -------------------------------------------------
DROP TABLE IF EXISTS "seller_portals";

ALTER TABLE "offers" DROP COLUMN IF EXISTS "visibleOnPortal";
ALTER TABLE "offers" DROP COLUMN IF EXISTS "sellerRespondedAt";

-- 2. Smrtphone removal -----------------------------------------------------
DROP INDEX IF EXISTS "call_logs_smrtphoneCallId_key";
ALTER TABLE "call_logs" DROP COLUMN IF EXISTS "smrtphoneCallId";
ALTER TABLE "leads"     DROP COLUMN IF EXISTS "smrtphoneContactId";

-- Legacy provider call types no longer have a code path. Fold them into the
-- generic AI/outbound bucket so reports that group on `type` stay meaningful.
UPDATE "call_logs" SET "type" = 'ai_outbound'
 WHERE "type" IN ('smrtphone_call', 'smrtagent_call');

-- 3. Conference-based browser calling (hold + blind/warm transfer) ---------
ALTER TABLE "call_logs" ADD COLUMN IF NOT EXISTS "conferenceName" TEXT;
ALTER TABLE "call_logs" ADD COLUMN IF NOT EXISTS "transferState"  TEXT;
ALTER TABLE "call_logs" ADD COLUMN IF NOT EXISTS "transferTo"     TEXT;

-- 4. Conversation + compliance gates --------------------------------------
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "photosRequestedAt"      TIMESTAMP(3);
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "complianceFooterSentAt" TIMESTAMP(3);

CREATE TABLE IF NOT EXISTS "messaging_compliance" (
    "id"              TEXT         NOT NULL DEFAULT 'default',
    "optOutEnabled"   BOOLEAN      NOT NULL DEFAULT true,
    "optOutText"      TEXT         NOT NULL DEFAULT 'Reply STOP to stop texting',
    "senderIdEnabled" BOOLEAN      NOT NULL DEFAULT true,
    "senderIdText"    TEXT         NOT NULL DEFAULT 'Quick Cash Home Buyers',
    "periodicEnabled" BOOLEAN      NOT NULL DEFAULT false,
    "periodicDays"    INTEGER      NOT NULL DEFAULT 30,
    "updatedAt"       TIMESTAMP(3) NOT NULL,

    CONSTRAINT "messaging_compliance_pkey" PRIMARY KEY ("id")
);

INSERT INTO "messaging_compliance" ("id", "updatedAt")
VALUES ('default', CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;

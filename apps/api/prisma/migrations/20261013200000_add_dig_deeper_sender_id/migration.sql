-- A sender name per brand on the SMS compliance footer. Until now one name
-- went on every lead's first text, whichever company the lead belongs to.
ALTER TABLE "messaging_compliance"
  ADD COLUMN "senderIdTextDigDeeper" TEXT NOT NULL DEFAULT 'D.I.G. Deeper LLC';

-- The single name had been switched to D.I.G. Deeper because the D.I.G.
-- Deeper number is the default. Keep that wording for surplus leads, and put
-- the Quick Cash name back for everyone else.
UPDATE "messaging_compliance"
SET "senderIdTextDigDeeper" = "senderIdText",
    "senderIdText" = 'Quick Cash Home Buyers'
WHERE "senderIdText" ILIKE '%dig%deeper%';

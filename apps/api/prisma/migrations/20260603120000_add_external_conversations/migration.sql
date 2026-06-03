-- External-partner-driven conversations (e.g. Closercontrol). Dealcore only
-- generates responses and extracts CAMP data here. The partner owns sending,
-- scheduling, opt-outs, and pipeline. Fully isolated from "leads".
--
-- Table names match the @@map'd snake_case from the Prisma schema.
-- Column casing matches the existing camelCase convention.

CREATE TABLE "external_conversations" (
  "id"               TEXT PRIMARY KEY,
  "partnerKey"       TEXT NOT NULL,
  "externalId"       TEXT NOT NULL,
  "sellerFirstName"  TEXT,
  "sellerPhone"      TEXT,
  "extractedFields"  JSONB NOT NULL DEFAULT '{}',
  "campScore"        INTEGER,
  "campBand"         TEXT,
  "messageCount"     INTEGER NOT NULL DEFAULT 0,
  "lastInboundAt"    TIMESTAMP(3),
  "lastOutboundAt"   TIMESTAMP(3),
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX "external_conversations_partnerKey_externalId_key"
  ON "external_conversations" ("partnerKey", "externalId");

CREATE TABLE "external_conversation_messages" (
  "id"              TEXT PRIMARY KEY,
  "conversationId"  TEXT NOT NULL,
  "direction"       TEXT NOT NULL,
  "body"            TEXT NOT NULL,
  "sentAt"          TIMESTAMP(3) NOT NULL,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE "external_conversation_messages"
  ADD CONSTRAINT "external_conversation_messages_conversationId_fkey"
    FOREIGN KEY ("conversationId") REFERENCES "external_conversations"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "external_conversation_messages_conversationId_sentAt_idx"
  ON "external_conversation_messages" ("conversationId", "sentAt");

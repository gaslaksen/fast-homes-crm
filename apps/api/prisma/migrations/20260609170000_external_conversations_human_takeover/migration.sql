-- Add human-takeover tracking to external_conversations. When a partner's
-- user manually sends a message in their UI (detected via userId in outbound
-- webhook payloads), we set humanTookOverAt and stop auto-responding to
-- subsequent inbounds for that conversation.

ALTER TABLE "external_conversations"
  ADD COLUMN "humanTookOverAt" TIMESTAMP(3),
  ADD COLUMN "humanTookOverBy" TEXT;

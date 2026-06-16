-- Add MMS media attachments to messages.
-- Stores an array of { url, thumbnailUrl } base64 data URIs; null for plain SMS.
ALTER TABLE "messages" ADD COLUMN "mediaUrls" JSONB;

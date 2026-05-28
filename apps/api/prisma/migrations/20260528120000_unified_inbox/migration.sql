-- Unified inbox: denormalized last-message summary + thread state on leads
ALTER TABLE "leads" ADD COLUMN "lastMessageAt" TIMESTAMP(3);
ALTER TABLE "leads" ADD COLUMN "lastMessagePreview" TEXT;
ALTER TABLE "leads" ADD COLUMN "lastMessageDirection" TEXT;
ALTER TABLE "leads" ADD COLUMN "threadUnread" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "leads" ADD COLUMN "threadStarred" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX "leads_organizationId_lastMessageAt_idx" ON "leads"("organizationId", "lastMessageAt");

-- Per-user conversation view tracking (drives the "Recent" tab)
CREATE TABLE "conversation_views" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "viewedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "conversation_views_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "conversation_views_userId_leadId_key" ON "conversation_views"("userId", "leadId");
CREATE INDEX "conversation_views_userId_viewedAt_idx" ON "conversation_views"("userId", "viewedAt");

-- Backfill thread summary from each lead's most recent message
UPDATE "leads" l SET
  "lastMessageAt" = m."createdAt",
  "lastMessagePreview" = LEFT(m.body, 160),
  "lastMessageDirection" = m.direction,
  "threadUnread" = (m.direction = 'INBOUND')
FROM (
  SELECT DISTINCT ON ("leadId") "leadId", "createdAt", body, direction
  FROM "messages"
  ORDER BY "leadId", "createdAt" DESC
) m
WHERE m."leadId" = l.id;

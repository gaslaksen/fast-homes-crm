-- Hot-leads dismissal: clears a lead off the dashboard's Hot leads card
-- without touching its score band.
ALTER TABLE "leads" ADD COLUMN "hotDismissedAt" TIMESTAMP(3);

-- Per-user unread is computed by joining conversation_views lead-side, which
-- previously had no index on leadId (only the (userId, leadId) unique).
CREATE INDEX "conversation_views_leadId_idx" ON "conversation_views"("leadId");

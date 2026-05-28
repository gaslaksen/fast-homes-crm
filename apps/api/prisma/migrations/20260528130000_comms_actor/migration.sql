-- Communications timeline: per-item actor attribution (null = AI/system/inbound)
ALTER TABLE "messages" ADD COLUMN "sentByUserId" TEXT;
ALTER TABLE "emails" ADD COLUMN "sentByUserId" TEXT;
ALTER TABLE "call_logs" ADD COLUMN "initiatedByUserId" TEXT;

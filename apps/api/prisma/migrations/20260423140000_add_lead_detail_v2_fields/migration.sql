-- AlterTable: add AI insight cache + alert dismissals for Lead Detail V2
ALTER TABLE "leads" ADD COLUMN "aiInsight" TEXT;
ALTER TABLE "leads" ADD COLUMN "aiInsightGeneratedAt" TIMESTAMP(3);
ALTER TABLE "leads" ADD COLUMN "aiInsightState" TEXT;
ALTER TABLE "leads" ADD COLUMN "alertDismissals" JSONB;

-- AlterTable
ALTER TABLE "call_logs" ADD COLUMN "smrtphoneCallId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "call_logs_smrtphoneCallId_key" ON "call_logs"("smrtphoneCallId");

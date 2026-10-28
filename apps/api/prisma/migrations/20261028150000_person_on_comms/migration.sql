-- Which person on a surplus case a text, call, email or follow-up was with.
-- Null means the claimant, which is every existing row until the backfill
-- script fills the ones it can match by number or address.
--
-- Adds a nullable column, an index and a foreign key (set null on delete) to
-- messages, call_logs, emails and tasks. No existing row is written.

-- AlterTable
ALTER TABLE "messages" ADD COLUMN     "heirId" TEXT;

-- AlterTable
ALTER TABLE "tasks" ADD COLUMN     "heirId" TEXT;

-- AlterTable
ALTER TABLE "call_logs" ADD COLUMN     "heirId" TEXT;

-- AlterTable
ALTER TABLE "emails" ADD COLUMN     "heirId" TEXT;

-- CreateIndex
CREATE INDEX "messages_heirId_idx" ON "messages"("heirId");

-- CreateIndex
CREATE INDEX "tasks_heirId_idx" ON "tasks"("heirId");

-- CreateIndex
CREATE INDEX "call_logs_heirId_idx" ON "call_logs"("heirId");

-- CreateIndex
CREATE INDEX "emails_heirId_idx" ON "emails"("heirId");

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_heirId_fkey" FOREIGN KEY ("heirId") REFERENCES "surplus_heirs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_heirId_fkey" FOREIGN KEY ("heirId") REFERENCES "surplus_heirs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "call_logs" ADD CONSTRAINT "call_logs_heirId_fkey" FOREIGN KEY ("heirId") REFERENCES "surplus_heirs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "emails" ADD CONSTRAINT "emails_heirId_fkey" FOREIGN KEY ("heirId") REFERENCES "surplus_heirs"("id") ON DELETE SET NULL ON UPDATE CASCADE;


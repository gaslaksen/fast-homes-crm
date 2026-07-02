-- Add Mailgun threading fields to the emails table.
-- Model `Email` is @@map'd to the snake_case table name "emails".
ALTER TABLE "emails" ADD COLUMN "mailgunMessageId" TEXT;
ALTER TABLE "emails" ADD COLUMN "messageIdHeader" TEXT;
ALTER TABLE "emails" ADD COLUMN "inReplyTo" TEXT;

CREATE UNIQUE INDEX "emails_mailgunMessageId_key" ON "emails"("mailgunMessageId");

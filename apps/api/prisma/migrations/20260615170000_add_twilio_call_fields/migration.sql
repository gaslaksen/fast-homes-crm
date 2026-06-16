-- Twilio browser dialer: track Twilio Voice calls in the existing call_logs table
ALTER TABLE "call_logs" ADD COLUMN "twilioCallSid" TEXT;
ALTER TABLE "call_logs" ADD COLUMN "fromNumber" TEXT;
ALTER TABLE "call_logs" ADD COLUMN "toNumber" TEXT;
ALTER TABLE "call_logs" ADD COLUMN "disposition" TEXT;

-- Unique so status/recording callbacks upsert by CallSid without duplicating rows
CREATE UNIQUE INDEX "call_logs_twilioCallSid_key" ON "call_logs"("twilioCallSid");

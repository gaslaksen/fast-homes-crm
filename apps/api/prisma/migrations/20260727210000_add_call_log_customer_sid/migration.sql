-- Track the seller's call leg so ending a browser call can cancel it, including
-- while it is still ringing an unanswered phone.
ALTER TABLE "call_logs" ADD COLUMN IF NOT EXISTS "customerCallSid" TEXT;

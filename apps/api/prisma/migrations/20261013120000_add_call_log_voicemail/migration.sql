-- An inbound call that nobody answered and the caller left a message on the
-- greeting. voicemailReviewedAt is when someone dealt with a voicemail that
-- matched no lead (dismissed it, or attached it to a lead).
ALTER TABLE "call_logs" ADD COLUMN "voicemail" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "call_logs" ADD COLUMN "voicemailReviewedAt" TIMESTAMP(3);

-- A surplus call's outcome in the recovery process's own vocabulary
-- (SurplusCallOutcome), the objection raised, the script versions on screen,
-- and the follow-up date the caller committed to. `disposition` stays as the
-- free label the wholesaling dialer writes.
ALTER TABLE "call_logs" ADD COLUMN "outcome" TEXT;
ALTER TABLE "call_logs" ADD COLUMN "objection" TEXT;
ALTER TABLE "call_logs" ADD COLUMN "scriptVersion" TEXT;
ALTER TABLE "call_logs" ADD COLUMN "voicemailVersion" TEXT;
ALTER TABLE "call_logs" ADD COLUMN "followUpAt" TIMESTAMP(3);

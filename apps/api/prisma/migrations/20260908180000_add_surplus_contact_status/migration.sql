-- Tapped / Not Tapped, and the credibility packet. tappedAt is stamped by the
-- channel that heard from the claimant (an answered call that was them, a
-- text back, an email back), never ticked by hand.
ALTER TABLE "surplus_details" ADD COLUMN "tappedAt" TIMESTAMP(3);
ALTER TABLE "surplus_details" ADD COLUMN "credibilitySentAt" TIMESTAMP(3);
ALTER TABLE "surplus_details" ADD COLUMN "credibilityChannels" TEXT;

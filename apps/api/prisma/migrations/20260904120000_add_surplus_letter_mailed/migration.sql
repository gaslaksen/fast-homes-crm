-- A letter mailed by one of us to a surplus claimant we cannot call. One
-- date and one address per claimant; the Notes tab holds the history. The
-- board reads these to park the claimant in the Letter sent queue so the
-- address is not traced or searched again while the letter is out.
ALTER TABLE "surplus_details" ADD COLUMN "letterMailedAt" TIMESTAMP(3);
ALTER TABLE "surplus_details" ADD COLUMN "letterMailedTo" TEXT;

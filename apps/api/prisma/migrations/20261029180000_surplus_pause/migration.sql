-- A hold can carry a revisit date, which makes it a pause: the daily cadence
-- releases the file on that day. One nullable column; no existing row is
-- written.
ALTER TABLE "surplus_details" ADD COLUMN     "holdUntil" TIMESTAMP(3);

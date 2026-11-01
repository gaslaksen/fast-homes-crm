-- The rifle list: the cases the team has committed to work until each is a
-- yes, a no or a maybe. One nullable column; no existing row is written.
ALTER TABLE "surplus_details" ADD COLUMN     "rifleAt" TIMESTAMP(3);

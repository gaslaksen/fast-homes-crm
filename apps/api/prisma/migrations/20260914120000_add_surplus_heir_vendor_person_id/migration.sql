-- Endato lists a deceased claimant's relatives with an id of their own. A
-- lookup on that id returns exactly that person with a current address and
-- numbers, so the id is kept on the relative's row.
ALTER TABLE "surplus_heirs" ADD COLUMN "vendorPersonId" TEXT;

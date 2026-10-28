-- When a mailed letter came back undeliverable, so the address is not written
-- to again and the claim stops waiting on it. Adds one nullable column to
-- surplus_letters. No existing row is written.

-- AlterTable
ALTER TABLE "surplus_letters" ADD COLUMN     "returnedAt" TIMESTAMP(3);


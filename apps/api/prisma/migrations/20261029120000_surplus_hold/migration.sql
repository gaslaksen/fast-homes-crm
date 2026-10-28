-- A surplus file can be put on hold by a person, with a reason: it drops out
-- of the working queues and its drips wait until it is released. Adds three
-- nullable columns to surplus_details. No existing row is written.

-- AlterTable
ALTER TABLE "surplus_details" ADD COLUMN     "heldAt" TIMESTAMP(3),
ADD COLUMN     "heldByUserId" TEXT,
ADD COLUMN     "holdReason" TEXT;


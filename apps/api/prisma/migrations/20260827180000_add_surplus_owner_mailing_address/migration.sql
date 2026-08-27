-- Where the clerk actually mailed the Notice of Surplus Funds.
--
-- This is the skip-trace target and it is usually NOT the property address.
-- Duval case 2025-0023TD sold a vacant lot in Jacksonville and noticed Myrtis
-- Griffin at 72 Smith Drive, Hartford, CT. Tracing the property instead is what
-- made the first live skip-trace run return six strangers out of six.

-- AlterTable
ALTER TABLE "surplus_details" ADD COLUMN     "noticeRecipient" TEXT,
ADD COLUMN     "ownerAddressSource" TEXT,
ADD COLUMN     "ownerMailingCity" TEXT,
ADD COLUMN     "ownerMailingState" TEXT,
ADD COLUMN     "ownerMailingStreet" TEXT,
ADD COLUMN     "ownerMailingZip" TEXT;

-- The A Tier / B Tier rating off a docket review. Four nullable columns; no
-- existing row is written. The ratings import fills them per case.
ALTER TABLE "surplus_details" ADD COLUMN     "reviewRating" TEXT,
ADD COLUMN     "reviewReason" TEXT,
ADD COLUMN     "reviewRatedBy" TEXT,
ADD COLUMN     "reviewRatedAt" TIMESTAMP(3);

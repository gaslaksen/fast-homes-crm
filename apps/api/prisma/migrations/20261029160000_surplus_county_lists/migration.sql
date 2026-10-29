-- County list tracker: where each county's surplus list comes from, how
-- often it is updated, and when to ask for it next.
ALTER TABLE "surplus_counties" ADD COLUMN     "listNextRequestAt" TIMESTAMP(3),
ADD COLUMN     "listRequestedAt" TIMESTAMP(3),
ADD COLUMN     "listSource" TEXT,
ADD COLUMN     "listUpdateEveryDays" INTEGER,
ADD COLUMN     "listUpdatedAt" TIMESTAMP(3);

-- The notice document last read by vision, so the weekly poll stops paying
-- to read the same notice again when it named nobody on the row.
ALTER TABLE "surplus_details" ADD COLUMN "noticeReadDocId" TEXT;

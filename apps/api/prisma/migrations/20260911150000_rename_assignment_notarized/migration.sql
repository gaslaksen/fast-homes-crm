-- The team's notary package (September 2026) has no assignment of rights:
-- the claimant stays claimant of record, and the limited POA plus the
-- direction to pay are what the notary signs. The stage that waited on the
-- assignment now waits on that package, and the retention instrument
-- defaults to the POA.
UPDATE "surplus_details" SET "stage" = 'Package Notarized' WHERE "stage" = 'Assignment Notarized';

ALTER TABLE "surplus_details" ALTER COLUMN "arrangement" SET DEFAULT 'limited_poa';
UPDATE "surplus_details" SET "arrangement" = 'limited_poa' WHERE "arrangement" = 'assignment' OR "arrangement" IS NULL;

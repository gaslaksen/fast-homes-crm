-- When a phone number or email was last ADDED to this contact. Only an
-- addition moves it: a reorder, a removal or a bad-number flag does not, so
-- the column means "new contact info", not "somebody saved the row".
ALTER TABLE "surplus_details" ADD COLUMN "contactInfoUpdatedAt" TIMESTAMP(3);
ALTER TABLE "surplus_heirs" ADD COLUMN "contactInfoUpdatedAt" TIMESTAMP(3);

-- Backfill, best effort. A trace that found someone is when its numbers
-- arrived. Numbers with no successful trace behind them came in on an import
-- or by hand, and the row's creation date is the closest record we have.
UPDATE "surplus_details" d
SET "contactInfoUpdatedAt" = CASE
    WHEN d."tracedAt" IS NOT NULL
     AND d."traceOutcome" IN ('matched', 'relative', 'unverified', 'likely')
    THEN d."tracedAt"
    ELSE d."createdAt"
  END
FROM "leads" l
WHERE l."id" = d."leadId"
  AND (COALESCE(l."sellerPhone", '') <> ''
    OR COALESCE(l."sellerEmail", '') <> ''
    OR COALESCE(d."phone2", '') <> ''
    OR COALESCE(d."phone3", '') <> ''
    OR COALESCE(d."phone4", '') <> ''
    OR COALESCE(d."email2", '') <> '');

UPDATE "surplus_heirs"
SET "contactInfoUpdatedAt" = CASE
    WHEN "tracedAt" IS NOT NULL
     AND "traceOutcome" IN ('matched', 'relative', 'unverified')
    THEN "tracedAt"
    ELSE "createdAt"
  END
WHERE COALESCE("phone1", '') <> ''
   OR COALESCE("phone2", '') <> ''
   OR COALESCE("phone3", '') <> ''
   OR COALESCE("phone4", '') <> ''
   OR COALESCE("email1", '') <> ''
   OR COALESCE("email2", '') <> '';

-- Disposition v2: remap partner.type to the new allowlist [buyer, jv, title,
-- lender, agent, other]. Partners migrated from non-trivial old values are
-- flagged with needsTypeReview=true so the user can reclassify.

ALTER TABLE "partners" ADD COLUMN "needsTypeReview" BOOLEAN NOT NULL DEFAULT false;

UPDATE "partners" SET "type" = 'jv' WHERE "type" = 'jv_partner';

UPDATE "partners"
SET "type" = 'buyer', "needsTypeReview" = true
WHERE "type" IN ('hedge_fund', 'fix_and_flip');

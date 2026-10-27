-- Read-only. Run after the company tables migration
-- (20261027120000_add_companies_modules_access) is deployed. Every row must
-- show 0 problems.
SELECT 'accounts without both companies' AS check_name, count(*) AS problems
FROM "organizations" o
WHERE (SELECT count(*) FROM "brands" b WHERE b."organizationId" = o."id" AND b."key" IN ('qchb', 'digdeeper')) <> 2

UNION ALL
SELECT 'accounts without all five modules', count(*)
FROM "organizations" o
WHERE (SELECT count(*) FROM "brand_modules" m WHERE m."organizationId" = o."id") <> 5

UNION ALL
SELECT 'surplus funds not run by D.I.G. Deeper', count(*)
FROM "brand_modules" m JOIN "brands" b ON b."id" = m."brandId"
WHERE (m."module" = 'SURPLUS_FUNDS') <> (b."key" = 'digdeeper')

UNION ALL
SELECT 'module run by another account''s company', count(*)
FROM "brand_modules" m JOIN "brands" b ON b."id" = m."brandId"
WHERE b."organizationId" <> m."organizationId"

UNION ALL
SELECT 'users missing a company in their account', count(*)
FROM "users" u JOIN "brands" b ON b."organizationId" = u."organizationId"
WHERE NOT EXISTS (SELECT 1 FROM "user_brands" ub WHERE ub."userId" = u."id" AND ub."brandId" = b."id")

UNION ALL
SELECT 'phone numbers with no company', count(*)
FROM "phone_numbers" WHERE "brandId" IS NULL

UNION ALL
SELECT 'phone numbers on the wrong company', count(*)
FROM "phone_numbers" p JOIN "brands" b ON b."id" = p."brandId"
WHERE (right(regexp_replace(p."number", '\D', '', 'g'), 10) = '9045959620') <> (b."key" = 'digdeeper')

UNION ALL
SELECT 'campaigns with no company', count(*)
FROM "campaigns" WHERE "brandId" IS NULL

UNION ALL
SELECT 'campaigns on another account''s company', count(*)
FROM "campaigns" c JOIN "brands" b ON b."id" = c."brandId"
WHERE c."organizationId" IS NOT NULL AND c."organizationId" <> b."organizationId"

UNION ALL
SELECT 'campaigns enrolling the other company''s leads', count(DISTINCT c."id")
FROM "campaigns" c
JOIN "brands" b ON b."id" = c."brandId"
JOIN "campaign_enrollments" e ON e."campaignId" = c."id"
JOIN "leads" l ON l."id" = e."leadId"
WHERE (l."source" = 'SURPLUS') <> (b."key" = 'digdeeper');

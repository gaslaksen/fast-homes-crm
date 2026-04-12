-- Normalize existing lead names to title case
UPDATE leads SET "sellerFirstName" = INITCAP(TRIM("sellerFirstName"))
WHERE "sellerFirstName" IS NOT NULL AND "sellerFirstName" != '';

UPDATE leads SET "sellerLastName" = INITCAP(TRIM("sellerLastName"))
WHERE "sellerLastName" IS NOT NULL AND "sellerLastName" != '';

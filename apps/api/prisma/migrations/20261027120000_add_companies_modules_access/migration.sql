-- Companies (brands), which company runs which module, and which users can
-- see which company. One login per person, any number of companies.
--
-- Adds tables and two nullable columns, then fills them. No lead or surplus
-- row is written: a lead's company follows from its source through
-- brand_modules, so leads get no column. Nothing reads these tables yet.

-- CreateEnum
CREATE TYPE "ModuleKey" AS ENUM ('PROPERTY_LEADS', 'FORECLOSURES', 'PROBATE', 'TAX_SALES', 'SURPLUS_FUNDS');

-- CreateTable
CREATE TABLE "brands" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "legalName" TEXT NOT NULL,
    "shortName" TEXT,
    "phone" TEXT,
    "phoneE164" TEXT,
    "website" TEXT,
    "websiteUrl" TEXT,
    "address" TEXT,
    "signOff" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "brands_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "brand_modules" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "brandId" TEXT NOT NULL,
    "module" "ModuleKey" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "brand_modules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_brands" (
    "userId" TEXT NOT NULL,
    "brandId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_brands_pkey" PRIMARY KEY ("userId","brandId")
);

-- AlterTable
ALTER TABLE "campaigns" ADD COLUMN "brandId" TEXT;

-- AlterTable
ALTER TABLE "phone_numbers" ADD COLUMN "brandId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "brands_organizationId_key_key" ON "brands"("organizationId", "key");

-- CreateIndex
CREATE INDEX "brand_modules_brandId_idx" ON "brand_modules"("brandId");

-- CreateIndex
CREATE UNIQUE INDEX "brand_modules_organizationId_module_key" ON "brand_modules"("organizationId", "module");

-- CreateIndex
CREATE INDEX "user_brands_brandId_idx" ON "user_brands"("brandId");

-- CreateIndex
CREATE INDEX "campaigns_brandId_idx" ON "campaigns"("brandId");

-- CreateIndex
CREATE INDEX "phone_numbers_brandId_idx" ON "phone_numbers"("brandId");

-- AddForeignKey
ALTER TABLE "brands" ADD CONSTRAINT "brands_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "brand_modules" ADD CONSTRAINT "brand_modules_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "brand_modules" ADD CONSTRAINT "brand_modules_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "brands"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_brands" ADD CONSTRAINT "user_brands_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_brands" ADD CONSTRAINT "user_brands_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "brands"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "brands"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "phone_numbers" ADD CONSTRAINT "phone_numbers_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "brands"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Fill

-- Every existing account gets both companies, worded exactly as
-- common/company.constants.ts has them today.
INSERT INTO "brands" ("id", "organizationId", "key", "legalName", "shortName", "phone", "phoneE164", "website", "websiteUrl", "address", "signOff", "updatedAt")
SELECT 'brand_qchb_' || o."id", o."id", 'qchb', 'Quick Cash Home Buyers', NULL,
       '(888) 574-8121', '+18885748121', 'www.quickcashhomebuyers.com', 'https://www.quickcashhomebuyers.com',
       NULL, false, CURRENT_TIMESTAMP
FROM "organizations" o;

INSERT INTO "brands" ("id", "organizationId", "key", "legalName", "shortName", "phone", "phoneE164", "website", "websiteUrl", "address", "signOff", "updatedAt")
SELECT 'brand_digdeeper_' || o."id", o."id", 'digdeeper', 'D.I.G. Deeper LLC', 'D.I.G. Deeper',
       '(904) 595-9620', '+19045959620', 'digdeeperllc.com', 'https://digdeeperllc.com',
       '7901 4th St N, Suite 300, St. Petersburg, Florida 33702', true, CURRENT_TIMESTAMP
FROM "organizations" o;

-- Surplus funds is D.I.G. Deeper; every other module is Quick Cash. This is
-- brandForLeadSource() as data.
INSERT INTO "brand_modules" ("id", "organizationId", "brandId", "module")
SELECT 'bmod_' || lower(m."module") || '_' || o."id",
       o."id",
       CASE WHEN m."module" = 'SURPLUS_FUNDS' THEN 'brand_digdeeper_' ELSE 'brand_qchb_' END || o."id",
       m."module"::"ModuleKey"
FROM "organizations" o
CROSS JOIN (VALUES ('PROPERTY_LEADS'), ('FORECLOSURES'), ('PROBATE'), ('TAX_SALES'), ('SURPLUS_FUNDS')) AS m("module");

-- Everyone keeps seeing everything: each user gets every company in their
-- account.
INSERT INTO "user_brands" ("userId", "brandId")
SELECT u."id", b."id"
FROM "users" u
JOIN "brands" b ON b."organizationId" = u."organizationId";

-- phone_numbers has no organizationId, so it is only filled when there is
-- exactly one account to take the company from. The Jacksonville line is
-- D.I.G. Deeper, every other number Quick Cash, as brandForNumber() decides.
UPDATE "phone_numbers" p
SET "brandId" = b."id"
FROM "brands" b
WHERE (SELECT count(*) FROM "organizations") = 1
  AND b."key" = CASE
        WHEN right(regexp_replace(p."number", '\D', '', 'g'), 10) = '9045959620' THEN 'digdeeper'
        ELSE 'qchb'
      END;

-- A campaign is D.I.G. Deeper when it texts from the Jacksonville line, or
-- when it has enrollments and every one of them is a surplus lead. Anything
-- else is Quick Cash. A campaign with no account falls back to the only one.
UPDATE "campaigns" c
SET "brandId" = b."id"
FROM "brands" b
WHERE b."organizationId" = COALESCE(
        c."organizationId",
        (SELECT o."id" FROM "organizations" o WHERE (SELECT count(*) FROM "organizations") = 1)
      )
  AND b."key" = CASE
        WHEN right(regexp_replace(coalesce(c."fromNumber", ''), '\D', '', 'g'), 10) = '9045959620' THEN 'digdeeper'
        WHEN EXISTS (SELECT 1 FROM "campaign_enrollments" e WHERE e."campaignId" = c."id")
         AND NOT EXISTS (
               SELECT 1 FROM "campaign_enrollments" e
               JOIN "leads" l ON l."id" = e."leadId"
               WHERE e."campaignId" = c."id" AND l."source" <> 'SURPLUS'
             ) THEN 'digdeeper'
        ELSE 'qchb'
      END;

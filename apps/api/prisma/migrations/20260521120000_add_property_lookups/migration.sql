-- Ad-hoc Comps & Analysis (Phase 1)
-- Adds property_lookups (parent for ad-hoc analyses) and makes the
-- leadId on comp_analyses + comps nullable so an analysis can be owned
-- by either a Lead or a PropertyLookup.
--
-- Table names match the @@map'd snake_case from the Prisma schema.
-- Column casing matches the existing camelCase convention.

-- ── property_lookups ────────────────────────────────────────────────────────
CREATE TABLE "property_lookups" (
  "id"            TEXT PRIMARY KEY,
  "address"       TEXT NOT NULL,
  "city"          TEXT,
  "state"         TEXT,
  "zip"           TEXT,
  "propertyType"  TEXT,
  "bedrooms"      INTEGER,
  "bathrooms"     DOUBLE PRECISION,
  "sqft"          INTEGER,
  "yearBuilt"     INTEGER,
  "lotSize"       DOUBLE PRECISION,
  "latitude"      DOUBLE PRECISION,
  "longitude"     DOUBLE PRECISION,
  "notes"         TEXT,
  "archivedAt"    TIMESTAMP(3),
  "lastRunAt"     TIMESTAMP(3),
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX "property_lookups_archivedAt_idx" ON "property_lookups" ("archivedAt");
CREATE INDEX "property_lookups_createdAt_idx"  ON "property_lookups" ("createdAt");

-- ── comp_analyses: nullable leadId + propertyLookupId ───────────────────────
ALTER TABLE "comp_analyses"
  ALTER COLUMN "leadId" DROP NOT NULL;

ALTER TABLE "comp_analyses"
  ADD COLUMN "propertyLookupId" TEXT;

ALTER TABLE "comp_analyses"
  ADD CONSTRAINT "comp_analyses_propertyLookupId_fkey"
    FOREIGN KEY ("propertyLookupId") REFERENCES "property_lookups"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "comp_analyses_leadId_idx"           ON "comp_analyses" ("leadId");
CREATE INDEX "comp_analyses_propertyLookupId_idx" ON "comp_analyses" ("propertyLookupId");

-- Exactly-one-parent invariant. Existing rows have leadId set, so this is safe.
ALTER TABLE "comp_analyses"
  ADD CONSTRAINT "comp_analyses_parent_xor_chk"
    CHECK (
      ("leadId" IS NOT NULL AND "propertyLookupId" IS NULL) OR
      ("leadId" IS NULL     AND "propertyLookupId" IS NOT NULL)
    );

-- ── comps: nullable leadId + propertyLookupId ───────────────────────────────
ALTER TABLE "comps"
  ALTER COLUMN "leadId" DROP NOT NULL;

ALTER TABLE "comps"
  ADD COLUMN "propertyLookupId" TEXT;

ALTER TABLE "comps"
  ADD CONSTRAINT "comps_propertyLookupId_fkey"
    FOREIGN KEY ("propertyLookupId") REFERENCES "property_lookups"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "comps_propertyLookupId_idx" ON "comps" ("propertyLookupId");

-- Same invariant for comps.
ALTER TABLE "comps"
  ADD CONSTRAINT "comps_parent_xor_chk"
    CHECK (
      ("leadId" IS NOT NULL AND "propertyLookupId" IS NULL) OR
      ("leadId" IS NULL     AND "propertyLookupId" IS NOT NULL)
    );

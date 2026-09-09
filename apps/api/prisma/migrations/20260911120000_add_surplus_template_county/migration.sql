-- A template version can now belong to one county. Null means every
-- county, and a county's own version wins over the general one, so the
-- notary package for Lee (two witnesses, the affidavit) can differ from
-- Duval's without forking every other template.
ALTER TABLE "surplus_templates" ADD COLUMN "county" TEXT;

DROP INDEX "surplus_templates_organizationId_kind_version_key";
CREATE UNIQUE INDEX "surplus_templates_organizationId_kind_county_version_key"
    ON "surplus_templates"("organizationId", "kind", "county", "version");

DROP INDEX "surplus_templates_organizationId_kind_active_idx";
CREATE INDEX "surplus_templates_organizationId_kind_county_active_idx"
    ON "surplus_templates"("organizationId", "kind", "county", "active");

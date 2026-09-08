-- Versioned surplus outreach wording (phone script, voicemail, letters,
-- credibility texts). Versions are immutable per kind so a call log's
-- "phone script v3" names exactly the words that were on screen.
CREATE TABLE "surplus_templates" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT,
    "kind" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "name" TEXT,
    "subject" TEXT,
    "body" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "lastReviewedAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "surplus_templates_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "surplus_templates_organizationId_kind_version_key" ON "surplus_templates"("organizationId", "kind", "version");
CREATE INDEX "surplus_templates_organizationId_kind_active_idx" ON "surplus_templates"("organizationId", "kind", "active");

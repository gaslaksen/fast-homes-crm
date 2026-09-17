-- Social profiles: a third route to a claimant when no phone or address is
-- live. One row per profile, a candidate until a person confirms it, with the
-- search's own evidence kept so the confirmation is a judgement and not a
-- guess. The claimant and each heir carry a stamp for when the search ran.
ALTER TABLE "surplus_details" ADD COLUMN "socialSearchedAt" TIMESTAMP(3);
ALTER TABLE "surplus_details" ADD COLUMN "socialSearch" JSONB;
ALTER TABLE "surplus_heirs" ADD COLUMN "socialSearchedAt" TIMESTAMP(3);

CREATE TABLE "surplus_social_profiles" (
    "id" TEXT NOT NULL,
    "surplusDetailId" TEXT NOT NULL,
    "heirId" TEXT,
    "organizationId" TEXT,
    "platform" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "handle" TEXT,
    "displayName" TEXT,
    "status" TEXT NOT NULL DEFAULT 'candidate',
    "confidence" TEXT,
    "evidence" TEXT,
    "foundBy" TEXT NOT NULL DEFAULT 'manual',
    "messageCount" INTEGER NOT NULL DEFAULT 0,
    "lastMessagedAt" TIMESTAMP(3),
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "surplus_social_profiles_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "surplus_social_profiles_surplusDetailId_url_key" ON "surplus_social_profiles"("surplusDetailId", "url");
CREATE INDEX "surplus_social_profiles_surplusDetailId_status_idx" ON "surplus_social_profiles"("surplusDetailId", "status");
CREATE INDEX "surplus_social_profiles_heirId_idx" ON "surplus_social_profiles"("heirId");

ALTER TABLE "surplus_social_profiles" ADD CONSTRAINT "surplus_social_profiles_surplusDetailId_fkey" FOREIGN KEY ("surplusDetailId") REFERENCES "surplus_details"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "surplus_social_profiles" ADD CONSTRAINT "surplus_social_profiles_heirId_fkey" FOREIGN KEY ("heirId") REFERENCES "surplus_heirs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- One document per kind per surplus claim, with the file attached when
-- there is one. Replaces the `docs` JSON booleans on surplus_details, which
-- are backfilled below as received documents with no file.
CREATE TABLE "surplus_documents" (
    "id" TEXT NOT NULL,
    "surplusDetailId" TEXT NOT NULL,
    "organizationId" TEXT,
    "kind" TEXT NOT NULL,
    "docSet" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'outstanding',
    "fileKey" TEXT,
    "fileName" TEXT,
    "contentType" TEXT,
    "size" INTEGER,
    "templateKind" TEXT,
    "templateVersion" INTEGER,
    "signedAt" TIMESTAMP(3),
    "notarizedAt" TIMESTAMP(3),
    "filedAt" TIMESTAMP(3),
    "note" TEXT,
    "uploadedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "surplus_documents_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "surplus_documents_surplusDetailId_kind_key" ON "surplus_documents"("surplusDetailId", "kind");
CREATE INDEX "surplus_documents_organizationId_kind_idx" ON "surplus_documents"("organizationId", "kind");

ALTER TABLE "surplus_documents" ADD CONSTRAINT "surplus_documents_surplusDetailId_fkey"
    FOREIGN KEY ("surplusDetailId") REFERENCES "surplus_details"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- The county's own claim form as a stored file.
ALTER TABLE "surplus_counties" ADD COLUMN "claimFormKey" TEXT;
ALTER TABLE "surplus_counties" ADD COLUMN "claimFormName" TEXT;

-- Backfill: every `docs` flag somebody ticked becomes a received document
-- with no file, so the checklist starts from what the team already had.
INSERT INTO "surplus_documents" ("id", "surplusDetailId", "organizationId", "kind", "docSet", "status", "note", "createdAt", "updatedAt")
SELECT
    'sdoc_' || md5(random()::text || clock_timestamp()::text || d."id" || m.kind),
    d."id",
    d."organizationId",
    m.kind,
    m.doc_set,
    'received',
    'Carried over from the old checklist',
    now(),
    now()
FROM "surplus_details" d
CROSS JOIN LATERAL (
    VALUES
        ('claimForm', 'county_claim_form', 'county'),
        ('photoId', 'photo_id', 'claimant'),
        ('proofOwnership', 'proof_of_ownership', 'claimant'),
        ('w9', 'w9', 'claimant'),
        ('feeAgreement', 'fee_agreement', 'ours'),
        ('titleSearch', 'title_search', 'ours'),
        ('deathCert', 'death_certificate', 'claimant'),
        ('letters', 'letters_of_administration', 'claimant')
) AS m(flag, kind, doc_set)
WHERE d."docs" IS NOT NULL
  AND jsonb_typeof(d."docs") = 'object'
  AND (d."docs" ->> m.flag) = 'true';

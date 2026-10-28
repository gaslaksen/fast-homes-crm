-- Skip-trace batches: each IDI export is saved with the rows it sent, so the
-- people in it can be found again and a results file can be matched back on
-- the exact name and address it echoes.
--
-- Adds two tables. No existing row is written or changed.

-- CreateTable
CREATE TABLE "surplus_batches" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT,
    "number" INTEGER NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'idi_export',
    "fileName" TEXT NOT NULL,
    "createdByUserId" TEXT,
    "rowCount" INTEGER NOT NULL DEFAULT 0,
    "skippedCount" INTEGER NOT NULL DEFAULT 0,
    "resultsAppliedAt" TIMESTAMP(3),
    "resultsFileName" TEXT,
    "resultsAppliedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "surplus_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "surplus_batch_members" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "surplusDetailId" TEXT NOT NULL,
    "organizationId" TEXT,
    "rowNumber" INTEGER NOT NULL,
    "sentFirst" TEXT NOT NULL,
    "sentLast" TEXT NOT NULL,
    "sentStreet" TEXT NOT NULL,
    "sentCity" TEXT NOT NULL,
    "sentState" TEXT NOT NULL,
    "sentZip" TEXT NOT NULL,
    "result" TEXT,
    "deceased" BOOLEAN NOT NULL DEFAULT false,
    "phonesReturned" INTEGER NOT NULL DEFAULT 0,
    "emailsReturned" INTEGER NOT NULL DEFAULT 0,
    "relativesFiled" INTEGER NOT NULL DEFAULT 0,
    "appliedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "surplus_batch_members_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "surplus_batches_organizationId_createdAt_idx" ON "surplus_batches"("organizationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "surplus_batches_organizationId_number_key" ON "surplus_batches"("organizationId", "number");

-- CreateIndex
CREATE INDEX "surplus_batch_members_surplusDetailId_idx" ON "surplus_batch_members"("surplusDetailId");

-- CreateIndex
CREATE UNIQUE INDEX "surplus_batch_members_batchId_rowNumber_key" ON "surplus_batch_members"("batchId", "rowNumber");

-- AddForeignKey
ALTER TABLE "surplus_batch_members" ADD CONSTRAINT "surplus_batch_members_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "surplus_batches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "surplus_batch_members" ADD CONSTRAINT "surplus_batch_members_surplusDetailId_fkey" FOREIGN KEY ("surplusDetailId") REFERENCES "surplus_details"("id") ON DELETE CASCADE ON UPDATE CASCADE;


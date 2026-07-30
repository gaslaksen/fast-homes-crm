-- CreateTable: one uploaded filing per row. Stores extracted text, never the
-- PDF bytes. Keys on caseNumber so several filings can share one case.
CREATE TABLE "foreclosure_documents" (
    "id" TEXT NOT NULL,
    "leadId" TEXT,
    "organizationId" TEXT,
    "fileHash" TEXT NOT NULL,
    "originalFilename" TEXT,
    "fileSizeBytes" INTEGER,
    "fileKey" TEXT,
    "caseNumber" TEXT,
    "county" TEXT,
    "documentType" TEXT,
    "noticeUrl" TEXT,
    "pageCount" INTEGER,
    "extractionMethod" TEXT,
    "rawText" TEXT,
    "charsPerPage" DOUBLE PRECISION,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "extractedAt" TIMESTAMP(3),
    "extractionError" TEXT,

    CONSTRAINT "foreclosure_documents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "foreclosure_documents_organizationId_fileHash_key" ON "foreclosure_documents"("organizationId", "fileHash");

-- CreateIndex
CREATE INDEX "foreclosure_documents_organizationId_caseNumber_idx" ON "foreclosure_documents"("organizationId", "caseNumber");

-- CreateIndex
CREATE INDEX "foreclosure_documents_leadId_uploadedAt_idx" ON "foreclosure_documents"("leadId", "uploadedAt" DESC);

-- AddForeignKey
ALTER TABLE "foreclosure_documents" ADD CONSTRAINT "foreclosure_documents_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

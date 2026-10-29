-- CreateTable
CREATE TABLE "surplus_touches" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT,
    "leadId" TEXT NOT NULL,
    "heirId" TEXT,
    "kind" TEXT NOT NULL,
    "note" TEXT,
    "userId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "surplus_touches_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "surplus_touches_leadId_createdAt_idx" ON "surplus_touches"("leadId", "createdAt");

-- CreateIndex
CREATE INDEX "surplus_touches_heirId_idx" ON "surplus_touches"("heirId");

-- AddForeignKey
ALTER TABLE "surplus_touches" ADD CONSTRAINT "surplus_touches_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "surplus_touches" ADD CONSTRAINT "surplus_touches_heirId_fkey" FOREIGN KEY ("heirId") REFERENCES "surplus_heirs"("id") ON DELETE CASCADE ON UPDATE CASCADE;


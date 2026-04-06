-- CreateTable
CREATE TABLE "partners" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "company" TEXT,
    "phone" TEXT,
    "type" TEXT NOT NULL DEFAULT 'buyer',
    "tags" JSONB NOT NULL DEFAULT '[]',
    "notes" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastSharedAt" TIMESTAMP(3),
    "shareCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "partners_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deal_shares" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "partnerId" TEXT NOT NULL,
    "sharedByUserId" TEXT NOT NULL,
    "channel" TEXT NOT NULL DEFAULT 'resend',
    "viewToken" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'sent',
    "openedAt" TIMESTAMP(3),
    "openCount" INTEGER NOT NULL DEFAULT 0,
    "lastOpenedAt" TIMESTAMP(3),
    "snapshotArv" DOUBLE PRECISION,
    "snapshotRepairCosts" DOUBLE PRECISION,
    "snapshotMao" DOUBLE PRECISION,
    "snapshotAskingPrice" DOUBLE PRECISION,
    "snapshotAssignmentFee" DOUBLE PRECISION,
    "snapshotDealType" TEXT,
    "emailSubject" TEXT,
    "personalNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "deal_shares_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "partners_organizationId_email_key" ON "partners"("organizationId", "email");

-- CreateIndex
CREATE UNIQUE INDEX "deal_shares_viewToken_key" ON "deal_shares"("viewToken");

-- CreateIndex
CREATE INDEX "deal_shares_leadId_idx" ON "deal_shares"("leadId");

-- CreateIndex
CREATE INDEX "deal_shares_partnerId_idx" ON "deal_shares"("partnerId");

-- CreateIndex
CREATE INDEX "deal_shares_viewToken_idx" ON "deal_shares"("viewToken");

-- AddForeignKey
ALTER TABLE "deal_shares" ADD CONSTRAINT "deal_shares_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deal_shares" ADD CONSTRAINT "deal_shares_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "partners"("id") ON DELETE CASCADE ON UPDATE CASCADE;

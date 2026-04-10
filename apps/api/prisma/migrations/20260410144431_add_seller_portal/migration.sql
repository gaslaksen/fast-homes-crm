-- AlterTable
ALTER TABLE "offers" ADD COLUMN     "sellerRespondedAt" TIMESTAMP(3),
ADD COLUMN     "terms" TEXT,
ADD COLUMN     "visibleOnPortal" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "seller_portals" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "viewToken" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "portalLinkSentAt" TIMESTAMP(3),
    "openedAt" TIMESTAMP(3),
    "openCount" INTEGER NOT NULL DEFAULT 0,
    "lastOpenedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "seller_portals_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "seller_portals_leadId_key" ON "seller_portals"("leadId");

-- CreateIndex
CREATE UNIQUE INDEX "seller_portals_viewToken_key" ON "seller_portals"("viewToken");

-- AddForeignKey
ALTER TABLE "seller_portals" ADD CONSTRAINT "seller_portals_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

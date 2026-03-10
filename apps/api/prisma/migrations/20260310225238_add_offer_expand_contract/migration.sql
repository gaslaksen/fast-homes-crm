-- AlterTable
ALTER TABLE "contracts" ADD COLUMN     "contractStatus" TEXT NOT NULL DEFAULT 'draft',
ADD COLUMN     "earnestMoney" DOUBLE PRECISION,
ADD COLUMN     "exitStrategy" TEXT NOT NULL DEFAULT 'wholesale',
ADD COLUMN     "inspectionPeriodDays" INTEGER,
ADD COLUMN     "offerAmount" DOUBLE PRECISION,
ADD COLUMN     "sellerFinancing" BOOLEAN NOT NULL DEFAULT false,
ALTER COLUMN "contractDate" DROP NOT NULL;

-- CreateTable
CREATE TABLE "offers" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "offerAmount" DOUBLE PRECISION NOT NULL,
    "offerDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "counterAmount" DOUBLE PRECISION,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "offers_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "offers" ADD CONSTRAINT "offers_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

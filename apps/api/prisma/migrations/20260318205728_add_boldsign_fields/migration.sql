-- AlterTable
ALTER TABLE "contracts" ADD COLUMN     "boldsignDocumentId" TEXT,
ADD COLUMN     "boldsignSentAt" TIMESTAMP(3),
ADD COLUMN     "boldsignSigningUrl" TEXT,
ADD COLUMN     "boldsignStatus" TEXT;

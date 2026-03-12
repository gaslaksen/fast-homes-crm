-- AlterTable
ALTER TABLE "leads" ADD COLUMN     "autoRespond" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "autoResponseCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "autoResponseDate" TIMESTAMP(3),
ADD COLUMN     "campAuthorityComplete" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "campChallengeComplete" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "campMoneyComplete" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "campPriorityComplete" BOOLEAN NOT NULL DEFAULT false;

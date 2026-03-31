-- AlterTable
ALTER TABLE "users" ADD COLUMN "passwordResetExpires" TIMESTAMP(3),
ADD COLUMN "passwordResetToken" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "users_passwordResetToken_key" ON "users"("passwordResetToken");

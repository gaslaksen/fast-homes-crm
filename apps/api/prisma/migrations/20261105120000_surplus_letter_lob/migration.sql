-- Lob, the mail house: which Lob letter an envelope is, and where it is.
ALTER TABLE "surplus_letters" ADD COLUMN     "deliveredAt" TIMESTAMP(3),
ADD COLUMN     "expectedDeliveryAt" TIMESTAMP(3),
ADD COLUMN     "lobEventAt" TIMESTAMP(3),
ADD COLUMN     "lobLetterId" TEXT,
ADD COLUMN     "lobStatus" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "surplus_letters_lobLetterId_key" ON "surplus_letters"("lobLetterId");

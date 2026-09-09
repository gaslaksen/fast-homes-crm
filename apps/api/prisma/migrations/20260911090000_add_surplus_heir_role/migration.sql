-- An heir row can now be anybody who might know where the claimant is: a
-- relative, a neighbor, a friend, a former associate. The role keeps the
-- signer count honest (only a heir can file) and the contact status records
-- whether that person has been reached and whether they passed a message on.
ALTER TABLE "surplus_heirs" ADD COLUMN "role" TEXT NOT NULL DEFAULT 'heir';
ALTER TABLE "surplus_heirs" ADD COLUMN "contactStatus" TEXT NOT NULL DEFAULT 'not_contacted';
ALTER TABLE "surplus_heirs" ADD COLUMN "lastContactedAt" TIMESTAMP(3);

CREATE INDEX "surplus_heirs_surplusDetailId_role_idx" ON "surplus_heirs"("surplusDetailId", "role");

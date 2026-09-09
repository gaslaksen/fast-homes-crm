-- The mobile notary on a surplus claim: who they are, when they signed the
-- instruction sheet (the gate before an appointment is booked), the
-- appointment, and the confirmation that everything was signed in order.
ALTER TABLE "surplus_details" ADD COLUMN "notaryName" TEXT;
ALTER TABLE "surplus_details" ADD COLUMN "notaryPhone" TEXT;
ALTER TABLE "surplus_details" ADD COLUMN "notaryEmail" TEXT;
ALTER TABLE "surplus_details" ADD COLUMN "notarySource" TEXT;
ALTER TABLE "surplus_details" ADD COLUMN "notaryNotes" TEXT;
ALTER TABLE "surplus_details" ADD COLUMN "notaryAgreementSignedAt" TIMESTAMP(3);
ALTER TABLE "surplus_details" ADD COLUMN "notaryAppointmentAt" TIMESTAMP(3);
ALTER TABLE "surplus_details" ADD COLUMN "notaryAppointmentPlace" TEXT;
ALTER TABLE "surplus_details" ADD COLUMN "notarySignedInOrderAt" TIMESTAMP(3);

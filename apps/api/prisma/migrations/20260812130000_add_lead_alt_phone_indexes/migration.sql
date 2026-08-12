-- Inbound texts and calls carry only a phone number. A seller may answer from
-- any of the numbers skip trace attached, so routing has to look past
-- leads.sellerPhone into the detail rows. Index those columns so the lookup
-- does not sequentially scan the detail tables on every inbound webhook.
CREATE INDEX "foreclosure_details_phone2_idx" ON "foreclosure_details"("phone2");
CREATE INDEX "foreclosure_details_phone3_idx" ON "foreclosure_details"("phone3");
CREATE INDEX "foreclosure_details_phone4_idx" ON "foreclosure_details"("phone4");
CREATE INDEX "probate_details_phone2_idx" ON "probate_details"("phone2");

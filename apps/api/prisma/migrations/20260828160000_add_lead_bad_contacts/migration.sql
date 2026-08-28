-- Contacts that have been tried and do not reach the person.
--
-- Values rather than slot positions: a skip trace rewrites the phone2..phone4
-- slots in whatever order the vendor returned them, so a flag pinned to a slot
-- would silently start describing a different number.
ALTER TABLE "leads" ADD COLUMN "badContacts" JSONB;

-- Disposition v2: rename pipeline status CLOSED_WON -> SOLD across all leads.
-- Application code is updated atomically with this migration. CLOSED_LOST is
-- preserved (still means deal lost pre-acquisition). New outcome statuses
-- SOLD_LOSS / HELD_LONG_TERM / CANCELLED and the new pipeline stage ACQUIRED
-- are surfaced in the application layer; status remains a free String column.

UPDATE "leads" SET "status" = 'SOLD' WHERE "status" = 'CLOSED_WON';

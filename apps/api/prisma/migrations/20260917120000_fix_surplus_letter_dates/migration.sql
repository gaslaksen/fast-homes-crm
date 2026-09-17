-- Letter dates picked in the panel and the letter page were stored at midnight
-- UTC, which is 8pm the evening before in Eastern time, so every one displayed
-- a day early. New ones are stored at noon UTC. This moves the existing ones to
-- noon UTC on the same calendar day. Data only, no schema change.
--
-- Only exact midnight UTC values are touched. A letter marked from the board's
-- bulk action carries its real time of day and is left alone.

UPDATE "surplus_letters"
SET "mailedAt" = "mailedAt" + INTERVAL '12 hours'
WHERE "mailedAt"::time = '00:00:00';

-- The cached latest letter on the claim, and the claimant update it stamped
-- when the letter went to the claimant (same value, so moved together). The
-- right-hand sides read the old row, so the comparison sees the old value.
UPDATE "surplus_details"
SET "letterMailedAt" = "letterMailedAt" + INTERVAL '12 hours',
    "lastClaimantUpdateAt" = CASE
      WHEN "lastClaimantUpdateAt" = "letterMailedAt" THEN "lastClaimantUpdateAt" + INTERVAL '12 hours'
      ELSE "lastClaimantUpdateAt"
    END
WHERE "letterMailedAt" IS NOT NULL
  AND "letterMailedAt"::time = '00:00:00';

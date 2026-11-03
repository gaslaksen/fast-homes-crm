-- Start the IDI retry rounds from what the batches already sent. Data only,
-- no schema change. Each address an earlier batch carried is marked with what
-- IDI said: 'hit' when it placed the person there, 'sent' while the batch is
-- still out, 'miss' when it could not. An address a batch sent that is not on
-- the claimant's list yet (the property, mostly) is added as 'idi_sent', so
-- the next round does not send it again. The key matches surplusAddressKey in
-- surplus-address.util.ts.
WITH sent AS (
    SELECT
        m."surplusDetailId",
        upper(regexp_replace(m."sentStreet", '[^A-Za-z0-9]', '', 'g')) || '|' ||
            left(regexp_replace(COALESCE(m."sentZip", ''), '[^0-9]', '', 'g'), 5) AS "addressKey",
        (array_agg(m."sentStreet" ORDER BY m."createdAt" DESC))[1] AS "street",
        (array_agg(m."sentCity" ORDER BY m."createdAt" DESC))[1] AS "city",
        (array_agg(m."sentState" ORDER BY m."createdAt" DESC))[1] AS "state",
        (array_agg(m."sentZip" ORDER BY m."createdAt" DESC))[1] AS "zip",
        min(m."createdAt") AS "firstSentAt",
        CASE
            WHEN bool_or(m."result" IN ('matched', 'no_contact')) THEN 'hit'
            WHEN bool_or(m."result" IS NULL) THEN 'sent'
            ELSE 'miss'
        END AS "status"
    FROM "surplus_batch_members" m
    WHERE btrim(COALESCE(m."sentStreet", '')) <> ''
    GROUP BY 1, 2
)
INSERT INTO "surplus_addresses" (
    "id", "surplusDetailId", "organizationId", "street", "city", "state", "zip",
    "source", "addressKey", "status", "firstSeenAt", "updatedAt"
)
SELECT
    'sad_' || md5(random()::text || clock_timestamp()::text || s."surplusDetailId" || s."addressKey"),
    s."surplusDetailId",
    d."organizationId",
    s."street",
    NULLIF(s."city", ''),
    NULLIF(s."state", ''),
    NULLIF(s."zip", ''),
    'idi_sent',
    s."addressKey",
    s."status",
    s."firstSentAt",
    CURRENT_TIMESTAMP
FROM sent s
JOIN "surplus_details" d ON d."id" = s."surplusDetailId"
ON CONFLICT ("surplusDetailId", "addressKey") DO UPDATE
    SET "status" = EXCLUDED."status", "updatedAt" = CURRENT_TIMESTAMP;

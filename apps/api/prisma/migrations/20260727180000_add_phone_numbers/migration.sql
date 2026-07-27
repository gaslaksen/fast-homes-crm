-- Sending numbers, managed in Settings instead of the TWILIO_CALLER_IDS env var.
-- Rows are seeded from that env var on first boot, so this migration only needs
-- to create the table.

CREATE TABLE IF NOT EXISTS "phone_numbers" (
    "id"           TEXT         NOT NULL,
    "number"       TEXT         NOT NULL,
    "label"        TEXT         NOT NULL,
    "smsEnabled"   BOOLEAN      NOT NULL DEFAULT true,
    "voiceEnabled" BOOLEAN      NOT NULL DEFAULT true,
    "isDefault"    BOOLEAN      NOT NULL DEFAULT false,
    "active"       BOOLEAN      NOT NULL DEFAULT true,
    "sortOrder"    INTEGER      NOT NULL DEFAULT 0,
    "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"    TIMESTAMP(3) NOT NULL,

    CONSTRAINT "phone_numbers_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "phone_numbers_number_key" ON "phone_numbers"("number");
CREATE INDEX IF NOT EXISTS "phone_numbers_active_sortOrder_idx" ON "phone_numbers"("active", "sortOrder");

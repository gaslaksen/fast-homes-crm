-- Mobile push notifications: register devices per user for APNs alerts and Twilio VoIP push.
CREATE TABLE "push_devices" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "organizationId" TEXT,
    "platform" TEXT NOT NULL DEFAULT 'ios',
    "apnsToken" TEXT,
    "voipToken" TEXT,
    "appVersion" TEXT,
    "deviceName" TEXT,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "push_devices_pkey" PRIMARY KEY ("id")
);

-- One row per (user, apns token); lets register upsert without duplicating devices.
CREATE UNIQUE INDEX "push_devices_userId_apnsToken_key" ON "push_devices"("userId", "apnsToken");
CREATE INDEX "push_devices_userId_idx" ON "push_devices"("userId");
CREATE INDEX "push_devices_organizationId_idx" ON "push_devices"("organizationId");

ALTER TABLE "push_devices" ADD CONSTRAINT "push_devices_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

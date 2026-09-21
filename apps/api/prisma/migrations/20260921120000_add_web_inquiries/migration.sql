-- Call-back requests from a public brand website (digdeeperllc.com). A new,
-- standalone table: nothing references it and it references nothing, so it
-- cannot affect lead queries. It is also the A2P opt-in record, holding the
-- consent boxes ticked, the wording agreed to, the time and the sender's
-- network address.
CREATE TABLE "web_inquiries" (
    "id" TEXT NOT NULL,
    "site" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "city" TEXT,
    "state" TEXT,
    "message" TEXT,
    "smsMarketingConsent" BOOLEAN NOT NULL DEFAULT false,
    "smsServiceConsent" BOOLEAN NOT NULL DEFAULT false,
    "consentVersion" TEXT,
    "consentText" TEXT,
    "consentedAt" TIMESTAMP(3),
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "pageUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "web_inquiries_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "web_inquiries_site_createdAt_idx" ON "web_inquiries"("site", "createdAt");

CREATE INDEX "web_inquiries_phone_idx" ON "web_inquiries"("phone");

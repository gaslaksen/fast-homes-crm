-- CreateTable
CREATE TABLE "drip_sequences" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "currentStep" INTEGER NOT NULL DEFAULT 0,
    "hasTimeline" BOOLEAN NOT NULL DEFAULT false,
    "hasCondition" BOOLEAN NOT NULL DEFAULT false,
    "hasOwnership" BOOLEAN NOT NULL DEFAULT false,
    "hasAskingPrice" BOOLEAN NOT NULL DEFAULT false,
    "initialDelayMs" INTEGER NOT NULL DEFAULT 60000,
    "retryDelayMs" INTEGER NOT NULL DEFAULT 86400000,
    "maxRetries" INTEGER NOT NULL DEFAULT 2,
    "currentRetries" INTEGER NOT NULL DEFAULT 0,
    "lastMessageAt" TIMESTAMP(3),
    "lastReplyAt" TIMESTAMP(3),
    "pausedReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "drip_sequences_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "drip_sequences_leadId_key" ON "drip_sequences"("leadId");

-- AddForeignKey
ALTER TABLE "drip_sequences" ADD CONSTRAINT "drip_sequences_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

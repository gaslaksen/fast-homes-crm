-- CreateEnum
CREATE TYPE "CampaignChannel" AS ENUM ('TEXT', 'EMAIL');

-- CreateEnum
CREATE TYPE "EnrollmentStatus" AS ENUM ('ACTIVE', 'PAUSED', 'COMPLETED', 'REPLIED', 'OPTED_OUT', 'REMOVED');

-- CreateEnum
CREATE TYPE "DripMessageStatus" AS ENUM ('SENT', 'DELIVERED', 'BOUNCED', 'FAILED', 'OPENED', 'CLICKED', 'REPLIED');

-- CreateTable
CREATE TABLE "campaigns" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "triggerDays" INTEGER NOT NULL DEFAULT 15,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "organizationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "campaigns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "campaign_steps" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "stepOrder" INTEGER NOT NULL,
    "channel" "CampaignChannel" NOT NULL,
    "delayDays" INTEGER NOT NULL DEFAULT 0,
    "delayHours" INTEGER NOT NULL DEFAULT 0,
    "sendWindowStart" TEXT,
    "sendWindowEnd" TEXT,
    "subject" TEXT,
    "body" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "campaign_steps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "campaign_enrollments" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "enrolledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "currentStepOrder" INTEGER NOT NULL DEFAULT 0,
    "status" "EnrollmentStatus" NOT NULL DEFAULT 'ACTIVE',
    "nextSendAt" TIMESTAMP(3),
    "lastContactAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "campaign_enrollments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "campaign_message_logs" (
    "id" TEXT NOT NULL,
    "enrollmentId" TEXT NOT NULL,
    "stepId" TEXT NOT NULL,
    "channel" "CampaignChannel" NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "messageBody" TEXT NOT NULL,
    "status" "DripMessageStatus" NOT NULL DEFAULT 'SENT',
    "externalId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "campaign_message_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "campaign_enrollments_campaignId_leadId_key" ON "campaign_enrollments"("campaignId", "leadId");

-- AddForeignKey
ALTER TABLE "campaign_steps" ADD CONSTRAINT "campaign_steps_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_enrollments" ADD CONSTRAINT "campaign_enrollments_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_enrollments" ADD CONSTRAINT "campaign_enrollments_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_message_logs" ADD CONSTRAINT "campaign_message_logs_enrollmentId_fkey" FOREIGN KEY ("enrollmentId") REFERENCES "campaign_enrollments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_message_logs" ADD CONSTRAINT "campaign_message_logs_stepId_fkey" FOREIGN KEY ("stepId") REFERENCES "campaign_steps"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

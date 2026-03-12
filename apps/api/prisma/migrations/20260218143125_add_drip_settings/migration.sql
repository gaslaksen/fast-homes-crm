-- CreateTable
CREATE TABLE "drip_settings" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "initialDelayMs" INTEGER NOT NULL DEFAULT 60000,
    "nextQuestionDelayMs" INTEGER NOT NULL DEFAULT 30000,
    "retryDelayMs" INTEGER NOT NULL DEFAULT 86400000,
    "maxRetries" INTEGER NOT NULL DEFAULT 2,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "drip_settings_pkey" PRIMARY KEY ("id")
);

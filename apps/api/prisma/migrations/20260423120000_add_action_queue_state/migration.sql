-- CreateTable
CREATE TABLE "action_dismissals" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "actionKey" TEXT NOT NULL,
    "dismissedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "action_dismissals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "action_snoozes" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "actionKey" TEXT NOT NULL,
    "snoozedUntil" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "action_snoozes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "action_last_seen" (
    "userId" TEXT NOT NULL,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "action_last_seen_pkey" PRIMARY KEY ("userId")
);

-- CreateIndex
CREATE INDEX "action_dismissals_userId_idx" ON "action_dismissals"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "action_dismissals_userId_actionKey_key" ON "action_dismissals"("userId", "actionKey");

-- CreateIndex
CREATE INDEX "action_snoozes_userId_snoozedUntil_idx" ON "action_snoozes"("userId", "snoozedUntil");

-- CreateIndex
CREATE UNIQUE INDEX "action_snoozes_userId_actionKey_key" ON "action_snoozes"("userId", "actionKey");

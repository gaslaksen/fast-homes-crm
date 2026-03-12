-- CreateTable
CREATE TABLE "ai_prompts" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "scenario" TEXT NOT NULL,
    "contextRules" JSONB NOT NULL,
    "systemPrompt" TEXT NOT NULL,
    "exampleMessages" JSONB,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_prompts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ai_prompts_scenario_key" ON "ai_prompts"("scenario");

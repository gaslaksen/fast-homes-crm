-- Rename AI persona from "Ian" to "Dax" in ai_prompts table
UPDATE ai_prompts
SET "systemPrompt" = REPLACE("systemPrompt", 'Ian', 'Dax'),
    "updatedAt" = NOW()
WHERE "systemPrompt" LIKE '%Ian%';

UPDATE ai_prompts
SET "exampleMessages" = REPLACE("exampleMessages"::text, 'Ian', 'Dax')::jsonb,
    "updatedAt" = NOW()
WHERE "exampleMessages"::text LIKE '%Ian%';

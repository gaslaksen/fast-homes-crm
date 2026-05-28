-- Internal comments: team-only notes rendered inline in the timeline, with @mentions
ALTER TABLE "notes" ADD COLUMN "isInternalComment" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "notes" ADD COLUMN "mentions" JSONB;

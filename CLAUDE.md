# CLAUDE.md

Guidance for Claude Code (and any AI agent) working in this repository. These
rules apply to every change. Read them before editing.

## What this is

Dealcore (package name `fast-homes-crm`) is a property wholesaling CRM with
AI-assisted texting, lead scoring, and comps. Monorepo built with pnpm and
Turborepo.

- `apps/api` NestJS backend (TypeScript, Prisma, PostgreSQL)
- `apps/web` Next.js 14 frontend (App Router, Tailwind)
- `packages/shared` shared types and utilities
- `apps/mobile` standalone Expo app, excluded from the workspace, ships via EAS

## Stack

- DB: Prisma ORM + PostgreSQL
- Queue: BullMQ + Redis (drip sequences)
- SMS: Twilio (the SMS provider)
- Email: Mailgun (inbound + outbound)
- AI: Anthropic Claude via `@anthropic-ai/sdk`, key `ANTHROPIC_API_KEY`
  (`claude-haiku-4-5` for extraction, `claude-sonnet-4-5` for drafts)
- Voice AI: Vapi, plus a Twilio browser dialer
- Comps: RentCast (primary), ATTOM, ChatARV, placeholder fallback

## House rules (do not break these)

1. **No dashes, anywhere.** Never use em dashes or en dashes in code, comments,
   commit messages, PR descriptions, or docs. Use a plain ASCII hyphen or split
   into two sentences. No exceptions.

2. **Schema changes require a migration file.** If you edit
   `apps/api/prisma/schema.prisma`, generate and commit a Prisma migration
   (`pnpm db:migrate`). Railway runs `prisma migrate deploy` on every deploy,
   which applies migration files but does NOT diff the schema. A schema change
   without a committed migration silently no-ops in production, drifts the DB,
   and crashes lead queries.

3. **Hand-written migrations use the `@@map`'d snake_case table name.** For
   example `model Lead` maps to table `"leads"`, so write
   `ALTER TABLE "leads"`, never `ALTER TABLE "Lead"`.

4. **Verify before changing.** Research the existing code, propose the change,
   confirm, then implement. Do not guess on anything touching live leads,
   messaging, or the database.

## Deployment

- Branch `master` auto-deploys. Merging to `master` IS a production deploy.
- API deploys to Railway (Dockerfile at `apps/api/Dockerfile`); Postgres and
  Redis are Railway services. Prod API is served at `https://api.mydealcore.com`.
- Web deploys to Vercel.
- Work on a branch, open a PR against `master`, get it reviewed, then merge.
  Never push directly to `master`.

## Local development

```bash
pnpm install
docker-compose up -d      # local Postgres + Redis
cp apps/api/.env.example apps/api/.env   # then fill in secrets
pnpm db:migrate
pnpm db:seed
pnpm dev                  # api :3001, web :3000
```

`apps/api/.env.example` is the authoritative list of environment variables.
Missing integration keys degrade gracefully (the app logs a warning and disables
that feature). Set `SMS_TEST_MODE="true"` locally so testing never texts a real
lead.

## Messaging systems (these overlap, be careful)

- `sendInitialOutreach()` in `apps/api/src/messages/messages.service.ts` sends
  the first message to a new lead.
- Drip service (`apps/api/src/drip/drip.service.ts`) runs the CAMP question
  sequence over BullMQ. Its `handleReply()` yields to auto-response when
  `lead.autoRespond` is true.
- `sendAutoResponse()` in `messages.service.ts` sends the context-aware
  follow-up after an inbound message.

When `autoRespond` is true, inbound handling cancels any pending drip job before
auto-responding, so the two systems do not both message the lead.

## Key files

- `apps/api/src/messages/messages.service.ts` core messaging
- `apps/api/src/scoring/scoring.service.ts` CAMP scoring, AI extraction, drafts
- `apps/api/src/drip/` drip sequence management
- `apps/api/src/leads/leads.service.ts` lead CRUD, schedules initial outreach
- `apps/api/src/webhooks/webhooks.controller.ts` provider webhooks
- `apps/api/prisma/` schema, migrations, seed

## Before opening a PR

Run `pnpm build`, `pnpm test`, and `pnpm lint`. If you touched the schema,
confirm the migration file is committed. Never commit secrets or `.env` files.

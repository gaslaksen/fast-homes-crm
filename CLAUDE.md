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

## Traps that have broken production before

- **The web app never imports `@fast-homes/shared` at runtime.** Vercel runs
  `pnpm --filter web build` (plain `next build`) and `packages/shared/dist` is
  never built there, so a runtime import fails the deploy while every local
  check passes. Copy the helper into `apps/web/src/lib/` with a "keep in step"
  comment pointing at the original. `import type` from shared is fine. To see
  the build the way Vercel does, move `packages/shared/dist` aside, run
  `pnpm --filter web build`, then move it back.
- **`next build` lints, and an ESLint error fails the Vercel deploy.** Run
  `npx next lint` from `apps/web` before any web PR. Escape apostrophes and
  quotes in JSX text (`&apos;`, `&ldquo;`, `&rdquo;`). Existing warnings are fine.
- **Every new Nest provider needs its own `@Injectable()`**, subclasses
  included (for example a county adapter extending `RealTdmAdapter`). Without
  it the API crash-loops on boot. Jest and `tsc` do not catch this.
- **Pipeline board buttons.** In
  `apps/web/src/components/pipelines/pipeline-board.css`, `.dc-board button`
  strips border, background and color. Write new board button styles as
  `button.dc-whatever`, never a bare `.dc-whatever`.
- **Calendar dates.** Railway runs in UTC, so a date-only value stored at
  midnight UTC shows a day early in Eastern. Default date inputs with
  `todayLocal()` (`apps/web/src/lib/dates.ts`) and display midnight-UTC days
  with `fmtDay()` (`apps/web/src/components/pipelines/format.ts`). Store picked
  days at noon UTC with `calendarDayToDate()` (`apps/api/src/surplus/surplus.util.ts`)
  only when no day-count math depends on midnight.
- **`apps/api/railway.json` is stale** and starts the API with
  `prisma db push`, which can drop columns. Railway reads it only if the API
  service's Root Directory is `apps/api`, so that setting must stay empty. The
  real config is the root `railway.json`.
- **Railway stops reading `railway.json` on 2026-12-01.** Its replacement is
  `.railway/railway.ts` (partial export named `fast-homes-api`, its own
  `package.json` with `"type": "module"`). Never run `railway config pull`,
  `config init` or `config apply` without the owner's go-ahead: a config file
  without the partial export deletes every resource it omits, Postgres and
  Redis included.

## Merging and checking a deploy

- Merge a PR with `gh pr merge N --merge` once CI is green, then confirm with
  `gh pr view N --json state,mergeCommit`. GitHub auto-merge is off on this
  repo. Never merge by checking out `master` locally and pushing.
- A merge does not prove a deploy. Railway has silently skipped merge commits,
  and a failed deploy leaves the old build serving, so `/health` answering 200
  proves nothing. Check
  `gh api repos/gaslaksen/fast-homes-crm/commits/<sha>/status` (context
  `dealcore - @fast-homes/api`) or hit a route the new code adds. The fix for a
  skipped deploy is "Deploy latest commit" in Railway, not "Redeploy" (which
  rebuilds the old commit).
- Production API writes need a real signed-in token whose user has an
  organization. Always read the response status. Prefer the app's own buttons
  to hand-made API calls against prod.

## Business rules (owner's decisions, do not change without asking)

Surplus funds (Florida overages):

- The workable window is day 110 to day 365, counted from the notice date (the
  sale date when no notice has been read). Anything that spends money or puts a
  claim in front of the team respects it (`SURPLUS_EARLY_DAYS`).
- Every paid lookup goes through one gate, `traceCriteria` in
  `apps/api/src/surplus/surplus-skiptrace.util.ts`. No lookup when someone
  else's claim is pending, the claim is assigned or paid out, the notice is
  over a year old, or the county lists the claimant as dead (estates get the
  estate search instead). Relatives: only the spouse and likely children.
- BatchData and Endato are dropped. The IDI batch (export CSV, upload at IDI,
  import the results) is the only skip trace.
- Claude web searches (social profiles, obituaries) run only when a person
  clicks for them, never on a pull or cron. Obituary search costs money and is
  capped by `OBITUARY_MONTHLY_BUDGET`. Bots never send social messages.
- Drips enroll per person (`CampaignEnrollment.heirId`, null means the
  claimant). A reply from anyone on the case stops every drip on it; STOP opts
  out only that person. Any new send or opt-out path must handle heir
  enrollments, not assume `lead.sellerPhone`.
- After any `full: true` county pull, check `createdLeadIds` for duplicates.
  Owner name wording drifts between pulls (ET AL, ESTATE OF, DECD) and dedupe
  matches the exact name.
- County discovery scripts must call the adapter's real parser, never a quick
  regex written for the sweep.

Other pipelines and companies:

- Foreclosures and Tax Sales have no automated outreach. Foreclosure leads are
  created with `autoRespond=false`. Probate has AI messaging off, and drips
  enroll only the `primaryContact` lead, since one heir can own many properties.
- Two companies share one login: Quick Cash Home Buyers and D.I.G. Deeper LLC.
  Surplus leads send as D.I.G. Deeper, everything else as Quick Cash. The one
  rule is `brandForLeadSource()` in `apps/api/src/common/company.constants.ts`.
  Leads have no company column; the company comes from the lead's source via
  `brand_modules`, and `checkSameCompany` refuses enrolling a lead in another
  company's campaign.

## Before opening a PR

Run `pnpm build`, `pnpm test`, and `pnpm lint`. If you touched the schema,
confirm the migration file is committed. Never commit secrets or `.env` files.
If you touched `apps/web`, also run `npx next lint` there (see the traps above).

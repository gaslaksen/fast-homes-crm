# Contributing to Dealcore (fast-homes-crm)

Welcome. This guide gets you from a fresh clone to shipping code that deploys to
production. Read it once end to end before your first change.

## The 60-second mental model

- **Monorepo**: `apps/api` (NestJS backend), `apps/web` (Next.js 14 frontend),
  `packages/shared` (shared types). Built with pnpm + Turborepo.
- **The mobile app** (`apps/mobile`) is a standalone Expo project, deliberately
  excluded from the workspace. It has its own install and ships through EAS/Apple,
  not through the deploy below. Ignore it unless you are working on mobile.
- **Deploys are automatic**. Merging to `master` triggers a production deploy:
  Railway builds and runs the API, Vercel builds the web frontend. There is no
  manual "deploy" step. Merging to `master` IS deploying to prod. Treat it that way.

## Prerequisites

- Node.js 18 or newer
- pnpm 8 (the repo pins `pnpm@8.15.0`)
- PostgreSQL running locally
- Redis running locally (optional, used by BullMQ for drip sequences)

## First-time setup

1. **Get access** (ask Geoff for these before you start):
   - GitHub: collaborator with Write access on `gaslaksen/fast-homes-crm`
   - Railway: project member (for prod logs, env vars, rollbacks)
   - Vercel: project member (for frontend deploys and logs)
   - The API and web `.env` values, shared through a password manager. Do NOT
     accept these over email or chat in plaintext, and never commit them.

2. **Clone and install** (from the repo root):

   ```bash
   git clone https://github.com/gaslaksen/fast-homes-crm.git
   cd fast-homes-crm
   pnpm install
   ```

3. **Configure the API environment**. Copy the example and fill it in:

   ```bash
   cp apps/api/.env.example apps/api/.env
   ```

   `apps/api/.env.example` documents every variable. The ones you need for a
   working local app are called out in "Environment variables" below. Get the
   real secret values from the shared password manager or from the Railway
   dashboard, which already holds the production values.

4. **Configure the web environment**. `apps/web/.env.local` holds the frontend
   values, for example:

   ```
   NEXT_PUBLIC_API_URL=http://localhost:3001
   NEXT_PUBLIC_GOOGLE_MAPS_API_KEY=...
   ```

5. **Set up the database**:

   ```bash
   # create a local db named fast_homes_crm, then:
   pnpm db:migrate   # applies all Prisma migrations
   pnpm db:seed      # seeds AI prompt templates and starter data
   ```

6. **Run everything**:

   ```bash
   pnpm dev          # starts api (:3001) and web (:3000) via Turborepo
   ```

   Useful extras:

   ```bash
   pnpm db:studio    # Prisma Studio, a visual DB browser
   pnpm build        # production build (what Railway/Vercel run)
   pnpm test         # run the test suites
   pnpm lint         # lint
   ```

## Environment variables

`apps/api/.env.example` is the source of truth. Highlights:

**Required for a working local app**
- `DATABASE_URL` local Postgres connection string
- `JWT_SECRET` any non-empty string locally
- `ANTHROPIC_API_KEY` powers all AI features (scoring, drafts, extraction,
  ARV, foreclosure parsing). Without it the app falls back to templates.
- `NEXT_PUBLIC_API_URL` (web) points the frontend at the API

**Feature integrations (set the ones you touch)**
- `RENTCAST_API_KEY` comps/ARV
- SMS: Twilio is the SMS provider. Set the `TWILIO_*` credentials, and set
  `SMS_TEST_MODE="true"` plus `SMS_ALLOWED_NUMBERS` locally so you never text a
  real lead by accident.
- Email: `MAILGUN_*`
- Comps/property data: `REAPI_API_KEY`, `ATTOM_API_KEY`, `BATCHDATA_API_KEY`
- Voice AI: `VAPI_*`
- Mobile push: `APNS_*`

You do not need every integration to run locally. Missing keys degrade
gracefully (the app logs a warning and disables that feature).

## Everyday workflow

We use a branch and pull request flow. Nobody pushes straight to `master`.

1. Start from an up to date `master`:

   ```bash
   git checkout master
   git pull --rebase origin master
   git checkout -b feature/short-description
   ```

2. Make your change. Keep commits focused.

3. Push and open a PR against `master`:

   ```bash
   git push -u origin feature/short-description
   ```

   Open the PR on GitHub, describe what changed and why, and request a review.

4. Once approved and merged, the deploy happens automatically. Watch Railway
   (API) and Vercel (web) to confirm the build succeeded, and spot check prod.

If a deploy goes bad, roll back from the Railway (or Vercel) dashboard rather
than scrambling to push a fix. Then investigate on a branch.

## Making changes with Claude Code

You can use Claude Code (the AI coding agent) to explore this repo and make
changes. It works the same whether you drive it from the terminal (CLI) or from
an editor/desktop/web interface (GUI). Either way it reads the code, proposes
edits, and asks before it changes files or runs commands. You still review every
diff and open the pull request yourself. Claude does not push to `master` or
deploy for you.

### CLI (terminal)

```bash
npm install -g @anthropic-ai/claude-code   # one time
cd fast-homes-crm
claude                                      # start it from the repo root
```

The first run signs you in with your Anthropic account (or Claude
subscription). After that, just describe what you want in plain English, for
example "add a phone field to the lead form and wire it through the API".
Claude reads the relevant files, shows proposed edits, and waits for your
approval. It can also run the app, run `pnpm test`, and explain code. Slash
commands help too, for example `/code-review` reviews your working changes
before you open a PR.

### GUI (editor, desktop, or web)

Same agent, with visual diff review instead of the terminal:

- VS Code or JetBrains extension (Claude Code inside your editor)
- The Claude desktop app (Mac/Windows)
- The web app at claude.ai/code

Use whichever you prefer. The CLI and GUI operate on the same local repo, so the
workflow below is identical.

### Your responsibilities when using Claude

Claude speeds up the work but you own the result. Before you push:

- Read every diff it produced. Do not merge code you have not read.
- Run `pnpm build`, `pnpm test`, and `pnpm lint`.
- If the schema changed, confirm a migration file was generated and committed.
- Then branch, commit, and open a PR exactly as in "Everyday workflow" above.

Claude follows repo conventions when it can see them. This repo has a committed
`CLAUDE.md` at the root that documents the house rules (migrations, no dashes,
architecture) so Claude picks them up automatically. If it is missing, ask Geoff
to add it, or you will have to restate those rules each session.

## Two rules that will bite you if you miss them

### 1. Schema changes REQUIRE a migration file

If you change `apps/api/prisma/schema.prisma`, you must generate and commit a
migration:

```bash
pnpm db:migrate    # prisma migrate dev, creates the migration file
```

The Railway Dockerfile runs `prisma migrate deploy` on every deploy. That
command applies committed migration files. It does NOT diff the schema. If you
change the schema but forget the migration file, `migrate deploy` silently does
nothing, production drifts out of sync with the code, and lead queries start
crashing. Always commit the generated migration alongside the schema change.

Related: hand written migrations must target the actual table name, which is the
`@@map`'d snake_case name, not the Prisma model name. For example `model Lead`
maps to table `"leads"`, so it is `ALTER TABLE "leads"`, never
`ALTER TABLE "Lead"`. Getting this wrong has taken prod down before.

### 2. No dashes, anywhere

House style: never use em dashes or en dashes in anything. Use a regular ASCII
hyphen, or split into two sentences. This applies to code, comments, commit
messages, PR descriptions, and docs. No exceptions.

## Before you open a PR

- `pnpm build` passes
- `pnpm test` passes
- `pnpm lint` is clean
- If you touched the schema, the migration file is committed
- No secrets, `.env` files, or API keys in the diff
- No em or en dashes

## Where things live

- `apps/api/src/messages/` core messaging (send, receive, auto-respond)
- `apps/api/src/scoring/` CAMP scoring, AI extraction, draft generation
- `apps/api/src/drip/` drip sequence management (BullMQ)
- `apps/api/src/leads/` lead CRUD, schedules initial outreach
- `apps/api/src/webhooks/` inbound provider webhooks
- `apps/api/prisma/` schema, migrations, seed
- `apps/web/` Next.js App Router frontend
- `packages/shared/` shared types and utilities
- `docs/` design notes and build prompts

## Getting help

When something is unclear, ask Geoff before changing production behavior. The
safe default is: research the existing code, propose the change, confirm, then
implement. Do not guess on anything that touches live leads, messaging, or the
database.

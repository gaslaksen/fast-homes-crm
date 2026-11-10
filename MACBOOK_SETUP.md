# Setting up a second Mac for Dealcore development

Written for a MacBook Air (Apple Silicon) as a second machine alongside the
Mac Mini. Follow it top to bottom. Most steps are one time.

`CONTRIBUTING.md` is the canonical onboarding doc. This file is the Mac
specific version of it, with the version pins read straight out of the repo
and the secrets handling spelled out, since a second machine is the one case
where you have to move `.env` files around.

Two numbers in `CONTRIBUTING.md` are stale as of the 2026-10-30 commit
"Pin Node 26.13.0 and bump pnpm to 8.15.1". Use the versions below.

## 1. Command line build tools

Several API dependencies are native modules (`bcrypt`, `sharp`,
`heic-convert`). If a prebuilt binary is not published for your Node version,
pnpm compiles them from source, which needs Apple's toolchain.

```bash
xcode-select --install
```

If it reports the tools are already installed, you are done with this step.

## 2. Homebrew

```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

On Apple Silicon the installer ends by printing two `eval` lines to add brew
to your PATH. Run them, then close and reopen Terminal.

## 3. Node

The repo pins Node in `.nvmrc`:

```
26.13.0
```

Install nvm and use the pinned version:

```bash
brew install nvm
mkdir -p ~/.nvm
```

Add this to `~/.zshrc`, then reopen Terminal:

```bash
export NVM_DIR="$HOME/.nvm"
[ -s "$(brew --prefix)/opt/nvm/nvm.sh" ] && . "$(brew --prefix)/opt/nvm/nvm.sh"
[ -s "$(brew --prefix)/opt/nvm/etc/bash_completion.d/nvm" ] && . "$(brew --prefix)/opt/nvm/etc/bash_completion.d/nvm"
```

Then, after the clone in step 6, run `nvm install` from the repo root and it
reads `.nvmrc` for you.

Worth knowing: production does NOT run Node 26. `apps/api/Dockerfile` builds
on `node:20-slim`, so local and Railway differ by two major versions. That is
fine for day to day work, but if a native module refuses to build on 26
(`bcrypt` is the likely one, it compiles via node-gyp), `nvm install 20` and
develop on 20 instead. It matches prod and nothing in the repo requires 26.

## 4. pnpm

Do not `npm install -g pnpm`. The repo pins the exact version in
`package.json` as `"packageManager": "pnpm@8.15.1"`, and an unpinned global
pnpm has broken the Docker build before by silently skipping `sharp`'s
platform binding. See the long comment in `apps/api/Dockerfile`.

Let corepack read the pin:

```bash
corepack enable
corepack prepare --activate
```

Check it from inside the repo after cloning:

```bash
pnpm --version   # expect 8.15.1
```

(The Dockerfile still hard pins 8.15.0, one patch behind `package.json`. It
has not caused a problem, but do not "fix" it in either direction without
rebuilding the image, because that pin is load bearing.)

## 5. Docker Desktop

Local Postgres and Redis run in containers, so you do not install either one
natively.

```bash
brew install --cask docker
```

Launch Docker from Applications once and leave it running. Both images in
`docker-compose.yml` (`postgres:15-alpine`, `redis:7-alpine`) publish arm64
builds, so they run natively on Apple Silicon with no emulation flags.

If you already run a native Postgres on this Mac, it will hold port 5432 and
the container will fail to start. Stop it (`brew services stop postgresql@15`)
or change the host side of the port mapping.

## 6. GitHub access so you can push

The remote is HTTPS (`https://github.com/gaslaksen/fast-homes-crm`), so a bare
clone will prompt for a password on push and fail, since GitHub stopped
accepting account passwords. Set up credentials first.

Easiest path, the GitHub CLI:

```bash
brew install gh
gh auth login          # choose GitHub.com, HTTPS, authenticate in browser
gh auth setup-git      # makes git use the gh token for github.com
```

That gives you working `git push` and the `gh pr` commands the merge workflow
in `CLAUDE.md` uses.

SSH instead, if you prefer:

```bash
ssh-keygen -t ed25519 -C "geoff-macbook-air"
pbcopy < ~/.ssh/id_ed25519.pub        # paste at github.com/settings/keys
git clone git@github.com:gaslaksen/fast-homes-crm.git
```

Name the key for this machine so you can revoke it on its own if the MacBook
is lost or stolen.

Set your commit identity if this is a fresh machine:

```bash
git config --global user.name "Geoff Aslaksen"
git config --global user.email "<the email on your GitHub account>"
```

## 7. Clone and install

```bash
cd ~/code                                        # or wherever you keep repos
git clone https://github.com/gaslaksen/fast-homes-crm.git
cd fast-homes-crm
nvm install                                      # reads .nvmrc
pnpm install
```

Skip `./setup.sh`. It still runs `prisma migrate dev --name init`, which tries
to create a new migration rather than apply the committed ones, and its key
list is out of date (it names `OPENAI_API_KEY` for AI features, which is now
`ANTHROPIC_API_KEY`). The steps below are the current path.

## 8. Secrets

This is the only part that cannot be done from the repo alone. Both env files
are gitignored, so they are not in the clone and you have to bring them over.

**API: `apps/api/.env`**

`apps/api/.env.example` is the authoritative variable list, 354 lines with
comments on every one. Start from it:

```bash
cp apps/api/.env.example apps/api/.env
```

Then fill in the real values. Three ways to get them, in order of preference:

1. The shared password manager, which is where `CONTRIBUTING.md` says they
   live.
2. The Railway dashboard, which holds the production values.
3. Copy the file off the Mac Mini directly. Over your own local network or
   Tailscale: `scp mac-mini.local:~/code/fast-homes-crm/apps/api/.env .` is
   fine. AirDrop works too.

Do not move these through email, Slack or a chat window, and never commit
them. `.gitignore` already covers `.env` and `.env.local`, so the protection
is there as long as you do not force add.

For local work you only need a handful:

- `DATABASE_URL` the example's default already matches the Docker Postgres
  (user `postgres`, password `postgres`, db `fast_homes_crm`), so leave it
- `JWT_SECRET` any non-empty string locally
- `ANTHROPIC_API_KEY` powers scoring, drafts, extraction, ARV and notice
  parsing. Without it the app warns and falls back to templates
- `REDIS_HOST=localhost` and `REDIS_PORT=6379` already correct in the example

**The one thing that will stop the API booting:** SMS. The API refuses to
start with no SMS provider configured, and Twilio's SDK crashes on a fake
account SID with `accountSid must start with AC`. When that happens nothing
listens on :3001 and every login looks like a wrong password. So either:

- No Twilio account locally: leave `TWILIO_ACCOUNT_SID` and
  `TWILIO_AUTH_TOKEN` empty and set `ALLOW_SIMULATED_SMS="true"`. A fresh copy
  of `.env.example` is already in this state.
- Real Twilio credentials copied from the Mini: also set
  `SMS_TEST_MODE="true"` and list your own number in `SMS_ALLOWED_NUMBERS`, so
  a test can never text a real lead.

Everything else (Mailgun, RentCast, REAPI, ATTOM, Vapi, S3, Lob, APNs)
degrades gracefully. Set only what you are working on.

**Web: `apps/web/.env.local`**

There is no example file for this one in the repo, so copy it from the Mac
Mini. At minimum:

```
NEXT_PUBLIC_API_URL=http://localhost:3001
NEXT_PUBLIC_GOOGLE_MAPS_API_KEY=...
```

The web app also reads these feature flags, and the Mini's copy is the only
record of which ones you have been running with:

```
NEXT_PUBLIC_NAV_LAYOUT
NEXT_PUBLIC_DASHBOARD_V2
NEXT_PUBLIC_LEAD_DETAIL_V2
NEXT_PUBLIC_LIST_VIEW_V2
NEXT_PUBLIC_KANBAN_V2
NEXT_PUBLIC_DEALS_VIEW
NEXT_PUBLIC_DISPOSITION_V2
NEXT_PUBLIC_COMP_DRILL_IN
NEXT_PUBLIC_AI_COMP_CURATION
NEXT_PUBLIC_BATCHDATA_ENABLED
```

## 9. Database

```bash
docker-compose up -d     # Postgres :5432, Redis :6379
docker-compose ps        # both should read healthy
pnpm db:migrate          # applies the committed migrations
pnpm db:seed             # AI prompt templates, sample leads, demo user
```

The seed creates a login: `demo@fasthomes.com` / `password123`.

If a migration ever fails on a messy local database, the fast reset is
`docker-compose down -v` (deletes local data), then `docker-compose up -d` and
`pnpm db:migrate`.

## 10. Run it

```bash
pnpm dev                 # api :3001 and web :3000 via Turborepo
```

Open http://localhost:3000 and sign in with the demo user. Handy extras:

```bash
pnpm db:studio           # visual DB browser
```

## 11. Confirm the machine is actually ready

Run the full pre-PR gate once now, on a clean checkout, so you find a broken
toolchain today rather than mid change:

```bash
pnpm build
pnpm test
pnpm lint
cd apps/web && npx next lint && cd ../..
```

`pnpm test` mocks the database, so it needs neither Postgres nor a test
database. If all four pass, the MacBook is set up.

## 12. Claude Code

```bash
npm install -g @anthropic-ai/claude-code
cd ~/code/fast-homes-crm
claude
```

First run signs you in with your Anthropic account. The repo's committed
`CLAUDE.md` is picked up automatically, so the house rules carry over to this
machine with no extra setup.

## 13. Working and pushing from here

Same flow as the Mini. Nobody pushes to `master`, and merging to `master` is a
production deploy.

```bash
git checkout master
git pull --rebase origin master
git checkout -b feature/short-description
# make the change
pnpm build && pnpm test && pnpm lint
git push -u origin feature/short-description
```

Then open a PR against `master` and get it reviewed.

Two repo rules that bite hardest when you are working on an unfamiliar
machine:

1. Changing `apps/api/prisma/schema.prisma` requires a committed migration
   file from `pnpm db:migrate`. Railway runs `prisma migrate deploy`, which
   applies migration files and does not diff the schema, so a missing
   migration silently no-ops in production and drifts the database.
2. No em dashes or en dashes anywhere, including commit messages and PR
   descriptions.

The rest are in `CLAUDE.md` under "Traps that have broken production before".
Read that section before your first web change in particular.

## What you can skip

- `apps/mobile` is a standalone Expo project, excluded from the workspace,
  with its own `npm install`. Ignore it unless you are doing mobile work, and
  see `apps/mobile/README.md` when you are.
- `apps/digdeeper-site` is plain HTML, CSS and a PDF with no `package.json`.
  Nothing to install.

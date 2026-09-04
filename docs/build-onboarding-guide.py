#!/usr/bin/env python3
"""Build the Dax onboarding walkthrough PDF for Dealcore.

Regenerate with:  python3 docs/build-onboarding-guide.py
(needs `pip install reportlab`). Output: docs/Dax-Onboarding-Guide.pdf
"""

import os
from reportlab.lib.pagesizes import letter
from reportlab.lib.units import inch
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.enums import TA_LEFT
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle,
    HRFlowable, KeepTogether, ListFlowable, ListItem, PageBreak,
)

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                   "Dax-Onboarding-Guide.pdf")

# Palette
INK = colors.HexColor("#1a2233")
ACCENT = colors.HexColor("#1f6feb")
ACCENT_DK = colors.HexColor("#0b3d91")
MUTED = colors.HexColor("#5b6472")
CODE_BG = colors.HexColor("#0f172a")
CODE_FG = colors.HexColor("#e6edf3")
CODE_COMMENT = colors.HexColor("#7d8aa0")
WARN_BG = colors.HexColor("#fff4e5")
WARN_BAR = colors.HexColor("#d98324")
TIP_BG = colors.HexColor("#e8f1ff")
TIP_BAR = ACCENT
RULE = colors.HexColor("#d7dde5")

styles = getSampleStyleSheet()

def S(name, **kw):
    styles.add(ParagraphStyle(name=name, **kw))

S("DocTitle", parent=styles["Title"], fontName="Helvetica-Bold",
  fontSize=26, textColor=INK, spaceAfter=4, leading=30)
S("DocSub", fontName="Helvetica", fontSize=12, textColor=MUTED,
  spaceAfter=2, leading=16)
S("H1", parent=styles["Heading1"], fontName="Helvetica-Bold", fontSize=16,
  textColor=ACCENT_DK, spaceBefore=18, spaceAfter=6, leading=20)
S("H2", parent=styles["Heading2"], fontName="Helvetica-Bold", fontSize=12,
  textColor=INK, spaceBefore=10, spaceAfter=4, leading=15)
S("Body", parent=styles["BodyText"], fontName="Helvetica", fontSize=10.2,
  textColor=INK, leading=15, spaceAfter=6, alignment=TA_LEFT)
S("Small", fontName="Helvetica", fontSize=8.6, textColor=MUTED, leading=12)
S("DCBullet", parent=styles["Body"], leftIndent=4, spaceAfter=3, leading=14)
S("CalloutBody", fontName="Helvetica", fontSize=9.6, textColor=INK, leading=14)
S("CalloutHead", fontName="Helvetica-Bold", fontSize=9.6, textColor=INK,
  leading=14, spaceAfter=2)
S("StepNum", fontName="Helvetica-Bold", fontSize=11, textColor=colors.white,
  leading=13, alignment=1)

story = []

def code(lines):
    """Render a dark code block. Comment lines (starting with #) are muted."""
    rows = []
    for ln in lines:
        c = CODE_COMMENT if ln.strip().startswith("#") else CODE_FG
        rows.append([Paragraph(
            ln.replace(" ", "&nbsp;") if ln else "&nbsp;",
            ParagraphStyle("c", fontName="Courier", fontSize=8.6, textColor=c,
                           leading=12.5))])
    t = Table(rows, colWidths=[6.7 * inch])
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), CODE_BG),
        ("TOPPADDING", (0, 0), (-1, -1), 1.5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 1.5),
        ("LEFTPADDING", (0, 0), (-1, -1), 12),
        ("RIGHTPADDING", (0, 0), (-1, -1), 12),
        ("TOPPADDING", (0, 0), (-1, 0), 8),
        ("BOTTOMPADDING", (0, -1), (-1, -1), 8),
        ("ROUNDEDCORNERS", [5, 5, 5, 5]),
    ]))
    return t

def callout(kind, head, body_lines):
    bg = WARN_BG if kind == "warn" else TIP_BG
    bar = WARN_BAR if kind == "warn" else TIP_BAR
    inner = [Paragraph(head, styles["CalloutHead"])]
    for b in body_lines:
        inner.append(Paragraph(b, styles["CalloutBody"]))
    body_cell = Table([[x] for x in inner], colWidths=[6.15 * inch])
    body_cell.setStyle(TableStyle([
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ("RIGHTPADDING", (0, 0), (-1, -1), 0),
        ("TOPPADDING", (0, 0), (-1, -1), 1),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 1),
    ]))
    t = Table([["", body_cell]], colWidths=[0.12 * inch, 6.5 * inch])
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (0, -1), bar),
        ("BACKGROUND", (1, 0), (1, -1), bg),
        ("LEFTPADDING", (1, 0), (1, -1), 12),
        ("RIGHTPADDING", (1, 0), (1, -1), 12),
        ("TOPPADDING", (0, 0), (-1, -1), 9),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 9),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
    ]))
    return KeepTogether([Spacer(1, 4), t, Spacer(1, 4)])

def step_header(num, title):
    badge = Table([[Paragraph(str(num), styles["StepNum"])]],
                  colWidths=[0.34 * inch], rowHeights=[0.34 * inch])
    badge.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), ACCENT),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("ALIGN", (0, 0), (-1, -1), "CENTER"),
        ("ROUNDEDCORNERS", [17, 17, 17, 17]),
        ("TOPPADDING", (0, 0), (-1, -1), 0),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
    ]))
    ttl = Paragraph(title, ParagraphStyle(
        "sh", fontName="Helvetica-Bold", fontSize=15, textColor=ACCENT_DK,
        leading=18))
    row = Table([[badge, ttl]], colWidths=[0.5 * inch, 6.2 * inch])
    row.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("LEFTPADDING", (0, 0), (0, 0), 0),
        ("LEFTPADDING", (1, 0), (1, 0), 4),
        ("TOPPADDING", (0, 0), (-1, -1), 0),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
    ]))
    return KeepTogether([Spacer(1, 12), row, Spacer(1, 2),
                         HRFlowable(width="100%", thickness=1.2, color=ACCENT,
                                    spaceBefore=3, spaceAfter=8)])

def body(txt):
    story.append(Paragraph(txt, styles["Body"]))

def bullets(items):
    lf = ListFlowable(
        [ListItem(Paragraph(t, styles["DCBullet"]), value="•",
                  leftIndent=14) for t in items],
        bulletType="bullet", start="•", leftIndent=10)
    story.append(lf)
    story.append(Spacer(1, 4))

# ---------- Cover ----------
story.append(Spacer(1, 6))
bar = Table([[""]], colWidths=[7.0 * inch], rowHeights=[6])
bar.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, -1), ACCENT)]))
story.append(bar)
story.append(Spacer(1, 18))
story.append(Paragraph("Dealcore Developer Onboarding", styles["DocTitle"]))
story.append(Paragraph("A step-by-step walkthrough for Dax: pull, run, push, "
                       "deploy, and read production logs.", styles["DocSub"]))
story.append(Spacer(1, 6))
story.append(Paragraph("Repo: github.com/gaslaksen/fast-homes-crm &nbsp;|&nbsp; "
                       "API on Railway &nbsp;|&nbsp; Web on Vercel",
                       styles["Small"]))
story.append(Spacer(1, 14))
story.append(callout("tip", "What this covers",
    ["This guide gets you from zero to shipping. Do the one-time setup once "
     "(Steps 0 to 3). After that, your everyday loop is Steps 4 to 9, and you "
     "can use Claude Code (Step 5) to make the changes. Read CONTRIBUTING.md in "
     "the repo for the same rules in text form."]))

# ---------- Step 0 ----------
story.append(step_header(0, "Get access (one time, ask Geoff first)"))
body("Before anything works you need to be invited to three places. Send Geoff "
     "your GitHub username and the email you want to use for Railway and Vercel.")
bullets([
    "<b>GitHub</b> collaborator with <b>Write</b> access on "
    "<font face='Courier'>gaslaksen/fast-homes-crm</font>.",
    "<b>Railway</b> project member (needed to read API logs and env vars).",
    "<b>Vercel</b> project member (needed to read web build and runtime logs).",
    "The <b>.env values</b> shared through a password manager. Never accept "
    "secrets over email or chat, and never commit them.",
])

# ---------- Step 1 ----------
story.append(step_header(1, "Install the tools (one time)"))
body("You need Node 18 or newer, pnpm 8, Git, and Docker. Docker runs your "
     "local Postgres database and Redis, so you do not have to install those "
     "yourself. Install Docker Desktop from docker.com and start it (you should "
     "see the whale icon in your menu bar). Then install pnpm at the exact "
     "version the repo pins:")
story.append(code([
    "# check versions",
    "node -v         # should be 18 or newer",
    "git --version",
    "docker --version",
    "",
    "# install pnpm 8 (the repo pins pnpm@8.15.0)",
    "npm install -g pnpm@8.15.0",
]))

# ---------- Step 2 ----------
story.append(step_header(2, "Clone the project and start the database"))
body("Clone the repo, install dependencies, then start Postgres and Redis.")
story.append(code([
    "# 1. clone and enter the repo",
    "git clone https://github.com/gaslaksen/fast-homes-crm.git",
    "cd fast-homes-crm",
    "",
    "# 2. install all workspace dependencies",
    "pnpm install",
    "",
    "# 3. start local Postgres + Redis in Docker (Docker Desktop must be running)",
    "docker-compose up -d",
    "",
    "# 4. confirm both containers are up and healthy",
    "docker-compose ps",
]))
body("The Postgres container listens on <font face='Courier'>localhost:5432</font> "
    "with user <font face='Courier'>postgres</font>, password "
    "<font face='Courier'>postgres</font>, database "
    "<font face='Courier'>fast_homes_crm</font>. That matches the default "
    "<font face='Courier'>DATABASE_URL</font> in "
    "<font face='Courier'>.env.example</font>, so you do not have to change it.")

# ---------- Step 3 ----------
story.append(step_header(3, "Configure env and set up the database schema"))
body("Create your env files, then create the tables and load starter data.")
story.append(code([
    "# 1. create the API env file, then open it and fill in secrets",
    "cp apps/api/.env.example apps/api/.env",
]))
story.append(Paragraph("In <font face='Courier'>apps/api/.env</font> set at "
    "minimum <font face='Courier'>DATABASE_URL</font> (the docker default "
    "works), <font face='Courier'>JWT_SECRET</font> (any string locally), and "
    "<font face='Courier'>ANTHROPIC_API_KEY</font> (powers all AI features). "
    "Also set <font face='Courier'>SMS_TEST_MODE=\"true\"</font> so local "
    "testing never texts a real lead.", styles["Body"]))
story.append(callout("warn", "SMS: use the simulator locally, or the API will not boot",
    ["If you do not have a Twilio account, leave "
     "<font face='Courier'>TWILIO_ACCOUNT_SID</font> and "
     "<font face='Courier'>TWILIO_AUTH_TOKEN</font> EMPTY and set "
     "<font face='Courier'>ALLOW_SIMULATED_SMS=\"true\"</font>. Any non-empty "
     "placeholder in those two makes the app build a real Twilio client and "
     "crash on startup with \"accountSid must start with AC\", so nothing "
     "listens on :3001 and every login fails with \"invalid email or "
     "password\". The simulator just logs messages instead of sending them."]))
story.append(code([
    "# 2. web env: point the frontend at your local API",
    "printf 'NEXT_PUBLIC_API_URL=http://localhost:3001\\n' > apps/web/.env.local",
    "",
    "# 3. create all tables from the Prisma schema",
    "pnpm db:migrate",
    "",
    "# 4. load starter data (demo user, sample leads, AI prompts)",
    "pnpm db:seed",
]))
body("The seed creates a login you can use right away once the app is running:")
bullets([
    "Email: <font face='Courier'>demo@fasthomes.com</font>",
    "Password: <font face='Courier'>password123</font>",
])
story.append(callout("tip", "About testing locally",
    ["The automated tests (<font face='Courier'>pnpm test</font>) mock the "
     "database, so they need no Postgres and no separate test database. This "
     "local database is for running and manually testing the app in the "
     "browser. If a migration ever fails on a messy local database, the "
     "fastest reset is <font face='Courier'>docker-compose down -v</font> "
     "(this deletes local data), then "
     "<font face='Courier'>docker-compose up -d</font> and "
     "<font face='Courier'>pnpm db:migrate</font> again."]))

# ---------- Step 4 ----------
story.append(step_header(4, "Pull the latest code and run locally"))
body("Start every working session by syncing <font face='Courier'>master</font>, "
     "then start both apps. Do this each day, not just once.")
story.append(code([
    "# get the newest code before you start working",
    "git checkout master",
    "git pull --rebase origin master",
    "pnpm install        # in case dependencies changed",
    "",
    "# start the API (:3001) and web (:3000) together",
    "pnpm dev",
]))
body("Then open the app in your browser:")
bullets([
    "Frontend: <font face='Courier'>http://localhost:3000</font>",
    "API: <font face='Courier'>http://localhost:3001</font>",
])
story.append(callout("tip", "If a schema migration landed while you were away",
    ["If someone changed the database schema, run "
     "<font face='Courier'>pnpm db:migrate</font> after pulling so your local "
     "database matches the code."]))

# ---------- Step 5: Claude Code ----------
story.append(step_header(5, "Make changes with Claude Code (CLI or GUI)"))
body("You can use Claude Code, the AI coding agent, to explore this repo and "
     "make changes. It works the same from the terminal (CLI) or from an "
     "editor, desktop, or web interface (GUI). Either way it reads the code, "
     "proposes edits, and asks before it changes files or runs commands. You "
     "review every diff and open the pull request yourself. Claude does not "
     "push to <font face='Courier'>master</font> or deploy for you.")
story.append(Paragraph("CLI (terminal)", styles["H2"]))
story.append(code([
    "npm install -g @anthropic-ai/claude-code   # one time",
    "cd fast-homes-crm",
    "claude                                      # run from the repo root",
]))
body("The first run signs you in with your Anthropic account or Claude "
     "subscription. After that, describe what you want in plain English, for "
     "example \"add a phone field to the lead form and wire it through the "
     "API\". Claude shows proposed edits and waits for your approval. It can "
     "also run the app and tests. The slash command "
     "<font face='Courier'>/code-review</font> reviews your working changes "
     "before you open a PR.")
story.append(Paragraph("GUI (editor, desktop, or web)", styles["H2"]))
body("Same agent, with visual diff review instead of the terminal. Use "
     "whichever you prefer:")
bullets([
    "VS Code or JetBrains extension (Claude Code inside your editor)",
    "The Claude desktop app (Mac or Windows)",
    "The web app at <font face='Courier'>claude.ai/code</font>",
])
story.append(callout("warn", "You own the result, not Claude",
    ["Read every diff before you keep it. Run "
     "<font face='Courier'>pnpm build</font>, "
     "<font face='Courier'>pnpm test</font>, and "
     "<font face='Courier'>pnpm lint</font>. If the schema changed, confirm a "
     "migration file was generated and committed. Then branch, commit, and open "
     "a PR as in the next step. The repo's "
     "<font face='Courier'>CLAUDE.md</font> gives Claude the house rules "
     "(migrations, no dashes) automatically."]))

# ---------- Step 6 ----------
story.append(step_header(6, "Make a change and push code"))
body("Never work directly on <font face='Courier'>master</font>. Create a "
     "branch, commit, push it, and open a pull request. This is the only way "
     "code reaches production.")
story.append(code([
    "# 1. branch off an up-to-date master",
    "git checkout master",
    "git pull --rebase origin master",
    "git checkout -b feature/short-description",
    "",
    "# 2. ...make your edits, then stage and commit",
    "git add -A",
    "git commit -m \"feat: short description of the change\"",
    "",
    "# 3. push your branch to GitHub",
    "git push -u origin feature/short-description",
]))
body("Then open a pull request on GitHub targeting "
     "<font face='Courier'>master</font>, describe what changed and why, and "
     "request a review from Geoff. Once it is approved, merge it.")
story.append(callout("warn", "Schema changes REQUIRE a committed migration file",
    ["If you edited <font face='Courier'>apps/api/prisma/schema.prisma</font>, "
     "run <font face='Courier'>pnpm db:migrate</font> and commit the generated "
     "migration file with your change. Railway runs "
     "<font face='Courier'>prisma migrate deploy</font>, which applies "
     "migration files but does NOT diff the schema. Forget the file and "
     "production silently drifts out of sync and lead queries start crashing."]))

# ---------- Step 7 ----------
story.append(step_header(7, "Deploy to production"))
body("There is no separate deploy button. <b>Merging your pull request into "
     "<font face='Courier'>master</font> IS the deploy.</b> The moment it "
     "merges:")
bullets([
    "<b>Railway</b> rebuilds and redeploys the API (it also runs "
    "<font face='Courier'>prisma migrate deploy</font> on start).",
    "<b>Vercel</b> rebuilds and redeploys the web frontend.",
])
body("After merging, watch both dashboards until the new deploy goes green, "
     "then click through the live app to confirm your change is there. If "
     "something is broken, roll back from the dashboard (Steps 8 and 9 show "
     "where) rather than rushing a fix.")

# ---------- Step 8 ----------
story.append(step_header(8, "Check Railway logs (the API)"))
body("Railway hosts the NestJS API, Postgres, and Redis. Use it to watch a "
     "deploy, read runtime errors, or roll back.")
story.append(Paragraph("Dashboard route", styles["H2"]))
bullets([
    "Go to <font face='Courier'>railway.app</font> and open the Dealcore "
    "project.",
    "Click the <b>API service</b>.",
    "Open the <b>Deployments</b> tab to see build and deploy status. Click the "
    "active deployment to stream its logs.",
    "Use the <b>View Logs</b> panel for live runtime logs (build logs and "
    "deploy logs are separate tabs there).",
    "To undo a bad deploy: open the last good deployment and choose "
    "<b>Redeploy</b> / <b>Rollback</b>.",
])
story.append(Paragraph("Command line (optional)", styles["H2"]))
story.append(code([
    "npm install -g @railway/cli",
    "railway login",
    "railway link          # pick the Dealcore project + API service once",
    "railway logs          # stream live API logs",
]))

# ---------- Step 9 ----------
story.append(step_header(9, "Check Vercel logs (the web frontend)"))
body("Vercel hosts the Next.js frontend. Use it to confirm the web build "
     "succeeded and to read runtime errors from the deployed site.")
story.append(Paragraph("Dashboard route", styles["H2"]))
bullets([
    "Go to <font face='Courier'>vercel.com</font> and open the Dealcore "
    "web project.",
    "Open the <b>Deployments</b> tab. Each merge to "
    "<font face='Courier'>master</font> creates a Production deployment.",
    "Click a deployment to see <b>Build Logs</b> (why a build failed) and "
    "<b>Runtime Logs</b> (errors from the live site).",
    "To undo a bad deploy: find the last good deployment, open its menu, and "
    "choose <b>Promote to Production</b> (rollback).",
])
story.append(Paragraph("Command line (optional)", styles["H2"]))
story.append(code([
    "npm install -g vercel",
    "vercel login",
    "vercel logs <deployment-url>   # runtime logs for a deployment",
]))

# ---------- Cheat sheet ----------
story.append(PageBreak())
story.append(Paragraph("Everyday cheat sheet", styles["H1"]))
body("Once you are set up, this is the whole loop:")
story.append(code([
    "git checkout master && git pull --rebase origin master",
    "git checkout -b feature/my-change",
    "pnpm dev                       # work locally at localhost:3000",
    "claude                         # optional: make the change with Claude Code",
    "git add -A && git commit -m \"feat: my change\"",
    "git push -u origin feature/my-change",
    "# open PR -> review -> merge to master -> auto-deploys",
    "# then watch Railway (API) + Vercel (web) go green",
]))

story.append(Paragraph("The two rules that break production", styles["H1"]))
bullets([
    "<b>Schema change = migration file.</b> Run "
    "<font face='Courier'>pnpm db:migrate</font> and commit the file, or "
    "production drifts and lead queries crash.",
    "<b>No dashes, anywhere.</b> House style: never use em dashes or en dashes "
    "in code, comments, commits, PRs, or docs. Use a plain hyphen or split the "
    "sentence.",
])
story.append(Spacer(1, 8))
story.append(HRFlowable(width="100%", thickness=0.8, color=RULE))
story.append(Spacer(1, 4))
story.append(Paragraph("Questions? Ask Geoff before changing anything that "
    "touches live leads, messaging, or the database. Safe default: research, "
    "propose, confirm, then change.", styles["Small"]))


def footer(canvas, doc):
    canvas.saveState()
    canvas.setFont("Helvetica", 8)
    canvas.setFillColor(MUTED)
    canvas.drawString(0.9 * inch, 0.55 * inch, "Dealcore Developer Onboarding")
    canvas.drawRightString(7.6 * inch, 0.55 * inch, "Page %d" % doc.page)
    canvas.setStrokeColor(RULE)
    canvas.setLineWidth(0.5)
    canvas.line(0.9 * inch, 0.72 * inch, 7.6 * inch, 0.72 * inch)
    canvas.restoreState()


doc = SimpleDocTemplate(
    OUT, pagesize=letter,
    leftMargin=0.9 * inch, rightMargin=0.9 * inch,
    topMargin=0.8 * inch, bottomMargin=0.85 * inch,
    title="Dealcore Developer Onboarding", author="Dealcore")
doc.build(story, onFirstPage=footer, onLaterPages=footer)
print("wrote", OUT)

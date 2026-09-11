# Surplus Funds Roadmap

Gap analysis and prioritized plan for bringing the Dealcore Surplus Funds tab
up to the process taught in the Bob Diamond surplus funds course. Written
2026-09-08 against the eight build-plan and script notes in
`Property Investing/DIG Deeper LLC/`, and against the code on `master` at
commit e40b866.

## Headline

Dealcore is ahead of the course on the front half of the business, which is
finding the money and proving it is still there. It is nearly empty on the
back half, which is where the course spends most of its time: the
conversation, the paperwork, the filing and the payout.

What is already strong:

- Claim status is read off the clerk's docket, not the posted balance, and
  distinguishes open, denied, pending, assigned and distributed.
- The notice figure and the current balance are both kept, so the number used
  on a call is the one the claimant was told.
- Mail verdict from the clerk's own returned-mail filings decides whether an
  address is worth tracing.
- Heirs are read off probate filings by vision, with their own addresses,
  phones, trace state and do-not-call flags.
- Skip tracing refuses to spend a credit on entities, placeholder addresses,
  returned mail and shared addresses, and discards a stranger's contacts.
- Every number carries its DNC registry state through import.
- A Florida compliance table with a fee cap, required disclosures, a license
  requirement for escheated funds and a 180-day staleness rule.
- Dedupe on county, case and claimant, plus suppression tombstones so a deleted
  or county-retired case never comes back as a fresh lead.
- Two live county feeds (Duval daily, Lee weekly) with a daily brief.

What is missing, concretely: nothing in the app creates a follow-up task,
records a call outcome in surplus vocabulary, shows a script, sends a
credibility packet, stores a document, generates a letter, or knows a stage
between Claim Filed and Paid.

## Coverage scorecard

| Course document | What it asks for | Dealcore today | Verdict | Phase |
|---|---|---|---|---|
| Surplus Funds Tab | 12 sequential stages, per-record fields, one-click filters, reminders off stage changes, dead reason codes, previously-worked matching on re-import | 7 stages plus a computed work-queue axis (call, heirs, trace, name search, entity, letter sent, closed) plus claim status. Filters for county, band, claimant type, notice age, lien window, stage, estate, competing lien, hide dead, hide DNC. Tier is computed but not filterable. Dedupe and suppression exist. No reminders. No dead reason. No stage control in the panel; stage changes only by kanban drag or bulk. | Mostly covered | 0, 1, 3 |
| Shoulder Tap Outreach | Tapped / Not Tapped status, four-channel checklist, per-attempt call log, letter cadence with escalation, forced follow-up dates, weekly working list | Dialling counts as a touch whether or not anyone answers. One letter date per claimant, no history. CallLog exists but dispositions are the wholesaling list and the summary screen has no notes field. No contact status, no channel coverage, no cadence, no forced dates. | Mostly missing | 1 |
| Phone Script | One versioned script visible during live calls, version logged per call, one-click credibility packet from the objection sections, outcome and objection logged | The dialer shows name, number and a timer. No script anywhere except the relative-referral string. No version tracking. | Missing | 1 |
| Voicemail Script | Leave on every unanswered call, fill first name, honest days searching, callback number and name, log date and version, track callback rate | A "Voicemail" disposition only. Days searching is derivable from the first attempt date. | Missing | 1 |
| Instant Credibility | One-tap packet (website, Sunbiz, vCard, one-pager, BBB, callback number), track items sent per lead, reference library, recoveries counter | The Dig Deeper brand exists with phone (904) 595-9620 and no website. SMS and email already send as Dig Deeper for surplus leads. Nothing else. | Missing | 1, 3 |
| Surplus Funds Documents | Two document sets, county library, enforced signing sequence, auto-built notary packet, claims checklist, template versions, practice run per county | Eight booleans in a JSON column, no files, no storage. Arrangement is assignment OR limited POA. A qualification gate (entitlement, notice confirmed, title search) guards Agreement Signed but bulk restage bypasses it. The compliance gate is display only and never blocks a send. BoldSign has purchase and AIF templates only. Counties are a string list. | Missing, partial gate | 0, 2 |
| Claims Processing | County checklist, per-case document set, notary sequencing, attorney tracking, submission tracking, two follow-up cadences, disbursement with 30-day clearing, survey and referrals | Stages go Claim Filed then Paid with nothing between. No submission fields, no expenses, no survey. | Missing | 2, 3 |
| Skip Tracing | Per-channel attempt log, associate map, escalation tiers, minimum effort before Dead, 60 and 90 day rechecks, mailing template library | Strong Tier 2 (BatchData with eligibility refusal and name verification). Tier 1 as a name-search link plan. Heirs with addresses and trace state. Contact mismatch is audited. No attempt log, no non-heir associates, no tier-skip flag, no effort gate, no rechecks, no letter templates. | Partial | 4 |

## Three conflicts to settle before building

**1. Fee model.** The phone script states the fee as a contingency split with a
60/40 placeholder. Dealcore's compliance table caps total consideration at 12
percent for Florida mortgage foreclosure surplus under FS 45.033(3)(d), and
applies 12 percent conservatively to tax deed surplus pending a written
opinion. A 40 percent fee on a Florida clerk-held surplus is blocked by the
app as written and, for foreclosure surplus, void by statute. The course is
national and Florida is the exception. Recommendation: the script's split
placeholder is filled from the compliance rule for that case and is never
typed by hand. Get the tax deed opinion.

**2. Stage model.** The course lists 12 sequential stages. Dealcore
deliberately separates three axes: where the money is (claim status), what to
do next (queue) and where the deal is (stage). The queue already replaces
course stages 2 through 5 (Verifying Surplus, Skip Tracing, Outreach Started,
In Conversation) with something computed from evidence rather than set by
hand. Recommendation: keep the three axes and add the missing back-half stages
and a dead reason, rather than adopting the 12 literally.

**3. Retention instrument.** The documents plan signs a Contingency Fee
Agreement, then a Limited POA, then an Assignment of Rights (full or partial
per county). Dealcore models the arrangement as assignment or limited POA,
one or the other, and the stage after Agreement Signed is Assignment
Notarized. Confirm with the course material and counsel which instruments
Florida clerks accept and whether both are always executed.

## Prioritized plan

Order follows the funnel the team hits first, weighted by what protects
revenue. Today's leads sit in the call, trace, name search and letter sent
queues and nobody is signed. So: make every conversation count, keep working
the unreachable ones on a schedule, be ready for the first yes, then run the
claim to payout. Sizes are S (a day), M (two to four days), L (a week or
more).

### Phase 0. Quick fixes, no schema change

- **Close the bulk restage hole (S).** `bulkStage` skips the Agreement Signed
  qualification gate that `update` enforces. Route both through one check.
  `apps/api/src/surplus/surplus.service.ts:518`
- **Stage control in the work panel (S).** The panel's own header comment
  says the card is the place to change stage, and it has no control. Add a
  stage select with a confirm, and stop restaging every claimant on a property
  when one card is dragged on the kanban.
- **Tier chip (S).** Tier A, B, C is computed, fetched in stats and never
  shown. The course's first quick filter is tier.
- **Feed picker (S).** Refresh feed is hardcoded to Duval although Lee ingests
  weekly through RealTDM.
- **County links (S).** The court records link in the heirs panel is
  hardcoded to Duval. Read it off the county until Phase 2 gives counties a
  table.
- **Dead code (S).** The board imports `DAYS`, `DOC_LABEL`, `TIER` and
  `DRIP_TRACK_COLOR` and uses none of them; `bulkDelete` has no button. Tidy
  before the panel grows.

### Phase 1. Outreach execution

Covers Shoulder Tap, the phone and voicemail scripts, and the credibility
packet.

**1.1 Surplus call outcomes and forced follow-ups (M).** Add a shared
`SurplusCallOutcome` enum: no answer with voicemail left, no answer, spoke to
claimant, spoke to relative and message passed, wrong number, disconnected,
not interested, wants the packet, callback scheduled, already signed
elsewhere, do not call. `CallLog` gains `outcome`, `objection` (who are you,
are you real, cost, trust, tell me more, other), `scriptVersion`,
`voicemailVersion`. The dialer summary screen gets a notes field and shows
the surplus list when the lead source is SURPLUS, the wholesaling list
otherwise. Any outcome that implies a follow-up requires a date before Done,
and that date becomes a Task. Connect rate by weekday and hour comes straight
off `CallLog.createdAt` and outcome.

**1.2 Script pane in the dialer (M).** New `SurplusTemplate` model: kind,
version, body, last reviewed, active. Kinds: phone script, voicemail, claimant
letter, family letter, associate letter, credibility text, credibility email,
notary instructions. Merge fields: claimant first name, days searching
(today minus the first attempt, or lead creation), county, callback number,
caller name, fee terms from the compliance rule, the 24 to 48 hour window,
company name and website. During a surplus call the dialer shows the script
beside the case facts the caller needs: surplus at notice, claim status,
deceased and DNC flags. Templates are edited at a new `/settings/surplus`
page and the version in use is stamped on the call.

**1.3 Contact status and channel coverage, derived not ticked (M).**
`contactStatus` on the claimant: not tapped, tapped, recap scheduled. Set by
an inbound message, a spoke-to-claimant outcome, or a scheduled callback.
The four-channel checklist (called, emailed, lettered, texted) is computed
from CallLog, Message, Email and the letter history, so it cannot drift. The
board sorts Not tapped first, gains a "Missing a channel" chip and a column of
four glyphs. That filter is the weekly working list and the digest lists it.

**1.4 Credibility packet, one tap (S to M).** `POST /surplus/:id/credibility`
with the channels to use. Sends website, Sunbiz record, one-pager link and
callback number as Dig Deeper over the existing SMS and email paths. Logs an
activity with the items sent, so the panel shows "Packet sent Sep 3 by text"
and the dialer offers the button beside the objection sections of the script.
The one-pager PDF and a vCard are static assets on the web app. Blocked on
the website decision and the one-pager content.

**1.5 Tasks in the surplus panel (S).** Next action due date and owner,
reusing Task and the existing follow-up modal. Auto-created tasks: agreement
sent and unsigned after 5 days, claim filed with no acknowledgement after 21
days, check received then disburse within a day, letter mailed then recheck
at 14 days, plus every follow-up date from 1.1. The digest lists overdue
surplus tasks.

**1.6 Letter history and cadence (M).** `SurplusLetter` model: claimant or
heir, mailed at, address, template kind, mail type (standard, Priority,
FedEx), tracking number, sent by. Replaces the single mailed-at column, which
stays as a cache of the latest. Per-lead cadence (weekly or biweekly) and a
"letter due" flag when the last letter is older than the cadence. After three
unanswered standard letters the panel suggests Priority or FedEx. Letters are
generated from the template into a print view, so a letter is produced, not
just recorded.

### Phase 2. Documents and the signing gate

Covers the Documents plan and sections 1 to 4 of Claims Processing.

**2.1 County reference table (M).** `SurplusCounty`: name, state, claim form
file, assignment preference (full or partial), accepted submission methods,
signature required, attorney required, clerk contact and notes, court records
URL, surplus list URL, last verified. Seeded from the current county list.
Flagged for recheck when last verified is older than 180 days, the same rule
the compliance table already uses. Edited on the settings page. Removes the
hardcoded Duval links.

**2.2 File storage and SurplusDocument (L).** An S3-compatible bucket, since
Railway has no persistent disk. `SurplusDocument`: case, set (county or ours),
kind, file key, status (outstanding, sent, signed, notarized, filed), signed
at, template version, uploaded by. Replaces the eight booleans. Kinds: fee
agreement, limited POA, assignment of rights, letter of direction, notary
agreement, county claim form, photo ID, W-9, death certificate, letters of
administration, entity documents, title search, claims checklist. The panel
gains a Documents section with both sets, upload, and a completeness line
so the file is provably complete before it is submitted.

**2.3 Signing sequence gate (S once 2.2 exists).** The stage cannot move to
Assignment Notarized, which is where the fund source is disclosed, until the
fee agreement and limited POA are both marked signed. Claim Filed requires the
assignment, the county form and ID. Enforced in `update` and `bulkStage` and
explained in the panel with the missing items named. The compliance gate is
wired to the "send fee agreement" action and the Agreement Signed transition
instead of being a display payload.

**2.4 Templates with versions (S).** Our standard documents become
`SurplusTemplate` kinds with a version and last reviewed date. A case's
document records the version it was built from and shows a stale flag when
the template is revised afterwards. BoldSign stays optional: the course
signs at a mobile notary, so e-sign is only for the fee agreement if the team
wants retention before the notary visit.

**2.5 Notary packet (M).** Fields: notary name, contact, source, notary
agreement signed at (a gate before the claimant appointment can be set),
appointment at, signed-in-order confirmation. Generates the packet as a print
view: a cover sheet with the signing order, only the documents relevant to the
current stage, and the assignment withheld until the retention documents are
confirmed signed. A practice-run checklist per new county lives on the county
record.

**2.6 Attorney tracking (S).** Attorney required flag, name, firm, contact,
source. When set, county follow-up tasks are addressed to the attorney and the
panel shows the rule that nobody contacts the county directly.

### Phase 3. Claims processing to payout

**3.1 Back-half stages and a dead reason (S).** Stages become New, Contacted,
Agreement Signed, Assignment Notarized, Claim Filed, Awaiting Disbursement,
Check Received, Paid, Dead. `deadReason`: below floor, deceased with no heirs,
competing claim filed, unresponsive, already assigned, other, plus a note.
Dead requires a reason. Re-import already skips Dead and suppressed cases by
dedupe key; add a visible "previously worked" badge on the import preview
instead of a silent skip.

**3.2 Submission tracking (S).** Method, tracking number (required to enter
Claim Filed), signature required, submitted at, county acknowledged at, clerk
contact, clerk status note, additional documents requested, expected
disbursement.

**3.3 Two follow-up cadences (S, on top of 1.5).** County: a task at 21 days
after submission, then every 30, addressed to the attorney when one is
engaged. Claimant: last claimant update date, a monthly task, and a red flag
on the board and in the digest when it passes 30 days. The script and fee
agreement set the expectation of a monthly update.

**3.4 Disbursement (M).** Check received at, with a same-day task to notify
the claimant. `SurplusExpense` rows: kind, amount, date, note. A generated
disbursement report: gross, itemized expenses, fee per the rule, claimant
share. Claimant signed report at, as a gate before funds move. Clearing due
date auto-set at 30 days from check received. Check sent at, method, tracking
number. Final net. The net-in-pipeline stat becomes actual money.

**3.5 Survey and references (S to M).** Survey sent with the check, returned
at, bonus paid, reminder task at 10 days. `SurplusReference`: lead, consent,
name, story, state, county, quote. A reference library page searchable by
county. A recoveries counter from Paid records. Consented references lead the
credibility packet from 1.4.

### Phase 4. Skip tracing depth

**4.1 Trace attempt log (M).** `SurplusTraceAttempt`: target (claimant, heir
or associate), channel (free search, social, government records, paid
database, professional tracer, mail), ran at, cost, result, by whom. BatchData
runs write here automatically as paid database entries. The name-search links
get a "log this search" action so Tier 1 work is recorded. Warn when a paid
run happens with no Tier 1 entries. The professional tracer option shows only
for Tier A and B.

**4.2 Associates (M).** Generalize `SurplusHeir` with a role (heir by default,
relative, neighbor, friend, associate) and a contact status (not contacted,
contacted, message passed, dead end) with last contacted. Addresses, phones,
trace state and DNC are already built. The relative outreach script already
exists and attaches here.

**4.3 Effort gate before Dead (S).** Dead for unresponsive requires at least
one logged attempt in free search, social and mail, and a minimum call count.
Override allowed with a note.

**4.4 Recheck cadence (S).** Tasks to re-run Tier 1 at 60 days with no
contact and re-mail at 90 days. The attempt log is the recheck history. The
digest surfaces due rechecks.

**4.5 Mailing template library.** Delivered by 1.2 and 1.6.

## Decisions the team owns

1. Fee terms for Florida: the 12 percent cap versus the course's split, and a
   written opinion on tax deed surplus. Read against the statute text
   2026-09-11: FS 45.033 (12 percent) is mortgage foreclosure surplus, FS
   717.135 (30 percent) is accounts held by the Department of Financial
   Services, and FS 197.582 has no cap. Tax deed surplus held by the clerk
   is uncapped, so the agreement's 40/35/30 schedule applies there; the 30
   percent cap reaches a claim only once it has escheated. Counsel
   confirmation still pending.
2. Retention instrument: assignment, limited POA, or both, and full versus
   partial per county. Decided 2026-09-09: the limited POA plus an
   irrevocable direction to pay, no assignment. The claimant stays claimant
   of record. The stage is Package Notarized and the assignment is retired
   from the document set. Full versus partial per county is still open.
3. Stage list: adopt the three-axis model with back-half stages, or the
   course's 12 literally.
4. File storage vendor (S3 or R2) and who holds the keys.
5. Website: the course's free credibility site or a custom one on
   digdeeperllc.com. This blocks 1.4.
6. An 800 number for inbound credibility, BBB and yellow pages timing.
7. One-pager content.
8. Whether to e-sign the fee agreement before the notary visit.

## Suggested sequencing

| Slice | Items | Rough effort |
|---|---|---|
| First PR set | Phase 0, 1.1, 1.5 | 1 week |
| Second | 1.2, 1.4 (after the website decision) | 1 week |
| Third | 1.3, 1.6 | 1 week |
| Documents epic | 2.1 to 2.6, gated on storage | 3 to 4 weeks |
| Claims epic | 3.1 to 3.5 | 2 to 3 weeks |
| Tracing depth | 4.1 to 4.4, can interleave; 4.2 is cheap and useful early | 1 to 2 weeks |

Every item that adds a column or model needs a committed Prisma migration
using the snake_case table names. Every new board button is styled as
`button.<class>` because `.dc-board button` strips a bare class.

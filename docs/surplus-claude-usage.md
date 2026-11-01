# Claude API usage in the Surplus Funds back end

Written 2026-10-22 from the code on `master` (through commit `5cf4c6b`), as a
baseline for comparing Grok bots against what Claude does today. Section 1 and
the environment table were updated 2026-11-01 for the notice reader changes
(reads at day 95, drops blank pages, meters spend, model setting).

## The short version

**Claude does not pull cases from the county sites, and it does not maintain
them weekly.** That work is plain TypeScript: one adapter per county website,
a rules-based classifier, and a cron schedule. No LLM is involved in finding a
case, reading the docket, deciding its status, deduping it, or sweeping it
each week.

Claude is used in exactly four places on surplus leads, all of them *reading
or researching a person* rather than *pulling a case*:

| # | What | Model | When it runs | Billed per | Default |
|---|------|-------|--------------|-----------|---------|
| 1 | Read the scanned Notice of Surplus Funds (owner's mailing address) | `SURPLUS_NOTICE_MODEL` (default `claude-opus-5`), vision, effort low | Automatically, in the weekly pull, once per case, when the case's estimated claim clock reaches day 95 | Notice, metered in `vendor_usage` | ON, no monthly cap unless `SURPLUS_NOTICE_MONTHLY_BUDGET` is set |
| 2 | Read an uploaded probate filing (heirs) | `claude-opus-5`, PDF, effort low | Manually, a person uploads a PDF on the card | Filing | ON (manual only) |
| 3 | Obituary search on dead claimants (spouse and children) | `claude-sonnet-5-5` + web search + web fetch | Automatically after a pull, and on demand | Check, about 30 to 60 cents | PAUSED until `OBITUARY_MONTHLY_BUDGET` is set |
| 4 | Social profile search on unreachable living claimants | `claude-sonnet-5-5` + web search + web fetch | Manually only, from the card or `POST /surplus/social-search` | Check, about 30 to 60 cents | OFF (`SOCIAL_SEARCH_ENABLED=false`) |

Everything uses the one `ANTHROPIC_API_KEY`. If it is unset, every one of these
degrades gracefully and the pull still runs.

---

## How the county pull actually works (no AI)

This is the part a Grok bot would be replacing, so it is worth being precise
about what it is today.

**Adapters, one per county site** (`apps/api/src/surplus/`):

| Adapter | Counties | How the owner's address is obtained |
|---------|----------|-------------------------------------|
| `realtdm.adapter.ts` | Lee, Polk, Brevard, Pinellas, Sarasota, Lake, Alachua, Santa Rosa, Flagler | Published by RealTDM as structured data. **No Claude call.** |
| `pioneer-taxsmart.adapter.ts` | Duval, Citrus, Hernando | Only on a scanned notice PDF with no text layer. **Claude reads it (use #1).** |
| `charlotte-taxdeed.adapter.ts` | Charlotte | Only on a TIFF image of the notice. **Claude reads it (use #1).** |

**Schedule** (`surplus-poll.service.ts`, `surplus-cadence.service.ts`):

- `30 4 * * 1` ET: the weekly Monday pull of every county adapter.
- `45 5 * * *` ET: the daily slot (currently finds no adapter; Duval moved to weekly in #100).
- `15 6 * * *` ET: the cadence job (follow-up reminders, no AI).

**Per case, in order** (`surplus-ingest.service.ts`):

1. Adapter fetches the docket and the case's documents (HTTP scraping, honest
   `Mozilla/5.0 (compatible; DealcoreSurplusBot/1.0)` user agent).
2. `surplus-classify.util.ts` decides the claim status from the docket entries
   with rules and regexes (pending claim, paid out, workable, and so on).
3. Workable window filter: sales over a year old are dropped; day 110 to day
   365 off the notice is the working window.
4. Dedupe by county + case + parcel + claimant (`dedupeUid`), with tombstones so
   deleted cases stay deleted.
5. Create or update the `Lead` (`source='SURPLUS'`) and `SurplusDetail`. A
   case with a scanned notice lands with NO address and a claim clock estimated
   from the sale date (`noticeConfirmed=false`). Claude is not called here,
   except on an explicit re-read (`POST /surplus/poll` with `reread`).
6. After the pull: the obituary search (use #3) on new estates if its budget is
   set (the BatchData trace is retired), the matured-claim sweep, and then
   **the notice sweep, which is where Claude comes in (use #1)**: this county's
   workable cases with no address, an unread notice on the docket, and an
   estimated clock at or past `SURPLUS_NOTICE_READ_DAY` (default 95) get their
   notice read, and the recipients, the real notice date and the surplus at
   notice are written to every claimant on the case.

So the "weekly maintenance" (re-checking status, retiring paid-out cases,
sweeping cases that matured into the window) is all deterministic code. A
Grok comparison on that part is really a comparison against hand-written
scrapers, not against Claude.

---

## 1. Notice reader (automatic, in the weekly pull, from day 95)

**File:** `apps/api/src/surplus/surplus-notice.service.ts`
**Called from:** `surplus-ingest.service.ts` (`readMaturedNotices` after each
county's pull, via `surplus-poll.service.ts`; and `readNotice` on an explicit
re-read during a pull). Both go through one `readNoticeDoc` / `fetchNotice`
path, so Charlotte's viewer session and Pioneer's relative links are handled
in one place.
**Counties:** Duval, Citrus, Hernando, Charlotte
**Comparison script:** `apps/api/scripts/compare-notice-reads.ts` runs a folder
of notices through two model ids with this exact prompt and page preparation
and prints a field-by-field diff of the parsed JSON. It never touches the
database or the meter.

**Why it exists.** The person to skip trace is the owner the clerk *mailed* the
notice to, and that address is usually not the property (8 of 10 Duval owners
are out of the area). Tracing the property address returned the current
occupant: six strangers out of six on the first live run. The address only
exists on the notice, and those notices are scans with no text layer, so
`pdf-parse` gets nothing.

**When it runs.** Not when the case lands. A case that arrives with no address
keeps its clock estimated from the sale date (`noticeConfirmed=false`), exactly
as it did when a read failed. The address is first needed when the case
matures into the trace window at day 110 (`SURPLUS_TRACE_MIN_AGE_DAYS`), so
each county's weekly pull ends with a sweep that reads the notices of cases
whose ESTIMATED clock has reached `SURPLUS_NOTICE_READ_DAY` (default 95). The
sale date is always earlier than the true notice date, so estimated day 95
lands before the real day 110. A case the county pays out before then is never
read at all. The pull's run row says how many notices were read, how many
claimants got an address, and how many cases were skipped as too young.

**What it sends.** The notice as a base64 PDF document block, or for
Charlotte's TIFFs, one PNG per page (up to 24 pages, resized to a 1568 px long
edge with `sharp`), less the near-blank pages: a page whose greyscale mean is
235 or lighter with a standard deviation of 10 or under (an empty duplex back,
a scanner smudge) is dropped before upload, and the log says how many. A
printed page, even an empty Proof of Claim form, carries far more ink than
that and is always sent, so the prompt's one-page-per-recipient rule still
holds over what goes up. At least one page is always kept. Plus a fixed
prompt. Max 8 MB per file.

**Model and settings.** `SURPLUS_NOTICE_MODEL` (default `claude-opus-5`, read
once at boot), `max_tokens: 2000`, `output_config.effort: 'low'`. Opus is
deliberate, over the repo's usual Haiku extraction model: a misread street
number means calling a stranger about someone else's money, and the read runs
once per case. The API call sits behind a one-method `NoticeReaderClient`
interface (`AnthropicNoticeReaderClient` is the only implementation), so a
second vendor can be tried without touching the page preparation or the
parser.

**What it returns (JSON):**

- `recipients[]`: every addressee, one per page (co-owners can be at different
  addresses), with name, street, city, state, zip, country
- `noticeDate`: the real notice date, which starts the claim clock (before
  this it was estimated from the sale date and was off by weeks)
- `saleDate`
- `surplusAtNotice`: the surplus as stated on the notice (the number to quote
  on a call)
- `certificateNumber`, `taxDeedNumber`, `realEstateNumber`

**Prompt rules worth matching in any Grok test:** one recipient per page, never
merge or skip; never return the clerk's own letterhead address; skip blank
Proof of Claim pages; fall back to the mailing certification date when no
DATED value is printed; keep foreign addresses foreign (never squeeze Ontario
into "CA"); null for anything not printed, never guess; names exactly as
printed, including ESTATE.

**Guards in code after the reply:** the JSON is parsed tolerantly, and any
recipient at the Duval or Charlotte clerk's address is thrown away
(`isClerkAddress`), because that is the one wrong answer the layout invites.

**Cost controls:**

- Deferred to estimated day 95 (above), so a case paid out or retired before
  then is never read.
- Skipped when the case is not workable or marked Dead, when any claimant on
  the case already has an address, or when the same notice document was
  already read (`surplus_details.noticeReadDocId`, added in `5cf4c6b` after
  Pioneer counties were paying for the same read every Monday).
- A billed reply with no readable JSON counts as a read that named nobody, so
  it is not bought again next week. A fetch or API failure is not recorded and
  is tried again next week.
- Near-blank pages are dropped before upload (above).
- **Metered.** Every read is costed from the response's token usage at
  `SURPLUS_NOTICE_INPUT_PRICE` and `SURPLUS_NOTICE_OUTPUT_PRICE` (dollars per
  million, defaults are the `claude-opus-5` list prices and must be checked
  against the Anthropic price list whenever the model changes) and recorded in
  `vendor_usage` under vendor `notice`. `GET /surplus/notice-usage` returns the
  month in the same shape as `obituary-usage`; the board's Status menu shows
  the month's reads and dollars.
- `SURPLUS_NOTICE_MONTHLY_BUDGET` (dollars per month, New York time) pauses
  reads once the month cannot cover one more worst-case read (24 pages at full
  size plus the longest reply, about 36 cents at the default prices). Unset or
  0 is no cap, which is how it always ran. A paused sweep says so on the pull
  run and in `notice-usage` (`paused: true`).
- `SURPLUS_NOTICE_EXTRACT_ENABLED=false` turns it off (default on).

---

## 2. Probate filing reader (manual upload)

**File:** `apps/api/src/surplus/surplus-probate.service.ts`
**Called from:** `POST /surplus/:id/heirs/read-filing` via `surplus-heirs.service.ts`

**Why it exists.** The heirs of a dead claimant are only recorded in the
probate court file. Duval's CORE portal sits behind reCAPTCHA and a user
agreement (Florida Supreme Court order AOSC24-65), so the app does **not**
fetch it. A person finds the case, downloads the petition or order, and
uploads it. Claude reads it.

**Model and settings.** `claude-opus-5`, `max_tokens: 3000`, effort low, PDF up
to 12 MB.

**What it returns (JSON):** decedent, date of death, case number, property
address, parcel ID, `heirs[]` (name, relationship and share copied verbatim,
their own street address, deceased flag, date of death), and `warnings[]`
(for example, the heir's address is the decedent's, or the parcel and address
describe different properties).

**Nothing is saved directly.** Every heir is shown for a person to confirm
first, since a wrong heir is a stranger told they have money coming.

---

## 3. Obituary search (automatic after a pull, or on demand)

**File:** `apps/api/src/surplus/surplus-obituary.service.ts`
**Called from:** `surplus-poll.service.ts` after each pull (new leads only), and
`POST /surplus/obituary-search`. Usage at `GET /surplus/obituary-usage`.

**Why it exists.** Vendor death records miss people (the SSA death file
stopped carrying most state-reported deaths in 2011), and an obituary names
the spouse and children, which no people search does.

**Scope (decided 2026-09-16):** only estates with nobody reachable. That is, a
claimant already known dead, meeting `traceCriteria`, not yet checked, with no
living heir or relative holding a callable non-DNC number. Living claimants are
never searched. Biggest surplus first.

**Model and settings.** `OBITUARY_MODEL` (default `claude-sonnet-5-5`),
`max_tokens: 8000`, effort medium, server-side fallback beta. Server tools:
`web_search` (max 4 uses) and `web_fetch` (max 3 uses, 6000 tokens each).
Up to 4 `pause_turn` continuation rounds.

**Input:** name, known death status and date, known places (property and the
clerk's mailing address), up to 10 known relatives.

**Output (JSON):** `verdict` (`strong` / `possible` / `none`), obituary URL,
name as printed, date of death, place, a one or two sentence `evidence`, and
`survivors[]` (name, relationship, city).

**What the app does with it:**

- `strong`: marks the claimant deceased and HEIR_ESTATE, takes the date, files
  the spouse and children only (`isDirectSurvivor` drops in-laws,
  grandchildren, siblings) as `SurplusHeir` rows, and looks them up on
  EnformionGo when run from the card (the automatic run only files them).
- `possible`: writes a "check before calling" note; a person confirms or
  rejects on the card.
- `none`: stamps it checked so it is not paid for again.

**Cost controls:** paused entirely until `OBITUARY_MONTHLY_BUDGET` (dollars per
month) is set. Every check is costed from token usage plus $0.01 per web search
and recorded in `vendor_usage` (vendor `obituary`). A check is refused before
spending if the month cannot cover a $0.60 worst case. Measured at 30 to 56
cents a check.

---

## 4. Social profile search (manual only, currently off)

**Files:** `apps/api/src/surplus/surplus-social.service.ts`,
`surplus-social.util.ts` (prompt, URL parsing, cost)
**Called from:** `POST /surplus/:id/social/find` (one person from the card) and
`POST /surplus/social-search` (a batch). Usage at `GET /surplus/social-usage`.

**Why it exists.** About half the claimants have no live phone or address, but
most still have a Facebook. There is no people-search API for Facebook,
Instagram, LinkedIn, X or TikTok, and Google's Custom Search API is closed to
new customers, so Claude runs the same public web search a person would.

**History.** It ran automatically after pulls until the 2026-09-21 Citrus pull
sent 148 web-search checks (about $61) unasked. It became manual only in #96,
and was turned off by default on 2026-10-05 because it was most of the Claude
bill and was not producing numbers to call.

**Scope:** living claimants (or a named heir) with no callable number, meeting
`traceCriteria`, not yet searched. Entities and surname-only names are refused.

**Model and settings.** `SOCIAL_SEARCH_MODEL` (default `claude-sonnet-5-5`),
`max_tokens: 8000`, effort medium, server-side fallback. `web_search` (max 6),
`web_fetch` (max 3).

**Input:** name, status, approximate age if known, known places, up to 10
relatives, and profile URLs already rejected for this person.

**Output (JSON):** up to 5 `profiles[]` (platform, URL, display name,
`strong`/`possible`, evidence) and up to 8 `leads[]` (spouse, relative, alias,
employer, business, school, team, city, age) to help a logged-in person tell
the right profile from namesakes. Phone numbers, emails and street addresses
are forbidden in leads.

**What the app does with it:** files each profile as a CANDIDATE for a person
to confirm or reject, appends the leads to call notes, logs a
`SurplusTraceAttempt` with its cost. **Nothing is ever messaged by a bot**;
messages go out by hand through deep links and are logged as touches.

**Cost controls:** off unless `SOCIAL_SEARCH_ENABLED=true`; optional
`SOCIAL_SEARCH_MONTHLY_BUDGET` ceiling; same per-check costing and
`vendor_usage` (vendor `social`) as the obituary search.

---

## What Claude is NOT used for on surplus leads

- Scraping or navigating county websites (adapters do this).
- Classifying claim status, the workable window, dedupe, or the weekly sweep.
- Skip tracing (BatchData, and Endato/EnformionGo from the card only).
- Texting or emailing claimants. Surplus leads are excluded from campaign
  enrollment (`campaign-enrollment.service.ts`) and from CAMP extraction on
  calls (`calls.service.ts`). No AI drafts surplus outreach.
- The Daily Brief's surplus section (assembled from DB queries, no AI).
- The spreadsheet import (`surplus-import.service.ts`).

---

## Environment variables

| Variable | Effect | Default |
|----------|--------|---------|
| `ANTHROPIC_API_KEY` | Required for all four uses | unset disables all |
| `SURPLUS_NOTICE_EXTRACT_ENABLED` | `false` turns off the notice reader | on |
| `SURPLUS_NOTICE_READ_DAY` | Day of the estimated claim clock the weekly pull first reads a notice on | `95` |
| `SURPLUS_NOTICE_MODEL` | Model for the notice reader, read once at boot | `claude-opus-5` |
| `SURPLUS_NOTICE_INPUT_PRICE` | Dollars per million input tokens for that model, for the meter. Check the price list. | `5` |
| `SURPLUS_NOTICE_OUTPUT_PRICE` | Dollars per million output tokens for that model, for the meter. Check the price list. | `25` |
| `SURPLUS_NOTICE_MONTHLY_BUDGET` | Dollars per month for notice reads; unset or 0 is no cap | unset (no cap) |
| `OBITUARY_MONTHLY_BUDGET` | Dollars per month; unset or 0 pauses the obituary search | unset (paused) |
| `OBITUARY_MODEL` | Model for the obituary search | `claude-sonnet-5-5` |
| `SOCIAL_SEARCH_ENABLED` | `true` turns on the social search | `false` |
| `SOCIAL_SEARCH_MONTHLY_BUDGET` | Optional dollar ceiling | unset (no cap) |
| `SOCIAL_SEARCH_MODEL` | Model for the social search | `claude-sonnet-5-5` |
| `SURPLUS_AUTO_TRACE` | `true` turns the retired BatchData rung back on after a pull | `false` |

The probate reader hardcodes `claude-opus-5`; there is no env override for it.

---

## Notes for the Grok comparison

1. **The like-for-like test is the notice reader.** It is the only Claude step
   inside the county pull. Take a set of Duval, Citrus, Hernando and Charlotte
   notices whose addresses a person has already verified, run both models on
   the same files with the same prompt, and compare the JSON field by field.
   The failure modes that matter: the clerk's address returned as the owner's,
   a co-owner page merged or skipped, a street number misread, a foreign
   address forced into a US shape, and a guessed value where the form was blank.
2. **"Pulling and maintaining cases weekly" is not Claude today.** If Grok bots
   would replace the adapters themselves (navigating each county site with an
   agent instead of a scraper), the baseline to beat is the deterministic code:
   zero per-run model cost, repeatable output, and unit tests per county. An
   agent earns its place mainly on counties nobody has written an adapter for
   yet, and in finding new counties' data sources.
3. **The two web-search uses are the closest fit for a research bot**, but they
   are the most expensive and the least productive today (social search is off
   for that reason). If Grok is cheaper per search, these are where a
   head-to-head would show it, as long as the output keeps the same
   candidate-then-confirm shape and never invents URLs.
4. **Keep the human gates.** Heirs from probate, possible obituary matches and
   every social profile go to a person before anything is written or anyone is
   contacted. Any replacement should return candidates with evidence, not
   write records directly.
5. **Spend tracking is uneven.** The obituary and social searches and, since
   2026-11-01, the notice reader meter themselves in `vendor_usage`; the
   probate reader does not. For a fair cost comparison on the notice reader,
   `GET /surplus/notice-usage` has the month, and the comparison script prints
   each read's tokens and estimated cost for both models.

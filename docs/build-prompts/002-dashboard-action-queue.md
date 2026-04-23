# Dealcore: Dashboard Action Queue + Empty State Audit

## Context

Dealcore users are struggling to know what to do next. The current dashboard 
shows useful metrics (active leads, need action now, strike zone, etc.) but 
the numbers don't translate into action. Users see "15 Need Action Now" but 
have to manually figure out which 15 leads, what each one needs, and in 
what order to handle them.

This is becoming an acute problem before lead volume scales. Solve it now.

The redesigned dashboard should answer one question above all others: 
"What should I do right now?"

This work also includes a sweep of empty states across the product, which 
currently show dead space ("ARV pending", "0 follow-ups", empty Offer 
History) instead of actionable CTAs.

Codebase: /Users/geoff/Documents/Property Investing/fast-homes-crm

Match patterns established by the recently-merged sidebar + command palette 
work. Read the new dashboard and any existing follow-up/task-related code 
before planning.

---

## Feature flag

Gate the new dashboard behind:
NEXT_PUBLIC_DASHBOARD_V2=actionqueue (new) | metrics (current, default)

Empty state improvements (Phase 4) ship without a flag — they're polish 
and shouldn't gate.

---

## Phase 1: Action Queue data layer

Build a NestJS service that produces a prioritized list of actions for 
the current user. Each action has:

- id (stable, so dismissals/snoozes work)
- type (enum, see categories below)
- priority score (0–100, used for sort order)
- lead_id (and denormalized lead snapshot: address, photo URL, seller name, 
  tier, stage)
- title (short — "Reply to Kelley G.")
- subtitle (context — "Hot lead, replied 2h ago: 'I am available to talk'")
- suggested_action (verb + target — "Send reply", "Send offer", "Mark dead")
- ai_draft (optional — AI-generated message preview if applicable)
- created_at, expires_at (optional, for time-sensitive items)
- snoozed_until (nullable)
- dismissed_at (nullable)

ACTION CATEGORIES (with rule definitions — these are starting points; 
ask Geoff to confirm thresholds before implementing):

NEEDS_REPLY (priority 90–100)
- Trigger: lead has inbound message (SMS/email) with no outbound response 
  in last 1 hour
- Higher priority for hot/strike-zone tier leads
- AI draft: generate a CAMP-aware reply preview using lead context

STALE_HOT_LEAD (priority 70–85)
- Trigger: lead is tier 1 (hot/strike zone) with no contact in 48+ hours
- Suggested action: "Send follow-up" with AI-drafted message

OFFER_READY (priority 75–90)
- Trigger: lead has Deal Analysis completed, MAO calculated, and stage 
  is Qualified or Negotiating, but no offer recorded in Offer History
- Suggested action: "Send offer at $XXX,XXX"

CAMP_INCOMPLETE (priority 50–65)
- Trigger: lead is tier 1 or 2 and CAMP Discovery is <4/4 complete after 
  3+ touches
- Suggested action: "Ask about [next CAMP question]"

FOLLOW_UP_DUE (priority 80–95)
- Trigger: user-scheduled follow-up date has arrived
- Priority bumps as items become overdue
- Manual follow-ups always sort with their scheduled time, not auto-rules

CONTRACT_PENDING (priority 95)
- Trigger: contract sent for signature 24+ hours ago, not yet signed
- Suggested action: "Nudge seller about contract"

DRIP_REPLY_REVIEW (priority 70–80)
- Trigger: lead enrolled in drip campaign received a reply (drip auto-paused)
- Suggested action: "Review reply and continue conversation"

EXHAUSTED_LEAD (priority 30–40)
- Trigger: lead has 15+ touches with zero replies AND last contact 7+ days ago
- Suggested action: "Mark as dead" or "Move to long-term nurture"

NEW_LEAD_INBOUND (priority 60–75)
- Trigger: lead created in last 24h via inbound source (not bulk import)
- Suggested action: "Make first contact"

The service should:
- Query active leads, evaluate rules, return top 50 actions sorted by priority
- Cache per-user for 60 seconds (recompute on lead state changes)
- Exclude snoozed/dismissed items until they re-qualify
- Support filtering by category for the UI

Endpoint: GET /api/actions/queue
Mutation endpoints:
- POST /api/actions/:id/dismiss
- POST /api/actions/:id/snooze (body: until_timestamp)
- POST /api/actions/:id/complete (marks as done; logs to lead activity)

---

## Phase 2: Action Queue UI (new dashboard)

Replace the current dashboard's main content area with the Action Queue. 
The page header stays ("Good morning, Geoff" + date). Below the header:

LAYOUT

Two-column layout on desktop:
- Left (~70% width): Action Queue
- Right (~30% width): Today at a Glance + Quick Actions

QUICK STATS BAR (top of page, above the two columns)

Compact horizontal strip showing tier counters — keep the existing 
treatment from the current dashboard but condensed:
Active Leads • Need Action • Strike Zone • Hot+Workable • Under Contract • Closed

Each is clickable, filtering the Action Queue (or, for Closed/Under Contract, 
navigating to Leads filtered to that stage).

ACTION QUEUE (left column, primary)

Header: "Your Action Queue" + count + filter chips
Filter chips (multi-select): All | Replies | Follow-ups | Offers | Stale | Other
Sort: Priority (default) | Oldest first | Newest first

Each action item is a card with:
- Lead photo thumbnail (small, square, left-aligned)
- Title (bold) — "Reply to Kelley G."
- Lead context line — address • tier badge • stage badge
- Subtitle — what triggered this action ("Replied 2h ago: 'I am available to talk'")
- AI draft preview (collapsed by default, expandable) — when applicable, 
  show a "✨ AI suggested reply" expandable section with the draft + 
  "Send", "Edit", or "Regenerate" buttons
- Primary action button (right-aligned) — varies by type: "Send reply", 
  "Send offer", "Schedule follow-up", "Mark dead", etc.
- Secondary actions (kebab menu): Snooze (1h, 4h, tomorrow, custom), 
  Dismiss, Open lead

Visual treatment:
- Priority 90+ items get a subtle red/orange left border
- Snooze button is prominent — users need to defer noise quickly
- Completing an action triggers a brief success animation, then the 
  card animates out and the next one slides up

Empty state for the Action Queue (when no actions exist):
- Friendly graphic
- "You're all caught up. New actions will appear as leads need attention."
- Secondary CTA: "Browse all leads" → /leads

TODAY AT A GLANCE (right column, top)

Compact widget showing today's activity:
- Messages sent today (count)
- Replies received today (count)
- Calls completed today (count)
- Offers sent today (count)
- New leads added today (count)

Each is a small stat with an icon. Clicking drills into a filtered view 
(future enhancement — for v1, just display the numbers).

QUICK ACTIONS (right column, middle)

Buttons for common actions:
- "+ New Lead"
- "Search leads" (opens command palette)
- "Schedule follow-up" (opens follow-up modal, lead picker first)
- "Compose message" (opens message composer, lead picker first)

UPCOMING FOLLOW-UPS (right column, bottom)

The next 5 scheduled follow-ups (regardless of priority — manual schedule 
items always show here so users trust their calendar).
- Time, lead address, action description
- Click to open lead

If empty: "No upcoming follow-ups" + "Schedule one" CTA (don't leave it 
as dead space — current dashboard has this problem).

---

## Phase 3: Follow-up system

Users currently have no easy way to create and action follow-ups. Build 
a lightweight follow-up system that integrates with the Action Queue.

DATA MODEL

Follow-up: id, lead_id, user_id, scheduled_at, action_type 
(call/text/email/custom), notes, completed_at, completed_by, created_at

CREATION

Three entry points:
1. From a lead detail page: "Schedule Follow-up" button (already exists 
   in the current Overview sidebar — wire it to this new system)
2. From the Action Queue Quick Actions widget
3. From the command palette: "Schedule follow-up" action

Follow-up modal:
- Lead picker (if not pre-filled) with command-palette-style fuzzy search
- Date/time picker (with quick options: In 1 hour, Tomorrow 9am, In 3 days, Next week)
- Action type picker (call, text, email, custom)
- Optional notes
- Save → creates follow-up record, surfaces in Upcoming Follow-Ups widget

EXECUTION

When the scheduled time arrives:
- Follow-up appears in Action Queue as FOLLOW_UP_DUE category
- After 24h overdue, priority increases
- "Complete" action marks done and logs to lead activity timeline
- "Reschedule" action reopens the modal

LEAD DETAIL INTEGRATION

The existing "Follow-Ups" widget on the lead detail page (right column) 
should now show real upcoming follow-ups for that lead, with the same 
"Schedule" CTA, and a list of past completed follow-ups below.

---

## Phase 4: Empty state audit

Sweep these locations and replace dead-space empty states with actionable 
CTAs. Each fix should follow the principle: never show "0" or "pending" 
or "no data" without an obvious next step.

DASHBOARD (where applicable after Phase 2)
- Old "Follow-Ups: 0 pending" widget → replaced by Phase 2 work

LEAD DETAIL — OVERVIEW
- "Valuation: ARV pending — REAPI data loading or not available" → 
  show two CTAs: "Run Full Analysis" and "Manually enter ARV"
- "Quick Actions" section currently has only "Mark as Dead" → expand to: 
  Send Drip, Schedule Follow-up, Share with Partners, Start AI Call, 
  Generate Offer, Mark as Dead. Use icon buttons in a grid.
- "Follow-Ups: No upcoming follow-ups. Schedule one from a lead page." → 
  inline "+ Schedule" button right there

LEAD DETAIL — DEAL ANALYSIS
- "Deal Worthiness: NEED DATA" → make the missing data items clickable. 
  Clicking "Asking price" should open an inline draft message: 
  "Ask seller for asking price?" with AI-drafted text and a Send button
- "Red Flags" → each flag gets a "Dismiss" or "Address" action, not 
  just static text

LEAD DETAIL — DISPOSITION
- "Offer History: No offers yet" → "Create offer at AI-suggested MAO 
  of $XXX,XXX" CTA (pulls from Deal Analysis)
- "Contract Details: No contract yet" → "Create Contract" should be 
  disabled until an offer is accepted, with hover tooltip explaining why

LEADS PAGE
- "Spread" column blank cells → small "+ Add ARV" or "+ Add asking" 
  inline action that opens an edit popover

PARTNERS PAGE
- Currently shows just a list. When empty (new accounts), show: 
  "Add your first buyer partner to start dispositioning deals" 
  with prominent CTA

DRIP CAMPAIGNS — STEP FUNNEL
- Empty step rows (Steps 15–30 with 0 sent) → instead of showing 
  empty bars, hide all-zero trailing steps behind a "Show all 30 steps" 
  expander. Only show steps with traffic by default.

GENERAL RULE FOR ALL EMPTY STATES

Each empty state should answer:
1. What should be here?
2. Why isn't it here yet?
3. What can the user do about it (with a button, not prose)?

If a state genuinely has nothing the user can do, hide it entirely 
rather than showing "0" or "—".

---

## Phase 5: Notifications and badge wiring

The sidebar Inbox badge (placeholder from sidebar work) should now wire 
to: count of NEEDS_REPLY actions in the Action Queue.

The sidebar Leads badge should wire to: count of NEW_LEAD_INBOUND actions.

The future top-nav notifications icon (slot reserved in sidebar work) 
should remain unbuilt — but the action queue is the data source it will 
eventually use, so make sure the action service exposes a 
"unread/unactioned count since last visit" field for future use.

---

## Build order

1. Action Queue data layer: schema, rules engine, endpoints
2. Action Queue UI shell + first action category (NEEDS_REPLY) end-to-end
3. Add remaining action categories one at a time, verifying each
4. Today at a Glance + Quick Actions widgets
5. Follow-up data model + endpoints
6. Follow-up modal + creation flows + Action Queue integration
7. Lead detail follow-up widget update
8. Upcoming Follow-Ups widget on dashboard
9. Empty state audit sweep (Phase 4)
10. Sidebar badge wiring (Phase 5)
11. Polish: animations, loading states, error handling
12. Performance pass — Action Queue should load in <500ms for users 
    with 500+ active leads

---

## Acceptance criteria

- Flag off → current dashboard unchanged
- Flag on → Action Queue is the dashboard
- Every action item has a clear primary action button
- Snooze and dismiss work; snoozed items reappear when their time arrives
- AI-drafted reply previews are accurate and contextually appropriate 
  (use lead conversation history, CAMP data, tier, stage)
- Follow-ups can be created from at least 3 entry points (lead detail, 
  command palette, dashboard quick action)
- Follow-ups surface in Action Queue at scheduled time
- Completing a follow-up logs to lead activity timeline
- All empty states from Phase 4 have actionable CTAs or are hidden
- Sidebar Inbox + Leads badges show real counts
- No regressions to other pages
- Action Queue loads in <500ms for accounts with 500+ active leads
- Mobile: Action Queue is usable on phone (single column, full-width 
  cards, swipe actions for snooze/dismiss optional but nice)

---

## Open questions to surface during planning (do not guess answers)

Before implementing, confirm with Geoff:
1. Are the priority score thresholds (e.g., NEEDS_REPLY 90–100) reasonable, 
   or should they be tuned?
2. The 1-hour "no outbound response" trigger for NEEDS_REPLY — is that the 
   right window, or should it be shorter (15 min for hot leads) or longer?
3. The 15-touch / 7-day exhausted-lead threshold — should this auto-advance 
   the lead's tier to Tier 3 (cold), or just surface as an action?
4. Should completed actions log a custom note to the lead activity timeline, 
   and if so, what format?
5. For AI-drafted replies in the Action Queue: send-on-click, or always 
   require a confirmation step?

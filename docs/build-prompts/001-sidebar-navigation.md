# Dealcore: Collapsible Left Sidebar Navigation + Command Palette + Split Settings

## Context

Dealcore currently uses top-bar navigation (Dashboard, Leads, Drip Campaigns, 
Deal Search, Partners, Team, Settings). As the product grows, horizontal nav 
is breaking down. Replace with a collapsible left sidebar, grouped by user 
intent, plus a Cmd+K command palette for power users. Split settings into 
workspace-level and personal-level concerns with distinct entry points.

Codebase: /Users/geoff/Documents/Property Investing/fast-homes-crm 
(NestJS + Next.js monorepo). Match existing component conventions, 
styling patterns, and state management approach already in use.

Before writing any code, read the current top-nav layout file and the 
existing Settings page(s). Confirm your implementation plan — including 
which existing settings content maps to which new section — before 
proceeding.

## Feature flag

Gate the entire new navigation behind an environment variable:
NEXT_PUBLIC_NAV_LAYOUT=sidebar (new) | topbar (current, default)

Preserve the existing top-bar nav code intact. Do not delete or refactor it. 
Users on the old flag value should see zero change.

---

## Phase 1: Sidebar shell and navigation

Build a collapsible left sidebar with three states:
- Expanded (default on desktop ≥1024px): ~240px wide, shows icon + label
- Collapsed: ~64px wide, icons only, labels shown as tooltips on hover
- Hidden (mobile <768px): off-canvas, toggled by hamburger icon in header

Persist the collapsed/expanded state per user (localStorage for v1; 
migrate to user settings table later).

Dealcore logo at the top of the sidebar:
- Rendered larger than its current top-bar size (roughly 1.3–1.5× scale — 
  use judgment based on sidebar width to feel prominent but not dominant)
- Expanded state: full "dealcore" wordmark
- Collapsed state: just the "D" mark icon, centered
- Clickable, routes to Dashboard

Navigation structure, grouped with section headers:

WORKSPACE
- Dashboard
- Inbox (placeholder route — "Coming soon" page)

PIPELINE
- Leads
- Deals (placeholder — filters Leads to Under Contract + Closed)

ACQUISITION
- Deal Search
- Drip Campaigns
- Comps & Analysis (placeholder route)

NETWORK
- Partners
- Team

BOTTOM (pinned to sidebar bottom)
- Settings (→ Workspace Settings, see Phase 4)

Badge support: each nav item should accept an optional numeric badge 
(rendered as a small pill next to the label when expanded, as a dot 
indicator when collapsed). Wire up these badges now with placeholder 
zero values — data source to be connected later:
- Inbox: unread replies count
- Leads: new leads count (last 24h)
- Drip Campaigns: leads awaiting reply review

The active route should be visually indicated, matching the current 
top-bar active-state treatment (pill/highlight pattern already in use).

---

## Phase 2: Command palette (Cmd+K / Ctrl+K)

Keyboard shortcut opens a centered modal with a search input and 
categorized results.

NAVIGATION
- Every sidebar destination ("Go to Dashboard", "Go to Leads", etc.)

LEADS
- Fuzzy search across all leads by property address, seller name, 
  or phone number
- Results show property photo thumbnail, address, seller name, stage, tier
- Selecting a result navigates to that lead's detail page

ACTIONS
- "New Lead" → opens new lead modal
- "New Drip Campaign" → navigates to campaign builder
- "Search deals" → opens Deal Search

Keyboard navigation: arrow keys to move, Enter to select, Escape to close.
Recent/frequent items surface at the top when the search is empty.

Reuse existing search infrastructure from the Leads page if available. 
If no reusable service exists, create a lightweight search endpoint 
in NestJS that indexes leads by address, seller name, and phone — 
a simple ILIKE query is sufficient for v1.

---

## Phase 3: Top nav cleanup and logo relocation

Restructure the top header:

REMOVE from top nav:
- All primary navigation links (Dashboard, Leads, Drip Campaigns, 
  Deal Search, Partners, Team, Settings)
- Dealcore logo from its current top-left position (moved to sidebar)

KEEP in top nav (right-aligned):
- Theme toggle (light/dark)
- User profile control (avatar + dropdown menu — see below)

ADD to top nav:
- Global search trigger: a search icon with "⌘K" keyboard shortcut hint, 
  positioned to the left of the theme toggle. Clicking it (or pressing 
  Cmd+K / Ctrl+K anywhere in the app) opens the command palette.
- Reserve space to the left of the search icon for a future 
  notifications icon — do not build it now, but leave the slot so 
  adding it later doesn't shift layout.

Visual balance: the top nav will be mostly empty on the left side. 
This is intentional — leave it empty rather than adding filler. 
The clean left side gives a lighter, modern feel and makes the 
right-side controls feel purposeful.

Mobile (<768px): top nav shows a hamburger icon on the left (opens 
off-canvas sidebar), logo centered, user/theme controls on the right.

USER AVATAR DROPDOWN

When the user clicks their avatar in the top-right, show a dropdown menu:
- Header: user name + email (non-clickable)
- "Personal Settings" → /settings/personal
- "Workspace Settings" → /settings/workspace (duplicate entry point 
  for convenience — same destination as sidebar Settings)
- Divider
- "Keyboard Shortcuts" → opens a modal showing all shortcuts
- "Help & Documentation" → placeholder link
- Divider
- "Log out"

---

## Phase 4: Split settings into Workspace vs. Personal

Settings currently exist as a single destination. Split into two distinct 
areas with different entry points and different scopes.

WORKSPACE SETTINGS
Entry point: sidebar "Settings" link (bottom group) + user avatar dropdown
Route: /settings/workspace/*
Scope: things that affect the team, the business, or shared resources. 
Changes here are visible to or impact other team members.

Suggested sections — scaffold only those with real content to migrate. 
Skip or leave as clearly-labeled placeholders for sections without 
existing content:
- Team & Members — invite users, roles, permissions
- Integrations — Smrtphone, Gmail, Vapi, ElevenLabs, ATTOM, RentCast, 
  Google Maps, Anthropic API keys
- Drip Campaign Defaults — send windows, quiet hours, DNC list, 
  default templates
- AI Configuration — CAMP framework tuning, auto-respond rules, 
  AI call voice selection, AI analysis prompt customization
- Pipeline Stages — customize stage names, auto-advancement rules
- Billing & Subscription — plan, invoices, usage
- API & Webhooks — reserved for future

PERSONAL SETTINGS
Entry point: user avatar dropdown in top nav
Route: /settings/personal/*
Scope: things that only affect the current user. Invisible to teammates.

Sections:
- Profile — name, email, avatar, phone
- Password & Security — password change, 2FA, active sessions
- Notifications — email/SMS/in-app preferences per event type 
  (new hot reply, lead assigned to me, AI call completed, 
  contract signed, weekly digest)
- Display Preferences — theme (light/dark/system — three-way choice 
  here, even though top-nav toggle is light/dark binary), default 
  Kanban density, default Leads view (List/Grid), sidebar collapsed 
  by default
- Keyboard Shortcuts — reference list

PERMISSIONS

Workspace Settings should eventually be role-gated (admin vs. member). 
For v1, all authenticated users can access all workspace settings. 
Scaffold the role check hook points so adding enforcement later is a 
small refactor. Add a TODO comment at each workspace route indicating 
where the role check will go.

MIGRATION

Audit the existing Settings page and move each item to its correct home. 
If any item is ambiguous, leave it in Workspace Settings by default 
(reversible later) and flag for Geoff to review before finalizing.

Do not delete the existing Settings route until all content has been 
migrated and verified. Redirect the old route to /settings/workspace 
to preserve bookmarks and deep links.

---

## Build order

1. Feature flag plumbing + sidebar shell (empty, just the collapse mechanic)
2. Nav items + routing + active state + logo placement
3. Persistent collapsed state per user
4. Badge rendering (placeholder data)
5. Command palette modal + keyboard shortcut
6. Command palette search (nav + leads + actions)
7. Top nav cleanup (remove old nav, reposition controls, add search trigger)
8. User avatar dropdown with menu contents
9. Split settings: scaffold new routes and navigation structure
10. Migrate existing settings content to correct locations
11. Old /settings redirect
12. Mobile off-canvas behavior
13. Visual polish pass — spacing, transitions, hover states match rest of app

---

## Acceptance criteria

- Flag off → zero visible change to current product
- Flag on → new sidebar, Cmd+K works, all existing routes still load
- Collapsed sidebar state persists across page reloads
- Mobile: sidebar slides in/out, doesn't overlap content when closed
- All current top-nav destinations reachable from sidebar
- Dealcore logo prominent in sidebar, collapses to "D" mark when sidebar collapsed
- Top nav retains only: search trigger, theme toggle, user avatar dropdown
- Command palette returns lead results in <300ms for up to 10,000 leads
- Settings accessible from two entry points: sidebar (workspace) and 
  user avatar dropdown (personal)
- Workspace and Personal settings are clearly distinct in UI — different 
  headers, different navigation, no cross-contamination
- All previously existing settings are migrated to the correct location
- Old /settings route redirects to /settings/workspace
- User avatar dropdown renders consistently across pages
- No regressions to any existing page

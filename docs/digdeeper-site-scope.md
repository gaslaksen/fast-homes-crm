# Dig Deeper Website and One-Pager

Scope for a separate workstream. Written 2026-09-08. The Dealcore side is
already built: the credibility packet in PR #32 sends whatever three URLs are
set in `DIGDEEPER_WEBSITE_URL`, `DIGDEEPER_SUNBIZ_URL` and
`DIGDEEPER_ONEPAGER_URL`. This workstream produces the first two of those
things and finds the third.

## Goal

A claimant on the phone with Dig Deeper can be texted a link, open it on
their phone, and see a real company: who it is, what it does, what it costs,
and how to call back. That is the course's Instant Credibility packet and
the answer to the Big Four (who are you, are you real, what does it cost,
can I trust you). Success is a packet that goes out from the CRM with no
blank links and a page that loads in under two seconds on a phone.

## Where things stand

- `digdeeperllc.com` is owned. Email already runs on the subdomain
  `crm.digdeeperllc.com` through Mailgun. The apex has DNS pointing at a
  parking service and nothing answers on the web.
- Dig Deeper LLC is an active Florida entity with a registered agent, a
  business phone line at (904) 595-9620, and a business email domain.
- The CRM's brand constant for Dig Deeper carries name and phone only. The
  email signature omits the website line until there is one.
- No logo, no copy, no one-pager exists yet.

## Deliverables

1. **A one-page static website at `https://digdeeperllc.com`.** Sections:
   who we are (Florida company, what surplus funds are in two sentences),
   what we do (locate former owners, handle the claim, paid only on
   recovery), how the fee works (contingency, no advance fee, no recovery no
   fee; the percentage stated only as "capped by Florida law" or the
   compliance rule's figure, never a typed split), verify us (link to the
   Sunbiz record, the registered agent address, the phone number as a tel
   link), contact (phone, email, hours), and a download link for the
   one-pager. Mobile first, no framework needed, no tracking scripts, no
   forms in the first version.
2. **The one-pager PDF at `https://digdeeperllc.com/overview.pdf`.** One
   page, formatted like a company overview and not a sales flyer: the same
   four things as the site plus the entity details. Under 1 MB so it opens
   on a phone over cellular.
3. **The Sunbiz URL.** The entity's detail page on `search.sunbiz.org`,
   found by searching the LLC name. No hosting; just the link, confirmed to
   open without a session.
4. **Hosting and DNS.** A Vercel project for the site with the apex and
   `www` pointed at it. The `crm.` subdomain and its MX and TXT records for
   Mailgun must not be touched.
5. **Handover.** The three URLs set in Railway, a test send of the
   credibility packet to a team phone and email from a test lead, and the
   CRM brand constant updated with the website so the email signature
   carries it.

## Not in scope

- The reference library, testimonials, or a BBB listing. References do not
  exist yet; the site gets a section for them when they do.
- An 800 number. Separate decision.
- Any form that collects a claimant's details. The CRM is the intake.
- A blog, SEO work, or paid search.
- Changes to the CRM beyond the brand constant and the env vars.

## Decisions the team owns before build

1. **Content.** The four sections above need real copy. A draft can be
   written in this workstream, but the fee wording and the description of
   the service should be read by whoever is answering to the compliance
   rule, since the site is a representation to claimants.
2. **Where the site lives in git.** Recommended: a folder `apps/digdeeper-site`
   in the Dealcore monorepo with plain HTML, CSS and the PDF, deployed as
   its own Vercel project with that folder as the root. One repo to
   maintain, no package to build, and the existing web app's Vercel project
   is unaffected. The alternative is a separate repository.
3. **DNS access.** Who holds the registrar login for `digdeeperllc.com`.
   Pointing the apex at Vercel needs an A record and a CNAME for `www`.
4. **Logo and name treatment.** "D.I.G Deeper LLC" appears in the course
   notes; the CRM uses "Dig Deeper LLC". Pick one rendering for the site,
   the PDF and the email signature.
5. **Callback name.** The voicemail script says "ask for Ian". Confirm who
   is named on the site's contact section.

## Tasks

| # | Task | Size | Depends on |
|---|---|---|---|
| 1 | Find and confirm the Sunbiz detail URL | S | nothing |
| 2 | Draft the copy for the four sections and the one-pager | S | decision 1 |
| 3 | Build the static page, mobile first, with the tel and mailto links and the Sunbiz link | M | task 2 |
| 4 | Lay out the one-pager and export the PDF, check it opens on iPhone and Android | S | task 2 |
| 5 | Create the Vercel project on the site folder, deploy to a preview URL | S | decision 2 |
| 6 | Point the apex and `www` at Vercel, verify HTTPS, verify Mailgun records are untouched | S | decision 3 |
| 7 | Set the three env vars in Railway, update the brand constant, redeploy | S | tasks 1, 5, 6 |
| 8 | Send the packet to a team phone and email from a test lead, check both links open and the timeline shows the event | S | task 7 |

Sizes: S is under half a day, M is one to two days. The whole workstream
is two to three working days once the decisions are made, with DNS
propagation the only wait.

## Acceptance

- `https://digdeeperllc.com` loads over HTTPS on a phone in under two
  seconds and shows all four sections and the download link.
- `https://digdeeperllc.com/overview.pdf` opens on a phone and is under 1 MB.
- The Sunbiz link opens the entity's record without a login.
- `GET /surplus/credibility/status` on the production API returns
  `ready: true`.
- A packet sent from a test lead arrives by text and email with three
  working links, and the lead's timeline shows the credibility event.
- Email from `crm.digdeeperllc.com` still delivers after the DNS change.

## Risks

- **SMS link reputation.** A brand new domain in a text can be filtered by
  carriers. Sending from the registered Twilio number with the domain
  spelled out, not a shortener, is the safest first version. If texts stop
  delivering, the email path still carries the packet.
- **Fee wording.** Florida caps compensation on clerk-held surplus at 12
  percent under FS 45.033. Any percentage on the site or the PDF has to
  match the compliance rule in the CRM, which is why the CRM fills that
  line from the rule rather than from typed text.
- **DNS.** The apex currently resolves to a parking service. Changing the A
  record is safe for email only if the `crm.` subdomain's records are left
  as they are. Take a screenshot of the zone before editing.

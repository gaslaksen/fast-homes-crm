# D.I.G. Deeper LLC website

The public site at https://digdeeperllc.com and the one-page overview PDF at
https://digdeeperllc.com/overview.pdf. Both are links in the CRM's surplus
credibility packet (see `apps/api/src/surplus/surplus-credibility.service.ts`).

Plain HTML and CSS. No build step, no framework, no tracking, no forms. This
folder is excluded from the pnpm workspace and is deployed as its own Vercel
project with `apps/digdeeper-site` as the Root Directory. The Dealcore web app
(`apps/web`) has its own Vercel project and is not affected.

## Files

- `public/` everything that is served, and nothing else
  - `index.html` the one-page site
  - `styles.css` the stylesheet, mobile first
  - `overview.pdf` the one-pager, rendered from `onepager/overview.html`
- `vercel.json` static build settings, clean URLs, the www redirect, headers
- `onepager/overview.html` source for the PDF
- `onepager/build.sh` renders the PDF with headless Chrome into `public/`

## Editing copy

Edit `public/index.html` directly, and keep `onepager/overview.html` saying
the same things.

Positioning (decided 2026-09-08): the site presents D.I.G. Deeper as an
unclaimed funds recovery firm, based in Florida and working nationwide. It
must not name the kind of funds we recover or the mechanics of where they sit
(no foreclosure, tax deed, surplus, county clerk or statute references). A
claimant who is told exactly where the money is can go collect it alone. The
model for tone is an asset recovery firm's public page, not a legal notice.

Fee wording never states a percentage. Say contingency only, no upfront cost,
no recovery no fee, set in writing before work begins, compliant with state
law where a cap applies. The CRM's compliance table
(`apps/api/src/surplus/surplus-compliance.ts`) is the source of truth for the
Florida cap and for the disclosures the signed agreement must carry. Those
disclosures live in the agreement, not on this page.

The Company details section carries the legal name, registered agent and a
low key link to the Florida Sunbiz record for document L26000438506. If the
registered agent or principal address changes on Sunbiz, change it here and in
the one-pager too.

## Rebuilding the PDF

```bash
apps/digdeeper-site/onepager/build.sh
```

Requires Google Chrome. Writes `public/overview.pdf` and prints
the page count and file size. The PDF must be one page and under 1 MB.

## Deploying

The Vercel project is `digdeeper-site` under the `gaslaksens-projects` team,
connected to this GitHub repo with Root Directory `apps/digdeeper-site`. A
push to `master` that touches this folder deploys it; commits elsewhere in the
repo are skipped by the Ignored Build Step.

`vercel.json` pins the folder as static on purpose. The repo root has a
`turbo.json`, and Vercel's Turborepo detection otherwise runs `pnpm install`
and `turbo run build` from the repo root, matches zero packages (this folder
is not a workspace package), and then fails looking for a `public` output
directory. That is what broke the first git deploy on 2026-09-08. The no-op
`installCommand` and `buildCommand` beat that detection; an empty string did
not. `outputDirectory: "public"` means only that subfolder is served, so the
README, the PDF source and `vercel.json` itself never become public URLs. Do
not remove those keys.

Manual deploy from a machine that has run `vercel login`, from this folder or
from the repo root (the project's Root Directory applies either way):

```bash
vercel --prod
```

The `.vercel/` folders the CLI writes are gitignored.

## DNS

Nameservers for `digdeeperllc.com` stay at GoDaddy (`ns69.domaincontrol.com`,
`ns70.domaincontrol.com`). Do not move them to Vercel: email for the brand runs
on `crm.digdeeperllc.com` through Mailgun, and the records on that subdomain
(MX, TXT for SPF, DKIM, and the tracking CNAME) live in the GoDaddy zone.

Records Vercel asked for when the domains were added (2026-09-08):

| Host | Type | Value |
|---|---|---|
| `@` | A | `76.76.21.21` |
| `www` | A | `76.76.21.21` |

The apex previously held two parking A records; both are replaced by the one
above. `www` previously held a CNAME to the apex; replace it with the A record
(or a CNAME to `cname.vercel-dns.com`, either works). `www` redirects to the
apex permanently, from `vercel.json`.

Check with `vercel domains inspect digdeeperllc.com` once the records
propagate; Vercel issues the certificate on its own.

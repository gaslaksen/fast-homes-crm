# D.I.G. Deeper LLC website

The public site at https://digdeeperllc.com and the one-page overview PDF at
https://digdeeperllc.com/overview.pdf. Both are links in the CRM's surplus
credibility packet (see `apps/api/src/surplus/surplus-credibility.service.ts`).

Plain HTML and CSS. No build step, no framework, no tracking, no forms. This
folder is excluded from the pnpm workspace and is deployed as its own Vercel
project with `apps/digdeeper-site` as the Root Directory. The Dealcore web app
(`apps/web`) has its own Vercel project and is not affected.

## Files

- `index.html` the one-page site
- `styles.css` the stylesheet, mobile first
- `overview.pdf` the one-pager, rendered from `onepager/overview.html`
- `vercel.json` clean URLs plus headers for the PDF
- `.vercelignore` keeps `onepager/` and this README out of the deploy
- `onepager/overview.html` source for the PDF
- `onepager/build.sh` renders the PDF with headless Chrome

## Editing copy

Edit `index.html` directly. The fee section must never state a typed
percentage. Say contingency only, no advance fee, no recovery no fee, capped by
Florida law. FS 45.033 caps compensation on clerk-held surplus at 12 percent and
the CRM's compliance table (`apps/api/src/surplus/surplus-compliance.ts`) is
the source of truth for that figure, so the site and PDF describe the cap
without quoting it.

The entity facts in the Verify section come from the Sunbiz record for
document number L26000438506. If the registered agent or principal address
changes on Sunbiz, change it here and in the one-pager too.

## Rebuilding the PDF

```bash
apps/digdeeper-site/onepager/build.sh
```

Requires Google Chrome. Writes `overview.pdf` next to `index.html` and prints
the page count and file size. The PDF must be one page and under 1 MB.

## Deploying

The Vercel project deploys from GitHub on every push to `master` that touches
this folder. Project settings:

- Root Directory: `apps/digdeeper-site`
- Framework Preset: Other
- Build Command: none (leave blank, or override with an empty command)
- Output Directory: leave blank (the root directory is served as is)
- Ignored Build Step: "Only build if there are changes in the Root Directory"

Manual deploy from a machine that has run `vercel login`:

```bash
cd apps/digdeeper-site && vercel --prod
```

## DNS

Nameservers for `digdeeperllc.com` are at GoDaddy. Email for the brand runs on
`crm.digdeeperllc.com` through Mailgun, so the records on that subdomain (MX,
TXT for SPF, DKIM, and the tracking CNAME) must not be changed. Only the apex
`A` record and the `www` `CNAME` point at Vercel. Vercel shows the exact
values when the domain is added to the project.

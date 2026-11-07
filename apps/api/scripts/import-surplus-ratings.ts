/**
 * Load A Tier / B Tier review sheets from the shell, through the same service
 * the More > Import A/B ratings screen uses, so the matching is identical.
 * For when nobody is signed in to the web app to upload them.
 *
 * Run from apps/api with the prod DATABASE_URL exported:
 *
 *   # dry run (default: says what each file would do, writes nothing)
 *   pnpm exec ts-node scripts/import-surplus-ratings.ts A.xlsx B.xlsx
 *
 *   # apply for real
 *   pnpm exec ts-node scripts/import-surplus-ratings.ts A.xlsx B.xlsx --apply
 *
 * The organization is the one that owns surplus leads. With more than one,
 * pass --org=<id>.
 */
import { readFileSync } from 'fs';
import { basename } from 'path';
import { PrismaClient } from '@prisma/client';
import { SurplusRatingService } from '../src/surplus/surplus-rating.service';

const prisma = new PrismaClient();
const APPLY = process.argv.includes('--apply');
const files = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const orgArg = process.argv.find((a) => a.startsWith('--org='))?.slice('--org='.length);

async function main() {
  if (!files.length) throw new Error('Pass one or more ratings files.');

  let organizationId = orgArg || null;
  if (!organizationId) {
    const orgs = await prisma.lead.groupBy({ by: ['organizationId'], where: { source: 'SURPLUS' }, _count: true });
    if (orgs.length !== 1) {
      throw new Error(`Surplus leads belong to ${orgs.length} organizations; pass --org=<id>. ${JSON.stringify(orgs)}`);
    }
    organizationId = orgs[0].organizationId;
  }
  console.log(`Organization ${organizationId}. ${APPLY ? 'APPLYING' : 'Dry run, nothing written'}.`);

  const ratings = new SurplusRatingService(prisma as any);
  for (const f of files) {
    const buf = readFileSync(f);
    const { rows, summary } = APPLY
      ? await ratings.apply(buf, organizationId, null).then((r) => ({ rows: r.skipped, summary: r.summary }))
      : await ratings.preview(buf, organizationId);
    console.log(`\n== ${basename(f)}`);
    console.log(JSON.stringify(summary));
    const left = rows.filter((r: any) => !['new', 'changed', 'same'].includes(r.status));
    for (const r of left) console.log(`  left out row ${r.row}: ${r.rating || r.ratingText} ${r.county} ${r.caseNumber} (${r.status})`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

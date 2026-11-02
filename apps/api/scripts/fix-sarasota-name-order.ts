/**
 * Turn round the Sarasota claimants stored surname-first ("Holmok" / "Jane
 * A."), using the same rule the adapter now applies at ingest
 * (givenFirstOwners), so the board, the letters and the IDI batch all say
 * Jane A. Holmok. Only the lead's first and last name change. The dedupe uid
 * keeps the old order, and the weekly pull finds it in any order.
 *
 * Run from apps/api with the prod DATABASE_URL exported:
 *
 *   # dry run (default: lists every rename, writes nothing)
 *   pnpm exec ts-node scripts/fix-sarasota-name-order.ts
 *
 *   # apply for real
 *   pnpm exec ts-node scripts/fix-sarasota-name-order.ts --apply
 */
import { PrismaClient } from '@prisma/client';
import { givenFirstOwners } from '../src/surplus/realtdm.adapter';
import { splitOwnerName } from '../src/foreclosures/foreclosure-scoring.util';

const prisma = new PrismaClient();
const APPLY = process.argv.includes('--apply');

async function main() {
  const leads = await prisma.lead.findMany({
    where: { source: 'SURPLUS', surplusDetail: { county: 'Sarasota' } },
    select: { id: true, sellerFirstName: true, sellerLastName: true, surplusDetail: { select: { caseNumber: true } } },
  });
  const byCase = new Map<string, typeof leads>();
  for (const l of leads) {
    const key = l.surplusDetail?.caseNumber || l.id;
    byCase.set(key, [...(byCase.get(key) || []), l]);
  }

  const renames: { id: string; caseNumber: string; from: string; first: string; last: string }[] = [];
  for (const [caseNumber, group] of byCase) {
    // The name as the roll printed it is the two fields joined back up.
    const lines = group.map((l) => `${l.sellerFirstName || ''} ${l.sellerLastName || ''}`.trim().toUpperCase());
    const turned = givenFirstOwners(lines);
    group.forEach((l, i) => {
      if (turned[i] === lines[i]) return;
      const { firstName, lastName } = splitOwnerName(turned[i]);
      renames.push({ id: l.id, caseNumber, from: `${l.sellerFirstName} | ${l.sellerLastName}`, first: firstName, last: lastName });
    });
  }

  console.log(`${leads.length} Sarasota claimants, ${renames.length} to turn round. ${APPLY ? 'APPLYING' : 'Dry run, nothing written'}.`);
  for (const r of renames) console.log(`  ${r.caseNumber}  ${r.from}  ->  ${r.first} | ${r.last}`);
  if (!APPLY) return;
  for (const r of renames) {
    await prisma.lead.update({ where: { id: r.id }, data: { sellerFirstName: r.first, sellerLastName: r.last } });
  }
  console.log(`Renamed ${renames.length}.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

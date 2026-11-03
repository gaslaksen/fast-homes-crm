/**
 * Turn round the Sarasota claimants stored surname-first ("Holmok" / "Jane
 * A."), using the same rule the adapter now applies at ingest
 * (givenFirstOwners), so the board, the letters and the IDI batch all say
 * Jane A. Holmok. Only the lead's first and last name change. The dedupe uid
 * keeps the old order, and the weekly pull finds it in any order.
 *
 * An IDI miss under the reversed name says nothing about the address, so each
 * renamed claimant's missed addresses go back to untried and the next batch
 * sends them again under the right name. B001 (2026-11-03) sent 15 of its 19
 * Sarasota rows reversed.
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
    select: { id: true, sellerFirstName: true, sellerLastName: true, surplusDetail: { select: { id: true, caseNumber: true } } },
  });
  const byCase = new Map<string, typeof leads>();
  for (const l of leads) {
    const key = l.surplusDetail?.caseNumber || l.id;
    byCase.set(key, [...(byCase.get(key) || []), l]);
  }

  const renames: { id: string; detailId: string | null; caseNumber: string; from: string; first: string; last: string }[] = [];
  for (const [caseNumber, group] of byCase) {
    // The name as the roll printed it is the two fields joined back up.
    const lines = group.map((l) => `${l.sellerFirstName || ''} ${l.sellerLastName || ''}`.trim().toUpperCase());
    const turned = givenFirstOwners(lines);
    group.forEach((l, i) => {
      if (turned[i] === lines[i]) return;
      const { firstName, lastName } = splitOwnerName(turned[i]);
      renames.push({
        id: l.id,
        detailId: l.surplusDetail?.id || null,
        caseNumber,
        from: `${l.sellerFirstName} | ${l.sellerLastName}`,
        first: firstName,
        last: lastName,
      });
    });
  }

  const detailIds = renames.map((r) => r.detailId).filter((x): x is string => !!x);
  const missed = await prisma.surplusAddress.count({ where: { surplusDetailId: { in: detailIds }, status: 'miss' } });

  console.log(`${leads.length} Sarasota claimants, ${renames.length} to turn round. ${APPLY ? 'APPLYING' : 'Dry run, nothing written'}.`);
  for (const r of renames) console.log(`  ${r.caseNumber}  ${r.from}  ->  ${r.first} | ${r.last}`);
  console.log(`${missed} address${missed === 1 ? '' : 'es'} IDI missed under the reversed names go back to untried.`);
  if (!APPLY) return;
  for (const r of renames) {
    await prisma.lead.update({ where: { id: r.id }, data: { sellerFirstName: r.first, sellerLastName: r.last } });
  }
  const reset = await prisma.surplusAddress.updateMany({
    where: { surplusDetailId: { in: detailIds }, status: 'miss' },
    data: { status: 'untried' },
  });
  console.log(`Renamed ${renames.length}. ${reset.count} address${reset.count === 1 ? '' : 'es'} back to untried.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

/**
 * Split card addresses somebody typed whole into the street box ("320 N 40TH
 * ST APT 1, PHILADELPHIA, PA, 19104", city left blank) into street, city,
 * state and zip, on the card and on the claimant's address list, so the IDI
 * batch can send them. The card edit now splits these as they are saved; this
 * fixes the ones saved before. Foreign one-line addresses are left alone.
 *
 * Run from apps/api with the prod DATABASE_URL exported:
 *
 *   # dry run (default: lists every change, writes nothing)
 *   pnpm exec ts-node scripts/fix-one-line-mailing.ts
 *
 *   # apply for real
 *   pnpm exec ts-node scripts/fix-one-line-mailing.ts --apply
 */
import { PrismaClient } from '@prisma/client';
import { splitOneLineUsAddress, surplusAddressKey } from '../src/surplus/surplus-address.util';

const prisma = new PrismaClient();
const APPLY = process.argv.includes('--apply');

async function main() {
  const cards = await prisma.surplusDetail.findMany({
    where: { ownerMailingStreet: { contains: ',' }, OR: [{ ownerMailingCity: null }, { ownerMailingCity: '' }] },
    select: { id: true, county: true, caseNumber: true, ownerMailingStreet: true },
  });
  const fixes = cards
    .map((c) => ({ ...c, split: splitOneLineUsAddress(c.ownerMailingStreet) }))
    .filter((c): c is typeof c & { split: NonNullable<typeof c.split> } => !!c.split);

  console.log(`${cards.length} cards with a comma in the street and no city, ${fixes.length} of them a US address. ${APPLY ? 'APPLYING' : 'Dry run, nothing written'}.`);
  for (const f of fixes) console.log(`  ${f.county} ${f.caseNumber}  ->  ${f.split.street} | ${f.split.city} | ${f.split.state} | ${f.split.zip}`);
  if (!APPLY) return;

  for (const f of fixes) {
    const s = f.split;
    await prisma.surplusDetail.update({
      where: { id: f.id },
      data: { ownerMailingStreet: s.street, ownerMailingCity: s.city, ownerMailingState: s.state, ownerMailingZip: s.zip },
    });
    // The list row keyed on the whole line becomes the split address. One
    // already on the list under the split key keeps its own status and the
    // whole-line row goes.
    const oldKey = surplusAddressKey(f.ownerMailingStreet, null);
    const newKey = surplusAddressKey(s.street, s.zip);
    const row = await prisma.surplusAddress.findUnique({ where: { surplusDetailId_addressKey: { surplusDetailId: f.id, addressKey: oldKey } } });
    const already = await prisma.surplusAddress.findUnique({ where: { surplusDetailId_addressKey: { surplusDetailId: f.id, addressKey: newKey } } });
    if (row && already) {
      await prisma.surplusAddress.delete({ where: { id: row.id } });
    } else if (row) {
      await prisma.surplusAddress.update({
        where: { id: row.id },
        data: { street: s.street, city: s.city, state: s.state, zip: s.zip, addressKey: newKey },
      });
    }
  }
  console.log(`Split ${fixes.length}.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

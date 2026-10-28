/**
 * One-shot backfill: file existing texts, calls and emails on surplus cases
 * under the person they were with, now that messages, call_logs and emails
 * carry a heirId (migration 20261028150000_person_on_comms).
 *
 * A row is matched by the number or address on it against the people on its
 * case as they stand today:
 *   - texts: the `to` of an outbound, the `from` of an inbound
 *   - calls: the dialled number, or the caller on an inbound call
 *   - emails: the `to` of an outbound, the `from` of an inbound
 * The claimant's own numbers and email win, the same rule the live code uses,
 * so a number both hold stays the claimant's. A number or address two people
 * on one case share is ambiguous and left alone. Rows already filed are not
 * touched. Tasks are left alone: their titles do not say reliably who they
 * were for.
 *
 * Run from the Railway shell or locally with the prod DATABASE_URL exported:
 *
 *   # dry run (default: counts what it would file, writes nothing)
 *   pnpm --filter api exec ts-node scripts/backfill-person-on-comms.ts
 *
 *   # apply for real
 *   pnpm --filter api exec ts-node scripts/backfill-person-on-comms.ts --apply
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const APPLY = process.argv.includes('--apply');

/** The last ten digits, so +13525550141, 3525550141 and (352) 555-0141 are one number. */
function numberKey(v: string | null | undefined): string {
  const d = String(v || '').replace(/\D/g, '');
  return d.length >= 10 ? d.slice(-10) : '';
}

function emailKey(v: string | null | undefined): string {
  return String(v || '')
    .replace(/^.*<([^>]+)>.*$/, '$1')
    .trim()
    .toLowerCase();
}

/** key -> the one person holding it, or null when two people on the case share it. */
function ownerMap(
  people: { id: string; keys: string[] }[],
  claimantKeys: Set<string>,
): Map<string, string | null> {
  const out = new Map<string, string | null>();
  for (const p of people) {
    for (const k of p.keys) {
      if (!k || claimantKeys.has(k)) continue;
      out.set(k, out.has(k) && out.get(k) !== p.id ? null : p.id);
    }
  }
  return out;
}

interface Tally {
  matched: number;
  ambiguous: number;
}

async function main() {
  console.log(`Mode: ${APPLY ? 'APPLY (will write)' : 'DRY RUN (no writes)'}\n`);

  const cases = await prisma.surplusDetail.findMany({
    where: { heirs: { some: {} } },
    select: {
      leadId: true,
      phone2: true,
      phone3: true,
      phone4: true,
      email2: true,
      lead: { select: { sellerPhone: true, sellerEmail: true } },
      heirs: {
        select: { id: true, phone1: true, phone2: true, phone3: true, phone4: true, email1: true, email2: true },
      },
    },
  });
  console.log(`Surplus cases with people on them: ${cases.length}`);

  const tally: Record<'messages' | 'calls' | 'emails', Tally> = {
    messages: { matched: 0, ambiguous: 0 },
    calls: { matched: 0, ambiguous: 0 },
    emails: { matched: 0, ambiguous: 0 },
  };
  /** heirId -> row ids, per table, written at the end. */
  const writes = { messages: new Map<string, string[]>(), calls: new Map<string, string[]>(), emails: new Map<string, string[]>() };
  const push = (table: keyof typeof writes, heirId: string, rowId: string) => {
    const list = writes[table].get(heirId) || [];
    list.push(rowId);
    writes[table].set(heirId, list);
  };

  for (const c of cases) {
    const claimantNumbers = new Set(
      [c.lead.sellerPhone, c.phone2, c.phone3, c.phone4].map(numberKey).filter(Boolean),
    );
    const claimantEmails = new Set([c.lead.sellerEmail, c.email2].map(emailKey).filter(Boolean));
    const byNumber = ownerMap(
      c.heirs.map((h) => ({ id: h.id, keys: [h.phone1, h.phone2, h.phone3, h.phone4].map(numberKey) })),
      claimantNumbers,
    );
    const byEmail = ownerMap(
      c.heirs.map((h) => ({ id: h.id, keys: [h.email1, h.email2].map(emailKey) })),
      claimantEmails,
    );
    const file = (table: keyof typeof writes, map: Map<string, string | null>, key: string, rowId: string) => {
      if (!key || !map.has(key)) return;
      const heirId = map.get(key);
      if (heirId) {
        tally[table].matched += 1;
        push(table, heirId, rowId);
      } else tally[table].ambiguous += 1;
    };

    if (byNumber.size) {
      const messages = await prisma.message.findMany({
        where: { leadId: c.leadId, heirId: null },
        select: { id: true, direction: true, from: true, to: true },
      });
      for (const m of messages) {
        file('messages', byNumber, numberKey(m.direction === 'INBOUND' ? m.from : m.to), m.id);
      }
      const calls = await prisma.callLog.findMany({
        where: { leadId: c.leadId, heirId: null },
        select: { id: true, type: true, fromNumber: true, toNumber: true },
      });
      for (const k of calls) {
        file('calls', byNumber, numberKey(k.type === 'twilio_inbound' ? k.fromNumber : k.toNumber), k.id);
      }
    }
    if (byEmail.size) {
      const emails = await prisma.email.findMany({
        where: { leadId: c.leadId, heirId: null },
        select: { id: true, direction: true, fromAddress: true, toAddress: true },
      });
      for (const e of emails) {
        file('emails', byEmail, emailKey(e.direction === 'inbound' ? e.fromAddress : e.toAddress), e.id);
      }
    }
  }

  for (const [table, t] of Object.entries(tally)) {
    const people = writes[table as keyof typeof writes].size;
    console.log(`${table}: ${t.matched} to file under ${people} people, ${t.ambiguous} left alone (a number or address two people share)`);
  }

  if (!APPLY) {
    console.log('\nDry run. Nothing was written. Re-run with --apply to file these rows.');
    return;
  }

  let written = 0;
  for (const [heirId, ids] of writes.messages) {
    written += (await prisma.message.updateMany({ where: { id: { in: ids }, heirId: null }, data: { heirId } })).count;
  }
  for (const [heirId, ids] of writes.calls) {
    written += (await prisma.callLog.updateMany({ where: { id: { in: ids }, heirId: null }, data: { heirId } })).count;
  }
  for (const [heirId, ids] of writes.emails) {
    written += (await prisma.email.updateMany({ where: { id: { in: ids }, heirId: null }, data: { heirId } })).count;
  }
  console.log(`\nApplied. ${written} rows filed under the person they were with.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

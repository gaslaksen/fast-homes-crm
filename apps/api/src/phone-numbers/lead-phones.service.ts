import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { numberKey, toE164, prettyNumber } from './phone-numbers.service';

/**
 * One number we hold for a seller. This is the other side of PhoneNumbersService:
 * that one owns the numbers we send *from*, this one the numbers we send *to*.
 */
export interface LeadPhone {
  /** E.164, ready to hand to the carrier. */
  number: string;
  /** "Primary", "Phone 2", ... */
  label: string;
  /** 'Mobile' | 'Landline' | null, as the skip trace reported it. */
  type: string | null;
  /**
   * The Lead.sellerPhone number. Drip, campaigns and AI auto-response always
   * use this one, so it is the number the seller hears from unprompted.
   */
  isPrimary: boolean;
  /**
   * DncRegistry value when there is a reason not to dial this number, null when
   * it came back clean. Surfaced so the composer and the dialer can warn before
   * a send rather than after: surplus skip traces routinely return numbers
   * flagged federal DNC, TCPA or litigator, and a number offered without the
   * flag is one somebody will dial.
   */
  dnc: string | null;
  /**
   * Tried, and it does not reach this person: disconnected, wrong party, or
   * the claimant said so. Distinct from `dnc`, which is a legal reason not to
   * dial a number that may work perfectly well.
   */
  bad: boolean;
}

/**
 * The shape stored in `Lead.badContacts`.
 *
 * Read through the helpers below rather than cast, because the column is JSON
 * and every row written before this feature existed holds null.
 */
export interface BadContacts {
  phones: string[];
  emails: string[];
}

export function badPhonesOf(v: unknown): string[] {
  const b = v as BadContacts | null;
  return Array.isArray(b?.phones) ? b!.phones.filter((x) => typeof x === 'string') : [];
}

export function badEmailsOf(v: unknown): string[] {
  const b = v as BadContacts | null;
  return Array.isArray(b?.emails) ? b!.emails.filter((x) => typeof x === 'string') : [];
}

/** Where a match on an inbound number came from. */
export interface LeadPhoneMatch {
  leadId: string;
  isPrimary: boolean;
}

/**
 * Skip trace attaches up to four numbers to a foreclosure lead and two to a
 * probate lead. Lead.sellerPhone holds the first; the rest live on the detail
 * row. Everything that needs "which numbers does this seller have" reads them
 * through here, so the composer, the dialer and the inbound webhooks agree on
 * one list.
 *
 * Detail phones are stored as bare 10 digits (normalizePhoneDigits at import and
 * skip-trace time). sellerPhone is whatever the source handed us, so every
 * comparison goes through numberKey.
 */
/**
 * Where each pipeline keeps its extra phone slots.
 *
 * Every pipeline hangs its own detail table off Lead and they all store the
 * same thing in almost the same shape, which is exactly the situation that
 * grows four slightly different copies of one function. `promote` had already
 * drifted: it handled foreclosure and probate and threw
 * "not one of this lead's numbers" on any surplus or tax sale number, because
 * those two tables were added after it.
 *
 * One table, consulted by every read and every write.
 */
const DETAIL_RELATIONS = [
  { relation: 'foreclosureDetail', model: 'foreclosureDetail', slots: 4, emails: 0, dnc: false },
  { relation: 'probateDetail', model: 'probateDetail', slots: 2, emails: 0, dnc: false },
  { relation: 'surplusDetail', model: 'surplusDetail', slots: 4, emails: 2, dnc: true },
  { relation: 'taxSaleDetail', model: 'taxSaleDetail', slots: 4, emails: 2, dnc: false },
] as const;

type DetailRelation = (typeof DETAIL_RELATIONS)[number];

@Injectable()
export class LeadPhonesService {
  private readonly logger = new Logger(LeadPhonesService.name);

  constructor(private prisma: PrismaService) {}

  /**
   * Every number on file for a lead, primary first, de-duped. A skip trace
   * often returns the same number twice across slots, and the picker should
   * not offer it twice.
   */
  async listForLead(leadId: string): Promise<LeadPhone[]> {
    const lead = await this.prisma.lead.findUnique({
      where: { id: leadId },
      select: {
        sellerPhone: true,
        foreclosureDetail: {
          select: {
            phone1Type: true,
            phone2: true,
            phone2Type: true,
            phone3: true,
            phone3Type: true,
            phone4: true,
            phone4Type: true,
          },
        },
        probateDetail: {
          select: { phone1Type: true, phone2: true, phone2Type: true },
        },
        // Surplus leads carry up to four numbers with a per-number DNC flag.
        // Omitting this is why a surplus conversation only ever offered the
        // primary: the composer shows a picker when there is more than one
        // number, and there never was.
        surplusDetail: {
          select: {
            phone1Type: true, phone1Dnc: true,
            phone2: true, phone2Type: true, phone2Dnc: true,
            phone3: true, phone3Type: true, phone3Dnc: true,
            phone4: true, phone4Type: true, phone4Dnc: true,
          },
        },
        // Tax sales carry four numbers too. Omitting them had the same effect
        // it had on surplus: the composer only ever offered the primary,
        // because it shows a picker when there is more than one number and
        // there never was.
        taxSaleDetail: {
          select: {
            phone1Type: true,
            phone2: true, phone2Type: true,
            phone3: true, phone3Type: true,
            phone4: true, phone4Type: true,
          },
        },
        badContacts: true,
      },
    });
    if (!lead) return [];

    const f = lead.foreclosureDetail;
    const p = lead.probateDetail;
    const s = lead.surplusDetail;
    const t = lead.taxSaleDetail;
    const badKeys = new Set(
      badPhonesOf(lead.badContacts).map((n) => numberKey(toE164(n) || n)),
    );

    const raw: { value: string | null; label: string; type: string | null; dnc: string | null }[] = [
      {
        value: lead.sellerPhone,
        label: 'Primary',
        type: f?.phone1Type ?? p?.phone1Type ?? s?.phone1Type ?? t?.phone1Type ?? null,
        dnc: s?.phone1Dnc ?? null,
      },
      {
        value: f?.phone2 ?? p?.phone2 ?? s?.phone2 ?? t?.phone2 ?? null,
        label: 'Phone 2',
        type: f?.phone2Type ?? p?.phone2Type ?? s?.phone2Type ?? t?.phone2Type ?? null,
        dnc: s?.phone2Dnc ?? null,
      },
      {
        value: f?.phone3 ?? s?.phone3 ?? t?.phone3 ?? null,
        label: 'Phone 3',
        type: f?.phone3Type ?? s?.phone3Type ?? t?.phone3Type ?? null,
        dnc: s?.phone3Dnc ?? null,
      },
      {
        value: f?.phone4 ?? s?.phone4 ?? t?.phone4 ?? null,
        label: 'Phone 4',
        type: f?.phone4Type ?? s?.phone4Type ?? t?.phone4Type ?? null,
        dnc: s?.phone4Dnc ?? null,
      },
    ];

    const out: LeadPhone[] = [];
    const seen = new Set<string>();
    for (const r of raw) {
      const e164 = r.value ? toE164(r.value) : null;
      if (!e164) continue;
      const key = numberKey(e164);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        number: e164,
        label: r.label,
        type: r.type,
        isPrimary: r.label === 'Primary',
        dnc: r.dnc,
        bad: badKeys.has(key),
      });
    }
    return out;
  }

  /**
   * Resolve the number a send should go to.
   *
   * Unlike caller-ID resolution, an unrecognised value is rejected rather than
   * quietly replaced with the primary: silently redirecting a text to a
   * different person is worse than refusing to send it.
   */
  async resolveTo(leadId: string, requested?: string | null): Promise<string> {
    const numbers = await this.listForLead(leadId);
    if (!numbers.length) {
      throw new BadRequestException('This lead has no phone number on file');
    }
    if (!requested) return numbers[0].number;

    const match = numbers.find((n) => numberKey(n.number) === numberKey(requested));
    if (!match) {
      this.logger.warn(`Rejected to-number ${requested} for lead ${leadId} (not on file)`);
      throw new BadRequestException(
        `${prettyNumber(requested)} is not one of this lead's numbers`,
      );
    }
    return match.number;
  }

  /**
   * Promote one of the seller's other numbers to primary, demoting the current
   * primary into the slot it came from. Line types move with their numbers.
   *
   * This matters because manual sends are the only thing that can target a
   * secondary number: drip, campaigns, initial outreach and AI auto-response
   * all read Lead.sellerPhone. Once an agent finds the number that answers,
   * promoting it is what points the automation at it.
   */
  async setPrimary(leadId: string, requested: string): Promise<LeadPhone[]> {
    const lead = await this.prisma.lead.findUnique({
      where: { id: leadId },
      select: {
        sellerPhone: true,
        foreclosureDetail: {
          select: {
            id: true,
            phone1Type: true,
            phone2: true,
            phone2Type: true,
            phone3: true,
            phone3Type: true,
            phone4: true,
            phone4Type: true,
          },
        },
        probateDetail: {
          select: { id: true, phone1Type: true, phone2: true, phone2Type: true },
        },
      },
    });
    if (!lead) throw new NotFoundException(`Lead ${leadId} not found`);

    const target = numberKey(requested);
    if (!target || target.length !== 10) {
      throw new BadRequestException('Not a valid phone number');
    }
    if (numberKey(lead.sellerPhone || '') === target) {
      return this.listForLead(leadId);
    }

    const f = lead.foreclosureDetail;
    const p = lead.probateDetail;

    // Numbers are stored as bare 10 digits everywhere in these tables, so the
    // demoted primary goes back in the same shape it would have been imported.
    const oldPrimary = numberKey(lead.sellerPhone || '') || null;
    const oldPrimaryType = f?.phone1Type ?? p?.phone1Type ?? null;

    const slots: { field: 'phone2' | 'phone3' | 'phone4'; value: string | null; type: string | null }[] = f
      ? [
          { field: 'phone2', value: f.phone2, type: f.phone2Type },
          { field: 'phone3', value: f.phone3, type: f.phone3Type },
          { field: 'phone4', value: f.phone4, type: f.phone4Type },
        ]
      : p
        ? [{ field: 'phone2', value: p.phone2, type: p.phone2Type }]
        : [];

    const slot = slots.find((s) => numberKey(s.value || '') === target);
    if (!slot) {
      throw new BadRequestException(`${prettyNumber(requested)} is not one of this lead's numbers`);
    }

    const detailPatch = {
      [slot.field]: oldPrimary,
      [`${slot.field}Type`]: oldPrimaryType,
      phone1Type: slot.type,
    };

    await this.prisma.$transaction([
      this.prisma.lead.update({
        where: { id: leadId },
        data: { sellerPhone: target },
      }),
      f
        ? this.prisma.foreclosureDetail.update({ where: { id: f.id }, data: detailPatch })
        : this.prisma.probateDetail.update({ where: { id: p!.id }, data: detailPatch }),
    ]);

    this.logger.log(`Lead ${leadId}: promoted ${prettyNumber(target)} to primary`);
    return this.listForLead(leadId);
  }

  /**
   * Which of the seller's numbers the composer should preselect: the one they
   * last replied from, else the primary. Texting back on the number that
   * answered keeps the thread on the seller's own phone rather than restarting
   * it on a landline nobody picks up.
   */
  async selectedToFor(leadId: string): Promise<string> {
    const numbers = await this.listForLead(leadId);
    if (!numbers.length) return '';

    const lastInbound = await this.prisma.message.findFirst({
      where: { leadId, direction: 'INBOUND' },
      orderBy: { createdAt: 'desc' },
      select: { from: true },
    });
    const replied =
      lastInbound?.from &&
      numbers.find((n) => numberKey(n.number) === numberKey(lastInbound.from));

    return (replied || numbers[0]).number;
  }

  /**
   * Find the lead an inbound message or call belongs to, by any number we hold
   * for it. Primary is checked first so a number shared between two leads (one
   * heir, several properties) resolves to the lead that number actually belongs
   * to rather than to whichever row the OR happened to hit first.
   */
  async findLeadByPhone(phone: string): Promise<LeadPhoneMatch | null> {
    const ten = numberKey(phone);
    if (ten.length !== 10) return null;

    const primary = await this.prisma.lead.findFirst({
      where: {
        OR: [
          { sellerPhone: `+1${ten}` },
          { sellerPhone: ten },
          { sellerPhone: `1${ten}` },
        ],
      },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    });
    if (primary) return { leadId: primary.id, isPrimary: true };

    const alternate = await this.prisma.lead.findFirst({
      where: {
        OR: [
          { foreclosureDetail: { OR: [{ phone2: ten }, { phone3: ten }, { phone4: ten }] } },
          { probateDetail: { phone2: ten } },
        ],
      },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    });
    if (alternate) return { leadId: alternate.id, isPrimary: false };

    return null;
  }

  /**
   * Every lead reachable on this number. One heir can own several probate
   * properties and one number can sit on several leads, so opt-out has to sweep
   * all of them: a STOP text from any number we hold silences every lead it
   * belongs to, not just the one that happened to be texted.
   */
  async findLeadIdsByPhone(phone: string): Promise<string[]> {
    const ten = numberKey(phone);
    if (ten.length !== 10) return [];

    const leads = await this.prisma.lead.findMany({
      where: {
        OR: [
          { sellerPhone: `+1${ten}` },
          { sellerPhone: ten },
          { sellerPhone: `1${ten}` },
          { foreclosureDetail: { OR: [{ phone2: ten }, { phone3: ten }, { phone4: ten }] } },
          { probateDetail: { phone2: ten } },
        ],
      },
      select: { id: true },
    });
    return leads.map((l) => l.id);
  }
  // ─── Editing what we hold ─────────────────────────────────────────────────

  /**
   * Which detail table this lead's extra numbers live in, and its row id.
   *
   * Returns null for a lead with no pipeline detail at all (a plain property
   * lead), which is not an error: those carry only Lead.sellerPhone.
   */
  private async detailFor(
    leadId: string,
  ): Promise<{ spec: DetailRelation; id: string; row: any } | null> {
    const lead = await this.prisma.lead.findUnique({
      where: { id: leadId },
      select: DETAIL_RELATIONS.reduce(
        (acc, r) => ({ ...acc, [r.relation]: true }),
        {} as Record<string, boolean>,
      ),
    });
    if (!lead) throw new NotFoundException(`Lead ${leadId} not found`);
    for (const spec of DETAIL_RELATIONS) {
      const row = (lead as any)[spec.relation];
      if (row) return { spec, id: row.id, row };
    }
    return null;
  }

  /**
   * Replace the numbers on file, primary first.
   *
   * The whole list is written at once rather than one slot at a time, because
   * the slots are positional: adding a number by writing "the first empty one"
   * races with a skip trace and needs every caller to know how many slots this
   * pipeline has.
   *
   * Anything past the pipeline's slot count is REFUSED rather than silently
   * dropped. A probate lead holds two numbers, and quietly discarding the third
   * a user just typed is the kind of loss nobody notices until they go looking
   * for it.
   */
  async setPhones(
    leadId: string,
    phones: { number: string; type?: string | null }[],
  ): Promise<LeadPhone[]> {
    const clean: { number: string; type: string | null }[] = [];
    const seen = new Set<string>();
    for (const p of phones || []) {
      const key = numberKey(p?.number || '');
      if (!key || key.length !== 10) {
        throw new BadRequestException(`"${p?.number}" is not a valid phone number`);
      }
      if (seen.has(key)) continue;
      seen.add(key);
      clean.push({ number: key, type: p.type || null });
    }

    const detail = await this.detailFor(leadId);
    const capacity = detail ? detail.spec.slots : 1;
    if (clean.length > capacity) {
      throw new BadRequestException(
        `This lead holds at most ${capacity} number${capacity === 1 ? '' : 's'}; ` +
          `remove one before adding another.`,
      );
    }

    const leadPatch: any = { sellerPhone: clean[0] ? `+1${clean[0].number}` : '' };
    const writes: any[] = [this.prisma.lead.update({ where: { id: leadId }, data: leadPatch })];

    if (detail) {
      const detailPatch: any = { phone1Type: clean[0]?.type ?? null };
      for (let i = 2; i <= detail.spec.slots; i += 1) {
        detailPatch[`phone${i}`] = clean[i - 1]?.number ?? null;
        detailPatch[`phone${i}Type`] = clean[i - 1]?.type ?? null;
      }
      writes.push(
        (this.prisma as any)[detail.spec.model].update({
          where: { id: detail.id },
          data: detailPatch,
        }),
      );
    }

    await this.prisma.$transaction(writes);
    return this.listForLead(leadId);
  }

  /** Every email on file, primary first, de-duped, with its bad flag. */
  async listEmailsForLead(
    leadId: string,
  ): Promise<{ address: string; isPrimary: boolean; bad: boolean }[]> {
    const lead = await this.prisma.lead.findUnique({
      where: { id: leadId },
      select: {
        sellerEmail: true,
        badContacts: true,
        surplusDetail: { select: { email2: true } },
        taxSaleDetail: { select: { email2: true } },
      },
    });
    if (!lead) return [];
    const bad = new Set(badEmailsOf(lead.badContacts).map((e) => e.toLowerCase()));
    const raw = [lead.sellerEmail, lead.surplusDetail?.email2 ?? lead.taxSaleDetail?.email2];
    const out: { address: string; isPrimary: boolean; bad: boolean }[] = [];
    const seen = new Set<string>();
    raw.forEach((v, i) => {
      const address = String(v || '').trim();
      if (!address || seen.has(address.toLowerCase())) return;
      seen.add(address.toLowerCase());
      out.push({ address, isPrimary: i === 0, bad: bad.has(address.toLowerCase()) });
    });
    return out;
  }

  /** Replace the emails on file, primary first. Same slot rules as phones. */
  async setEmails(leadId: string, emails: string[]): Promise<void> {
    const clean: string[] = [];
    for (const raw of emails || []) {
      const address = String(raw || '').trim();
      if (!address) continue;
      // Deliberately loose. Rejecting anything without a dot in the domain
      // would turn a typo into a refusal to save the other three fields.
      if (!/^[^\s@]+@[^\s@]+$/.test(address)) {
        throw new BadRequestException(`"${address}" is not a valid email address`);
      }
      if (!clean.some((e) => e.toLowerCase() === address.toLowerCase())) clean.push(address);
    }

    const detail = await this.detailFor(leadId);
    const capacity = detail?.spec.emails ? detail.spec.emails : 1;
    if (clean.length > capacity) {
      throw new BadRequestException(
        `This lead holds at most ${capacity} email address${capacity === 1 ? '' : 'es'}.`,
      );
    }

    const writes: any[] = [
      this.prisma.lead.update({
        where: { id: leadId },
        data: { sellerEmail: clean[0] || null },
      }),
    ];
    if (detail && detail.spec.emails > 1) {
      writes.push(
        (this.prisma as any)[detail.spec.model].update({
          where: { id: detail.id },
          data: { email2: clean[1] || null },
        }),
      );
    }
    await this.prisma.$transaction(writes);
  }

  /**
   * Flag a number or an email as one that does not reach this person, or clear
   * the flag.
   *
   * The contact is KEPT, not deleted. Knowing that a number was tried and does
   * not work is worth more than the empty slot, and without the record the next
   * person to open the lead dials it again.
   */
  async flagContact(
    leadId: string,
    value: string,
    bad: boolean,
  ): Promise<BadContacts> {
    const lead = await this.prisma.lead.findUnique({
      where: { id: leadId },
      select: { badContacts: true },
    });
    if (!lead) throw new NotFoundException(`Lead ${leadId} not found`);

    const isEmail = value.includes('@');
    const phones = badPhonesOf(lead.badContacts);
    const emails = badEmailsOf(lead.badContacts);

    if (isEmail) {
      const key = value.trim().toLowerCase();
      const next = emails.filter((e) => e.toLowerCase() !== key);
      if (bad) next.push(value.trim());
      return this.writeBad(leadId, { phones, emails: next });
    }

    const key = numberKey(value);
    if (!key || key.length !== 10) {
      throw new BadRequestException(`"${value}" is not a valid phone number`);
    }
    const next = phones.filter((n) => numberKey(n) !== key);
    if (bad) next.push(key);
    return this.writeBad(leadId, { phones: next, emails });
  }

  private async writeBad(leadId: string, next: BadContacts): Promise<BadContacts> {
    await this.prisma.lead.update({
      where: { id: leadId },
      data: { badContacts: next as any },
    });
    return next;
  }

}

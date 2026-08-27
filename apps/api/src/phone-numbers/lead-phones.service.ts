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
      },
    });
    if (!lead) return [];

    const f = lead.foreclosureDetail;
    const p = lead.probateDetail;
    const s = lead.surplusDetail;

    const raw: { value: string | null; label: string; type: string | null; dnc: string | null }[] = [
      {
        value: lead.sellerPhone,
        label: 'Primary',
        type: f?.phone1Type ?? p?.phone1Type ?? s?.phone1Type ?? null,
        dnc: s?.phone1Dnc ?? null,
      },
      {
        value: f?.phone2 ?? p?.phone2 ?? s?.phone2 ?? null,
        label: 'Phone 2',
        type: f?.phone2Type ?? p?.phone2Type ?? s?.phone2Type ?? null,
        dnc: s?.phone2Dnc ?? null,
      },
      {
        value: f?.phone3 ?? s?.phone3 ?? null,
        label: 'Phone 3',
        type: f?.phone3Type ?? s?.phone3Type ?? null,
        dnc: s?.phone3Dnc ?? null,
      },
      {
        value: f?.phone4 ?? s?.phone4 ?? null,
        label: 'Phone 4',
        type: f?.phone4Type ?? s?.phone4Type ?? null,
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
}

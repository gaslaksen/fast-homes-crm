/**
 * Skip tracing surplus claimants through BatchData.
 *
 * The target is the owner the clerk mailed the Notice of Surplus Funds to, and
 * on Duval that notice goes to the owner at the PROPERTY address. So the
 * property address is what gets submitted. See surplus-skiptrace.util.ts for why
 * that is the definition of the target rather than a convenience.
 *
 * ── What this does differently from the foreclosure tracer ──────────────────
 *
 * `foreclosure-skiptrace.service.ts` takes `persons[0]` and discards the rest.
 * For a foreclosure that is usually fine, since there is normally one
 * owner-occupant. On a surplus file it silently drops the co-owner, and
 * co-owners are common here: four of the first six Duval leads ingested are
 * co-owner pairs. Each co-owner is a separate lead and a separate claim, so
 * dropping one loses a whole deal. This iterates the array and matches each
 * returned person to the claimant they actually are.
 *
 * ── Three ways this spends money badly if you are not careful ───────────────
 *
 * 1. BatchData matches on ADDRESS ONLY, no name. Two co-owners at one property
 *    return the identical row twice, so the second credit buys nothing. Leads
 *    are grouped by address and submitted once.
 * 2. The property SOLD at auction, so the address frequently resolves to the
 *    new owner or a new tenant. Every identity is name-checked before any
 *    number is attached, and a failed check discards the contacts.
 * 3. Entities, house-numberless streets, mismatched ZIP/state pairs and shared
 *    professional addresses are refused before submission rather than after.
 */

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { PrismaService } from '../prisma/prisma.service';
import { LeadSource } from '@fast-homes/shared';
import { normalizePhoneDigits } from '../foreclosures/foreclosure-scoring.util';
import {
  addressCaseCounts,
  addressKeyOf,
  traceEligibility,
  verifyTracedName,
  TraceVerdict,
} from './surplus-skiptrace.util';

const BATCHDATA_DEFAULT_BASE_URL = 'https://api.batchdata.com/api/v1';
/** A courtesy pause between vendor calls. */
const CALL_DELAY_MS = 250;

export interface SurplusTraceResult {
  /** Leads considered. */
  candidates: number;
  /** Distinct addresses actually submitted, which is what costs credits. */
  submitted: number;
  /** Leads that came away with at least one phone or email. */
  contacted: number;
  /** Leads whose trace returned somebody else, so the contacts were discarded. */
  mismatched: number;
  /** Leads refused before submission, by reason. */
  skipped: Record<string, number>;
  errors: number;
  message?: string;
}

interface Candidate {
  leadId: string;
  detailId: string;
  claimant: string;
  caseNumber: string | null;
  isEntity: boolean;
  street: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  addressKey: string;
  /** 'notice' when this is the owner's own address, 'property' when it is not. */
  addressSource: 'notice' | 'property';
}

interface TracedPerson {
  first: string | null;
  last: string | null;
  phones: { num: string; type: string | null }[];
  emails: string[];
}

const ENTITY = /\b(LLC|L\.L\.C|INC|CORP|CORPORATION|COMPANY|LP|LLP|LLLP|LTD|TRUST|ASSOCIATION|CHURCH|BANK|PARTNERS|HOLDINGS)\b/i;

@Injectable()
export class SurplusSkiptraceService {
  private readonly logger = new Logger(SurplusSkiptraceService.name);
  private readonly batchKey?: string;
  private readonly batchBaseUrl: string;

  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
  ) {
    this.batchKey = this.config.get<string>('BATCHDATA_API_KEY');
    this.batchBaseUrl = (
      this.config.get<string>('BATCHDATA_API_BASE_URL') || BATCHDATA_DEFAULT_BASE_URL
    ).replace(/\/+$/, '');
  }

  /**
   * Trace surplus leads that have no usable contact yet.
   *
   * `limit` caps the number of ADDRESSES submitted, which is the thing that
   * costs money, not the number of leads touched.
   */
  async traceLeads(opts: {
    organizationId?: string | null;
    leadIds?: string[];
    limit?: number;
    /** Work the leads even if they already carry a number. */
    includeTraced?: boolean;
  }): Promise<SurplusTraceResult> {
    const result: SurplusTraceResult = {
      candidates: 0,
      submitted: 0,
      contacted: 0,
      mismatched: 0,
      skipped: {},
      errors: 0,
    };

    if (!this.batchKey) {
      result.message = 'BATCHDATA_API_KEY is not set, so no trace was attempted.';
      return result;
    }

    const leads = await this.prisma.lead.findMany({
      where: {
        source: LeadSource.SURPLUS,
        ...(opts.organizationId ? { organizationId: opts.organizationId } : {}),
        // An EMPTY array means "these zero leads", not "every lead". Treating
        // it as no-filter turned a probe carrying {"leadIds":[]} into a full
        // run against the whole board and spent credits nobody asked for.
        // `undefined` is the only thing that means "no filter".
        ...(opts.leadIds ? { id: { in: opts.leadIds } } : {}),
        // Untraced only, unless asked otherwise. A lead that already has a
        // number does not need a second credit spent on it.
        ...(opts.includeTraced ? {} : { sellerPhone: '' }),
      },
      include: { surplusDetail: true },
    });

    const candidates: Candidate[] = leads
      .filter((l) => l.surplusDetail)
      .map((l) => {
        const d = l.surplusDetail!;
        const claimant = `${l.sellerFirstName || ''} ${l.sellerLastName || ''}`.trim();

        // The owner's OWN address, read off the Notice of Surplus Funds, is the
        // target. The property address is a poor substitute and often an
        // actively wrong one: case 2025-0023TD sold a vacant Jacksonville lot
        // and noticed Myrtis Griffin at 72 Smith Drive, Hartford, CT. Tracing
        // the property returned a stranger, as it did on all six of the first
        // live submissions.
        const hasMailing = !!d.ownerMailingStreet;
        const c = hasMailing
          ? {
              street: d.ownerMailingStreet,
              city: d.ownerMailingCity,
              state: d.ownerMailingState,
              zip: d.ownerMailingZip,
            }
          : {
              street: l.propertyAddress,
              city: l.propertyCity,
              state: l.propertyState,
              zip: l.propertyZip,
            };
        return {
          leadId: l.id,
          detailId: d.id,
          claimant,
          caseNumber: d.caseNumber,
          isEntity: ENTITY.test(claimant),
          ...c,
          addressKey: addressKeyOf(c),
          addressSource: (hasMailing ? 'notice' : 'property') as 'notice' | 'property',
        };
      });

    result.candidates = candidates.length;
    if (!candidates.length) return result;

    // A professional address is one that recurs across DIFFERENT cases. Repeats
    // inside one case are a household and stay eligible.
    const caseCounts = addressCaseCounts(candidates);
    const mailVerdicts = new Map(
      leads.filter((l) => l.surplusDetail).map((l) => [l.surplusDetail!.id, l.surplusDetail!.mailVerdict]),
    );

    // Group by address so one submission serves every claimant on it.
    const groups = new Map<string, Candidate[]>();
    for (const c of candidates) {
      const elig = traceEligibility(c, {
        isEntity: c.isEntity,
        addressCaseCount: caseCounts.get(c.addressKey) || 0,
        // Falling back to the property is only worth a credit when the clerk's
        // own mail to it was not returned. An undeliverable verdict is direct
        // evidence the owner was already gone before we started looking.
        propertyFallbackMailVerdict:
          c.addressSource === 'property' ? mailVerdicts.get(c.detailId) : undefined,
      });
      if (!elig.ok) {
        const reason = elig.reason || 'ineligible';
        result.skipped[reason] = (result.skipped[reason] || 0) + 1;
        // Record WHY on the lead, so nobody re-runs the same trace expecting a
        // hit and so the board can show what to do instead.
        await this.note(c.detailId, elig.detail || 'Not eligible for skip trace.');
        continue;
      }
      groups.set(c.addressKey, [...(groups.get(c.addressKey) || []), c]);
    }

    let submitted = 0;
    for (const [, group] of groups) {
      if (opts.limit && submitted >= opts.limit) break;
      submitted += 1;
      try {
        const persons = await this.lookup(group[0]);
        await this.applyToGroup(group, persons, result);
      } catch (e: any) {
        result.errors += 1;
        this.logger.warn(`Surplus skip trace failed for ${group[0].claimant}: ${e.message}`);
        if (/credits/i.test(e.message)) {
          result.message = e.message;
          break; // stop burning calls once the account is out
        }
      }
      await this.pause(CALL_DELAY_MS);
    }
    result.submitted = submitted;

    return result;
  }

  /**
   * One BatchData call. Returns EVERY matched person at the address, not the
   * first: the co-owner lives in that array.
   */
  private async lookup(c: Candidate): Promise<TracedPerson[]> {
    const propertyAddress: Record<string, string> = { street: String(c.street) };
    if (c.city) propertyAddress.city = c.city;
    if (c.state) propertyAddress.state = c.state;
    if (c.zip) propertyAddress.zip = String(c.zip).slice(0, 5);

    let resp;
    try {
      resp = await axios.post(
        `${this.batchBaseUrl}/property/skip-trace`,
        { requests: [{ propertyAddress }] },
        {
          headers: {
            Authorization: `Bearer ${this.batchKey}`,
            Accept: 'application/json',
            'Content-Type': 'application/json',
          },
          timeout: 20000,
        },
      );
    } catch (err: any) {
      const status = err?.response?.status;
      if (status === 401 || status === 403) {
        throw new Error(
          `BatchData auth ${status}: check BATCHDATA_API_KEY has the Property Skip Trace ` +
            `product enabled and matches BATCHDATA_API_BASE_URL (${this.batchBaseUrl})`,
        );
      }
      if (status === 402) throw new Error('BatchData: out of skip-trace credits');
      throw err;
    }

    const persons = resp.data?.results?.persons || [];
    return persons
      .filter((p: any) => p?.meta?.matched)
      .map((p: any) => {
        const seen = new Set<string>();
        const phones = (p.phoneNumbers || [])
          .map((ph: any) => ({ num: normalizePhoneDigits(ph.number), type: ph.type || null }))
          .filter((ph: any) => {
            if (!ph.num || seen.has(ph.num)) return false;
            seen.add(ph.num);
            return true;
          })
          .slice(0, 4);
        const emails = Array.from(
          new Set((p.emails || []).map((e: any) => e.email).filter(Boolean) as string[]),
        ).slice(0, 2);
        return {
          first: p.name?.first || p.firstName || null,
          last: p.name?.last || p.lastName || null,
          phones,
          emails,
        };
      });
  }

  /**
   * Match each returned person to the claimant they actually are.
   *
   * A claimant takes the best identity available: themselves first, a relative
   * second, an unnamed result last. A stranger is never attached, and the
   * rejection is recorded on the lead so it can be audited instead of trusted.
   */
  private async applyToGroup(
    group: Candidate[],
    persons: TracedPerson[],
    result: SurplusTraceResult,
  ): Promise<void> {
    const rank: Record<TraceVerdict, number> = {
      same_person: 3,
      relative: 2,
      unverified: 1,
      stranger: 0,
    };

    const where =
      group[0].addressSource === 'notice'
        ? `at ${group[0].street}, ${group[0].city || ''}`.trim().replace(/,$/, '')
        : 'at the property';

    for (const c of group) {
      let best: { person: TracedPerson; verdict: TraceVerdict; reason: string } | null = null;
      for (const p of persons) {
        const check = verifyTracedName(c.claimant, p.first, p.last);
        if (!best || rank[check.verdict] > rank[best.verdict]) {
          best = { person: p, verdict: check.verdict, reason: check.reason };
        }
      }

      if (!best) {
        await this.note(c.detailId, `Skip trace returned no matched person ${where}.`);
        continue;
      }

      const name = [best.person.first, best.person.last].filter(Boolean).join(' ');

      if (best.verdict === 'stranger') {
        // Discard the contacts. Attaching them means calling an uninvolved
        // person about someone else's money.
        result.mismatched += 1;
        await this.prisma.surplusDetail.update({
          where: { id: c.detailId },
          data: {
            contactMismatch: true,
            mismatchedName: name || null,
            dncScrubbedAt: null,
            callNotes: this.appendNote(
              null,
              `Skip trace returned ${name || 'an unnamed person'} ${where}. ${best.reason} Contacts discarded. The claimant needs a name based route: Sunbiz for an entity, official records for a later deed, or an obituary if deceased.`,
            ),
          },
        });
        continue;
      }

      const hasContact = best.person.phones.length > 0 || best.person.emails.length > 0;
      if (!hasContact) {
        await this.note(c.detailId, `Skip trace matched ${name || 'a person'} but returned no phone or email.`);
        continue;
      }

      const ph = best.person.phones;
      await this.prisma.lead.update({
        where: { id: c.leadId },
        data: {
          ...(ph[0] ? { sellerPhone: `+1${ph[0].num}` } : {}),
          ...(best.person.emails[0] ? { sellerEmail: best.person.emails[0] } : {}),
        },
      });
      await this.prisma.surplusDetail.update({
        where: { id: c.detailId },
        data: {
          phone2: ph[1]?.num || null,
          phone3: ph[2]?.num || null,
          phone4: ph[3]?.num || null,
          phone1Type: ph[0]?.type || null,
          phone2Type: ph[1]?.type || null,
          phone3Type: ph[2]?.type || null,
          phone4Type: ph[3]?.type || null,
          email2: best.person.emails[1] || null,
          contactMismatch: false,
          mismatchedName: null,
          callNotes: this.appendNote(
            null,
            best.verdict === 'relative'
              ? `Skip trace returned ${name}, not the claimant. ${best.reason}`
              : best.verdict === 'unverified'
                ? `Skip trace returned contacts with no name to verify against, so these are unconfirmed.`
                : `Skip trace matched ${name}.`,
          ),
        },
      });
      result.contacted += 1;
    }
  }

  /** Record a reason on the lead without clobbering an existing note. */
  private async note(detailId: string, text: string): Promise<void> {
    const row = await this.prisma.surplusDetail.findUnique({
      where: { id: detailId },
      select: { callNotes: true },
    });
    await this.prisma.surplusDetail.update({
      where: { id: detailId },
      data: { callNotes: this.appendNote(row?.callNotes, text) },
    });
  }

  private appendNote(existing: string | null | undefined, text: string): string {
    const prev = String(existing || '').trim();
    return prev.includes(text) ? prev : [prev, text].filter(Boolean).join('\n');
  }

  private pause(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
  }
}

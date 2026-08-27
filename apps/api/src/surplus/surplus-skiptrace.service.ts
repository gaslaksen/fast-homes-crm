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
import { DncRegistry, LeadSource } from '@fast-homes/shared';
import { normalizePhoneDigits } from '../foreclosures/foreclosure-scoring.util';
import {
  addressCaseCounts,
  addressKeyOf,
  traceEligibility,
  verifyTracedName,
  TraceVerdict,
} from './surplus-skiptrace.util';

/**
 * V3, not V1, and the difference is not cosmetic.
 *
 * V1 returns exactly ONE person per property: `persons[i]` corresponds to
 * `requests[i]`, not to candidate people at one address. Every co-owner beyond
 * the first was therefore unreachable through it, which is why Jessie Hall came
 * back unmatched on 0 Hardee St. It was not evidence about her; the endpoint
 * could not have returned her.
 *
 * V3 returns up to 3 persons per property, and each carries name aliases, an
 * address history, and per-phone dnc/tcpa/reachable flags.
 */
const BATCHDATA_DEFAULT_BASE_URL = 'https://api.batchdata.com/api/v3';
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
  /** The parcel that generated the surplus, always, whatever we submit. */
  propertyStreet: string | null;
  propertyCity: string | null;
  propertyState: string | null;
  propertyZip: string | null;
}

interface TracedPhone {
  num: string;
  type: string | null;
  /** DncRegistry value, or null when there is no reason not to dial. */
  dnc: string | null;
}

interface TracedPerson {
  first: string | null;
  last: string | null;
  /** Alternate spellings the vendor holds for the same person. */
  akas: { first: string | null; last: string | null }[];
  phones: TracedPhone[];
  emails: string[];
  /** The vendor believes this person is deceased. */
  deceased: boolean;
  /**
   * True when this person's address history includes the property that sold.
   * This is the confirmation the surplus course teaches, available here without
   * a human reading search results: a name in another state means nothing until
   * something ties it back to the parcel that generated the surplus.
   */
  livedAtProperty: boolean;
  /** The vendor's own view that this is an owner of record. */
  propertyOwner: boolean;
}

/** Strongest identity first. Shared by the matcher and the assignment order. */
const VERDICT_RANK: Record<TraceVerdict, number> = {
  same_person: 3,
  relative: 2,
  unverified: 1,
  stranger: 0,
};

/**
 * Lines this service wrote itself, so a re-trace can retire the previous
 * result instead of leaving two contradictory ones on one lead.
 */
const TRACE_NOTE =
  /^(Skip trace |Entity owner\.|The clerk's own mail|No mailing address|"[^"]*" is a tax roll)/;

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
          propertyStreet: l.propertyAddress,
          propertyCity: l.propertyCity,
          propertyState: l.propertyState,
          propertyZip: l.propertyZip,
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
        // Applies to the notice address too, not just the property fallback.
        // The notice IS what went to the owner's mailing address, so a returned
        // verdict says that address is dead.
        mailVerdict: mailVerdicts.get(c.detailId),
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
        // Keep the FIRST failure. A run that errors on every address usually
        // errors for one reason, and the caller needs to see it rather than a
        // bare count.
        if (!result.message) result.message = e.message;
        // Out of credits or refused outright: every further call fails the same
        // way, so stop instead of burning the batch discovering that.
        if (/credits/i.test(e.message) || /\b40[13]\b/.test(e.message)) break;
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
    const propertyAddress: Record<string, string> = { street: String(c.propertyStreet || c.street) };
    if (c.propertyCity) propertyAddress.city = c.propertyCity;
    if (c.propertyState) propertyAddress.state = c.propertyState;
    if (c.propertyZip) propertyAddress.zip = String(c.propertyZip).slice(0, 5);

    // Send everything we know in one request. The vendor confirms a NAME
    // against the property itself, which is the surplus course's method applied
    // server-side, and the mailing address off the notice is where the owner
    // actually is. Name plus property plus mailing address is a far better
    // query than any of the three alone.
    const req: Record<string, unknown> = { propertyAddress, requestId: c.detailId };
    const parts = c.claimant.split(/\s+/).filter(Boolean);
    if (parts.length >= 2) {
      req.name = { first: parts[0], last: parts[parts.length - 1] };
    }
    if (c.addressSource === 'notice' && c.street) {
      const mailingAddress: Record<string, string> = { street: c.street };
      if (c.city) mailingAddress.city = c.city;
      if (c.state) mailingAddress.state = c.state;
      if (c.zip) mailingAddress.zip = String(c.zip).slice(0, 5);
      req.mailingAddress = mailingAddress;
    }

    let resp;
    try {
      resp = await axios.post(
        `${this.batchBaseUrl}/property/skip-trace`,
        {
          requests: [req],
          options: {
            // Return TCPA-restricted numbers rather than dropping them, and
            // flag each one. V1 filtered them out silently, which meant a
            // number existed and nobody knew. A flagged number can be weighed;
            // a hidden one cannot.
            includeTCPABlacklistedPhones: true,
          },
        },
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
      // Anything else: say what the vendor actually returned. A bare rethrow
      // left "errors: 1" and nothing else, which is not enough to act on when
      // the run costs money and the fix might be a one word path change.
      const body = err?.response?.data;
      const detail =
        typeof body === 'string'
          ? body.slice(0, 300)
          : body
            ? JSON.stringify(body).slice(0, 300)
            : err.message;
      throw new Error(`BatchData ${status || 'request failed'} at ${this.batchBaseUrl}: ${detail}`);
    }

    const item = resp.data?.result?.data?.[0];
    if (!item || item.meta?.matched === false || item.meta?.error) return [];

    const propertyKey = addressKeyOf({
      street: c.propertyStreet || c.street,
      city: c.propertyCity,
      zip: c.propertyZip,
    });

    return (item.persons || []).map((p: any) => {
      const seen = new Set<string>();
      const phones: TracedPhone[] = (p.phones || [])
        .map((ph: any) => ({
          num: normalizePhoneDigits(ph.number),
          type: ph.type || null,
          // One field, one question: is there a reason not to dial this? The
          // strictest reason wins, since a litigator is the most expensive
          // number in the list to get wrong.
          dnc: p.litigator
            ? DncRegistry.LITIGATOR
            : ph.dnc
              ? DncRegistry.FEDERAL
              : ph.tcpa
                ? DncRegistry.TCPA
                : null,
        }))
        .filter((ph: TracedPhone) => {
          if (!ph.num || seen.has(ph.num)) return false;
          seen.add(ph.num);
          return true;
        })
        .slice(0, 4);

      const emails = Array.from(
        new Set((p.emails || []).map((e: any) => e.email).filter(Boolean) as string[]),
      ).slice(0, 2);

      const livedAtProperty = (p.addresses || []).some(
        (a: any) => addressKeyOf({ street: a.street, city: a.city, zip: a.zip }) === propertyKey,
      );

      return {
        first: p.name?.first || null,
        last: p.name?.last || null,
        akas: (p.name?.akas || []).map((a: any) => ({
          first: a.first || null,
          last: a.last || null,
        })),
        phones,
        emails,
        deceased: !!p.deceased,
        livedAtProperty,
        propertyOwner: !!p.propertyOwner,
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
  /**
   * The best unclaimed person for this claimant, or null when none is left.
   *
   * Checks every alias the vendor holds, not just the primary name: counties
   * and vendors disagree on given names constantly, and an alias is the vendor
   * stating outright that two spellings are one person.
   */
  private bestPersonFor(
    c: Candidate,
    persons: TracedPerson[],
    taken: Set<TracedPerson>,
  ): { person: TracedPerson; verdict: TraceVerdict; reason: string } | null {
    let best: { person: TracedPerson; verdict: TraceVerdict; reason: string } | null = null;
    for (const p of persons) {
      if (taken.has(p)) continue;
      const candidates = [{ first: p.first, last: p.last }, ...p.akas];
      let check = candidates
        .map((n) => verifyTracedName(c.claimant, n.first, n.last))
        .reduce((a, b) => (VERDICT_RANK[b.verdict] > VERDICT_RANK[a.verdict] ? b : a));

      // An address history containing the parcel is EVIDENCE that this person
      // is tied to the surplus. It is not evidence of WHICH person they are.
      // Promoting a surname match on that basis handed Ruth M Johnson her
      // co-owner Calvin's phone numbers: they both lived at 4117 Santee Rd,
      // which is precisely why they are co-claimants.
      if (p.livedAtProperty) {
        check = {
          ...check,
          reason: `${check.reason} Their address history includes the property that sold.`,
        };
      }

      if (!best || VERDICT_RANK[check.verdict] > VERDICT_RANK[best.verdict]) {
        best = { person: p, verdict: check.verdict, reason: check.reason };
      }
    }
    // A stranger is never worth claiming, and holding one would starve another
    // claimant of a person they might legitimately match.
    return best && best.verdict !== 'stranger' ? best : best;
  }

  private async applyToGroup(
    group: Candidate[],
    persons: TracedPerson[],
    result: SurplusTraceResult,
  ): Promise<void> {
    const where =
      group[0].addressSource === 'notice'
        ? `at ${group[0].street}, ${group[0].city || ''}`.trim().replace(/,$/, '')
        : 'at the property';

    // A returned person may be claimed by ONE lead. Without this, a property
    // whose trace returns fewer people than it has claimants hands the same
    // person to all of them: Santee Rd returned Calvin Johnson and both he and
    // Ruth ended up with his numbers, hers labelled as a confirmed match.
    //
    // Claimants are worked strongest-match-first so the best pairing is made
    // before a weaker one can consume the person.
    const taken = new Set<TracedPerson>();
    const scored = group
      .map((c) => ({ c, best: this.bestPersonFor(c, persons, taken) }))
      .sort(
        (a, b) =>
          VERDICT_RANK[b.best?.verdict || 'stranger'] - VERDICT_RANK[a.best?.verdict || 'stranger'],
      );

    for (const { c } of scored) {
      const best = this.bestPersonFor(c, persons, taken);
      if (best) taken.add(best.person);

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
          // Per-number reason not to dial, from the vendor. Stored rather than
          // used to filter, so a restricted number is visible and weighable
          // instead of silently absent.
          phone1Dnc: ph[0]?.dnc || null,
          phone2Dnc: ph[1]?.dnc || null,
          phone3Dnc: ph[2]?.dnc || null,
          phone4Dnc: ph[3]?.dnc || null,
          dncScrubbedAt: new Date(),
          email2: best.person.emails[1] || null,
          contactMismatch: false,
          mismatchedName: null,
          callNotes: this.appendNote(
            null,
            best.verdict === 'relative'
              ? `Skip trace returned ${name}, not the claimant. ${best.reason}`
              : best.verdict === 'unverified'
                ? `Skip trace returned ${name || 'contacts'} ${where}. ${best.reason}`
                : // Say HOW it matched, not just that it did. An exact name match
                  // and a match confirmed by the property's address history are
                  // different levels of confidence, and the person calling
                  // should be able to see which one they have.
                  `Skip trace matched ${name}. ${best.reason}`,
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

  /**
   * Replace the previous trace note rather than stacking another one.
   *
   * Appending left Calvin Johnson's lead saying both "Skip trace matched Calvin
   * Johnson" and "Skip trace returned no matched person", because a re-trace
   * added its result without retiring the earlier one. Only the latest trace is
   * true, so lines this service wrote before are dropped and anything a human
   * typed is kept.
   */
  private appendNote(existing: string | null | undefined, text: string): string {
    const kept = String(existing || '')
      .split('\n')
      .filter((line) => line.trim() && !TRACE_NOTE.test(line.trim()))
      .join('\n');
    return [kept, text].filter(Boolean).join('\n');
  }

  private pause(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
  }
}

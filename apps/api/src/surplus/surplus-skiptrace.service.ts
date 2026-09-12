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
import { DncRegistry, LeadSource, SurplusTraceChannel } from '@fast-homes/shared';
import { normalizePhoneDigits } from '../foreclosures/foreclosure-scoring.util';
import {
  addressCaseCounts,
  addressKeyOf,
  splitClaimantName,
  traceEligibility,
  verifyTracedName,
  TraceVerdict,
} from './surplus-skiptrace.util';
import {
  SurplusEndatoService,
  EndatoPerson,
  currentAddress,
  historyKey,
  verifiedVia,
} from './surplus-endato.service';

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
  /**
   * The name-first rung (Endato), run on every claimant the address rung could
   * not place. `verified` is people tied to the case by address history;
   * `namesakes` is people returned and refused for lack of that tie.
   */
  nameSearch: { searched: number; verified: number; namesakes: number };
  errors: number;
  message?: string;
}

/** A vendor the trace can consult. Decides the note wording and the log's source. */
type TraceSource = 'batchdata' | 'endato';

/**
 * Address-rung refusals that the name rung can still work. An entity or a
 * claimant with no name to search on stays refused.
 */
const NAME_SEARCH_AFTER = new Set([
  'no_house_number',
  'placeholder_address',
  'no_address',
  'not_us_address',
  'shared_address',
]);

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
  /**
   * A given name and a surname are on file, so the vendor can confirm the
   * person against the property rather than against an address alone.
   */
  nameKnown: boolean;
  /**
   * Which address the VENDOR keys the match on.
   *
   * 'property' for a claimant: they owned the parcel, so the parcel is the
   * strongest thing tying a name to this surplus.
   *
   * 'self' for an heir, and the distinction is not cosmetic. An heir never
   * owned the property; they inherited a remainder interest in it. Submitting
   * the parcel returns whoever lives there NOW, and since every heir on a case
   * shares that parcel, every one of them comes back as the same stranger. The
   * first live run did exactly that: both Spencer heirs, at addresses eleven
   * miles apart, came back as one Odell Landeros who lives at the house that
   * sold.
   */
  matchOn?: 'property' | 'self';
  /** The parcel that generated the surplus, always, whatever we submit. */
  propertyStreet: string | null;
  propertyCity: string | null;
  propertyState: string | null;
  propertyZip: string | null;
  /** Where the clerk wrote to the owner, whether or not it is what we submit. */
  mailingStreet?: string | null;
  mailingCity?: string | null;
  mailingState?: string | null;
  mailingZip?: string | null;
  /** When the name rung last searched this claimant, hit or miss. */
  nameSearchedAt?: Date | null;
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
  /**
   * Anything else the caller should read beside the match: the vendor's latest
   * address for the person, relatives, a death record. Appended to the reason.
   */
  extra?: string;
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
  /^(Skip trace |Name search |Entity owner\.|The clerk's own mail|No mailing address|"[^"]*" is a tax roll)/;

const ENTITY = /\b(LLC|L\.L\.C|INC|CORP|CORPORATION|COMPANY|LP|LLP|LLLP|LTD|TRUST|ASSOCIATION|CHURCH|BANK|PARTNERS|HOLDINGS)\b/i;

@Injectable()
export class SurplusSkiptraceService {
  private readonly logger = new Logger(SurplusSkiptraceService.name);
  private readonly batchKey?: string;
  private readonly batchBaseUrl: string;

  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
    private endato?: SurplusEndatoService,
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
    /** Run the name-first rung on what the address rung could not place. Default on. */
    nameSearch?: boolean;
    /** Cap the name searches, which is what costs Endato credits. */
    nameSearchLimit?: number;
    /**
     * Run the address rung at all. Default on. Off sends every named claimant
     * straight to the name rung, for a board the address rung has already
     * been over: re-submitting Brevard's 90 addresses to learn the same
     * nothing again is 90 credits for no information.
     */
    addressSearch?: boolean;
  }): Promise<SurplusTraceResult> {
    const result: SurplusTraceResult = {
      candidates: 0,
      submitted: 0,
      contacted: 0,
      mismatched: 0,
      skipped: {},
      nameSearch: { searched: 0, verified: 0, namesakes: 0 },
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
        const isEntity = ENTITY.test(claimant);
        const nameKnown = !isEntity && claimant.split(/\s+/).filter(Boolean).length >= 2;
        // A mailing address the clerk's own letter bounced from is not sent.
        // Under the v3 query the vendor confirms the NAME against the property
        // that sold, so a claimant with a dead address and a known name is
        // traced by name plus property instead of being written off. Polk
        // carries returned letters on 116 of 141 properties.
        const mailDead = d.mailVerdict === 'undeliverable';
        const useMailing = hasMailing && !(mailDead && nameKnown);
        const c = useMailing
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
          isEntity,
          nameKnown,
          ...c,
          addressKey: addressKeyOf(c),
          addressSource: (useMailing ? 'notice' : 'property') as 'notice' | 'property',
          propertyStreet: l.propertyAddress,
          propertyCity: l.propertyCity,
          propertyState: l.propertyState,
          propertyZip: l.propertyZip,
          mailingStreet: d.ownerMailingStreet,
          mailingCity: d.ownerMailingCity,
          mailingState: d.ownerMailingState,
          mailingZip: d.ownerMailingZip,
          nameSearchedAt: d.nameSearchedAt,
        };
      });

    // Biggest surplus first, so a capped run spends its credits where the fee is.
    const surplusOf = new Map(leads.map((l) => [l.id, l.surplusDetail?.grossSurplus || 0]));
    candidates.sort((a, b) => (surplusOf.get(b.leadId) || 0) - (surplusOf.get(a.leadId) || 0));

    result.candidates = candidates.length;
    if (!candidates.length) return result;

    if (opts.addressSearch === false) {
      if (opts.nameSearch !== false) {
        await this.nameSearchRung(candidates.filter((c) => c.nameKnown), result, opts.nameSearchLimit, opts.includeTraced);
      }
      return result;
    }

    // A professional address is one that recurs across DIFFERENT cases. Repeats
    // inside one case are a household and stay eligible.
    const caseCounts = addressCaseCounts(candidates);
    const mailVerdicts = new Map(
      leads.filter((l) => l.surplusDetail).map((l) => [l.surplusDetail!.id, l.surplusDetail!.mailVerdict]),
    );

    // Group by address so one submission serves every claimant on it.
    const groups = new Map<string, Candidate[]>();
    // Everyone the address rung refuses or fails on, for the name rung.
    const secondRung: Candidate[] = [];
    for (const c of candidates) {
      const elig = traceEligibility(c, {
        isEntity: c.isEntity,
        addressCaseCount: caseCounts.get(c.addressKey) || 0,
        // Applies to the notice address too, not just the property fallback.
        // The notice IS what went to the owner's mailing address, so a returned
        // verdict says that address is dead. With a name on file the candidate
        // was already switched to the property and the gate stands down.
        mailVerdict: mailVerdicts.get(c.detailId),
        nameKnown: c.nameKnown,
      });
      if (!elig.ok) {
        const reason = elig.reason || 'ineligible';
        result.skipped[reason] = (result.skipped[reason] || 0) + 1;
        // Record WHY on the lead, so nobody re-runs the same trace expecting a
        // hit and so the board can show what to do instead.
        await this.note(c.detailId, elig.detail || 'Not eligible for skip trace.', {
          outcome: 'skipped',
          detail: elig.detail || `Not eligible: ${reason}.`,
        });
        if (c.nameKnown && NAME_SEARCH_AFTER.has(reason)) secondRung.push(c);
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
        const contacted = await this.applyToGroup(group, persons, result);
        for (const c of group) if (!contacted.has(c.detailId) && c.nameKnown) secondRung.push(c);
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

    if (opts.nameSearch !== false) {
      await this.nameSearchRung(secondRung, result, opts.nameSearchLimit, opts.includeTraced);
    }

    return result;
  }

  /**
   * Rung two: the name-first search, for every claimant the address rung could
   * not place.
   *
   * BatchData asks "who is at this address?", which is the wrong question on a
   * lot nobody lived on or an address of record that died years ago: 6 people
   * out of 132 across Polk and Brevard. Endato asks "where is this person?"
   * and answered 5 of 7 on the Brevard claimants BatchData had missed. The
   * verification is the same rule as everywhere else in this file, and it is
   * what makes the name rung safe: a person is the claimant only when their
   * address history contains the property that sold or the address the clerk
   * wrote to. Namesakes come back five at a time and are refused.
   *
   * One search per PERSON per case, not per lead: the county spells one owner
   * four ways and each spelling is a lead.
   */
  private async nameSearchRung(
    cands: Candidate[],
    result: SurplusTraceResult,
    limit?: number,
    includeSearched = false,
  ): Promise<void> {
    if (!cands.length || !this.endato?.available) return;

    const groups = new Map<string, Candidate[]>();
    for (const c of cands) {
      // Searched before and missed: the vendor's answer does not change from
      // one week to the next, and the uncapped runs of 2026-09-12 re-bought
      // 58 of the previous day's misses for want of this check. includeTraced
      // is the explicit way to ask again.
      if (c.nameSearchedAt && !includeSearched) {
        result.skipped.name_searched = (result.skipped.name_searched || 0) + 1;
        continue;
      }
      const n = splitClaimantName(displayName(c.claimant));
      if (!n.surname || !n.given.length) continue;
      const key = `${c.caseNumber || c.propertyStreet || ''}|${n.given[0]} ${n.surname}`;
      groups.set(key, [...(groups.get(key) || []), c]);
    }

    let searched = 0;
    for (const [, group] of groups) {
      if (limit && searched >= limit) break;
      // Verification and the note compare names given-first; the county's
      // "ZUMSTEG, ANITA" is turned round once, here, for the whole rung.
      const people = group.map((c) => ({ ...c, claimant: displayName(c.claimant) }));
      const c = people[0];
      // The splitter lowercases; the vendor does not care and the notes read
      // better in the county's own capitals.
      const split = splitClaimantName(c.claimant);
      const n = { given: split.given.map((g) => g.toUpperCase()), surname: split.surname.toUpperCase() };
      // The clerk's mailing address narrows the search when it is a US one;
      // otherwise the property's city and state, which is where the person was.
      const hint =
        c.mailingZip && c.mailingState
          ? { city: c.mailingCity, state: c.mailingState }
          : { city: c.propertyCity, state: c.propertyState || 'FL' };

      searched += 1;
      result.nameSearch.searched += 1;
      let found: EndatoPerson[];
      try {
        found = await this.endato.search({ first: n.given[0], last: n.surname, city: hint.city, state: hint.state });
        // Stamped on every spelling of this person, hit or miss, the moment
        // the credit is spent. A failed request is not stamped, so it is
        // retried next run.
        await this.prisma.surplusDetail.updateMany({
          where: { id: { in: people.map((cc) => cc.detailId) } },
          data: { nameSearchedAt: new Date() },
        });
      } catch (e: any) {
        result.errors += 1;
        if (!result.message) result.message = e.message;
        this.logger.warn(`Name search failed for ${c.claimant}: ${e.message}`);
        if (/auth|out of searches|rate limited/i.test(e.message)) break;
        continue;
      }

      const keys = {
        property: historyKey(c.propertyStreet, c.propertyCity, c.propertyZip),
        mailing: historyKey(c.mailingStreet, c.mailingCity, c.mailingZip),
      };
      const verified: TracedPerson[] = [];
      for (const p of found) {
        const via = verifiedVia(p, keys);
        if (via) verified.push(this.endatoToTraced(p, via));
      }

      if (!verified.length) {
        result.nameSearch.namesakes += found.length;
        const who = `${n.given[0]} ${n.surname}`;
        const text = found.length
          ? `Name search found ${found.length} ${found.length === 1 ? 'person' : 'people'} named ${who}, none with the property or the clerk's address in their history.`
          : `Name search found nobody named ${who} near ${hint.city || hint.state}.`;
        for (const cc of people) {
          await this.note(
            cc.detailId,
            text,
            { outcome: 'no_person', detail: `${text} Both vendors have now been tried. The free name-search links and a professional tracer are what is left.` },
            'endato',
          );
        }
        await this.pause(CALL_DELAY_MS);
        continue;
      }

      result.nameSearch.verified += verified.length;
      // Every lead in the group IS this person, spelled differently by the
      // county, so each gets the match. Passing them as one group would let
      // the first spelling claim the person and leave the rest empty.
      for (const cc of people) await this.applyToGroup([cc], verified, result, 'endato');
      await this.pause(CALL_DELAY_MS);
    }
  }

  /** An Endato person as the matcher sees one, with what else it learned in `extra`. */
  private endatoToTraced(p: EndatoPerson, via: 'property' | 'mailing'): TracedPerson {
    const cur = currentAddress(p);
    const connected = p.phones.filter((x) => x.connected);
    const phones: TracedPhone[] = (connected.length ? connected : p.phones)
      .slice(0, 4)
      // Endato does not flag DNC. Null means "not checked", which the board
      // shows as unscrubbed rather than as clear.
      .map((x) => ({ num: x.num, type: x.type, dnc: null }));
    const rel = p.relatives
      .slice(0, 4)
      .map((r) => (r.type ? `${r.name} (${r.type.toLowerCase()})` : r.name))
      .join(', ');
    return {
      first: p.first,
      last: p.last,
      akas: p.akas,
      phones,
      emails: p.emails.slice(0, 2),
      deceased: p.deceased,
      livedAtProperty: via === 'property',
      propertyOwner: false,
      extra: [
        via === 'mailing' ? "Their address history includes the address the clerk wrote to." : null,
        cur
          ? `Endato's latest address for them is ${cur.street}, ${[cur.city, cur.state, cur.zip].filter(Boolean).join(' ')}${cur.lastSeen ? ` (${cur.lastSeen})` : ''}.`
          : null,
        p.deceased ? 'Endato holds a death record for this person.' : null,
        rel ? `Relatives on file: ${rel}.` : null,
        'Numbers came from a name search and are not DNC scrubbed.',
      ]
        .filter(Boolean)
        .join(' '),
    };
  }

  /**
   * Skip trace HEIRS rather than claimants.
   *
   * A separate entry point because the target is different in a way that
   * matters: an heir's address comes off a probate filing that is usually a
   * year or two old, which is far better input than a claimant's address off a
   * notice the clerk's own mail came back from. The verification is the same
   * though, and deliberately so, since the failure it prevents is identical:
   * attaching a stranger's phone number to a real person.
   *
   * Refuses a DECEASED heir outright. Their share needs its own estate opened
   * and there is nobody at that address to find; submitting one spends a credit
   * to be told what the filing already said.
   */
  async traceHeirs(opts: {
    organizationId?: string | null;
    heirIds?: string[];
    limit?: number;
    includeTraced?: boolean;
  }): Promise<SurplusTraceResult> {
    const result: SurplusTraceResult = {
      candidates: 0,
      submitted: 0,
      contacted: 0,
      mismatched: 0,
      skipped: {},
      nameSearch: { searched: 0, verified: 0, namesakes: 0 },
      errors: 0,
    };

    if (!this.batchKey) {
      result.message = 'BATCHDATA_API_KEY is not set, so no trace was attempted.';
      return result;
    }

    const heirs = await this.prisma.surplusHeir.findMany({
      where: {
        ...(opts.organizationId ? { organizationId: opts.organizationId } : {}),
        // An empty array means "these zero heirs", not "every heir". The same
        // mistake on the claimant path once traced a whole board from a probe.
        ...(opts.heirIds ? { id: { in: opts.heirIds } } : {}),
        ...(opts.includeTraced ? {} : { phone1: null }),
      },
      include: {
        surplusDetail: {
          select: {
            caseNumber: true,
            lead: {
              select: {
                propertyAddress: true,
                propertyCity: true,
                propertyState: true,
                propertyZip: true,
              },
            },
          },
        },
      },
    });

    result.candidates = heirs.length;
    if (!heirs.length) return result;

    let submitted = 0;
    for (const heir of heirs) {
      if (opts.limit && submitted >= opts.limit) break;

      if (heir.deceased) {
        result.skipped.heir_deceased = (result.skipped.heir_deceased || 0) + 1;
        continue;
      }
      if (heir.doNotCall) {
        result.skipped.do_not_call = (result.skipped.do_not_call || 0) + 1;
        continue;
      }
      if (!heir.street || !/^\d/.test(heir.street.trim())) {
        result.skipped.no_house_number = (result.skipped.no_house_number || 0) + 1;
        await this.noteHeir(heir.id, 'No street address on file for this heir, so there is nothing to submit.', {
          outcome: 'skipped',
          detail: 'The filing gave no usable street address for this heir. Search by name instead.',
        });
        continue;
      }

      const property = heir.surplusDetail?.lead;
      submitted += 1;
      try {
        const persons = await this.lookup({
          leadId: '',
          detailId: heir.id,
          claimant: heir.name,
          caseNumber: heir.surplusDetail?.caseNumber ?? null,
          isEntity: false,
          street: heir.street,
          city: heir.city,
          state: heir.state,
          zip: heir.zip,
          addressKey: addressKeyOf({ street: heir.street, city: heir.city, zip: heir.zip }),
          // Match on the heir's OWN address. They never owned the parcel, and
          // submitting it returns whoever lives there now, identically for
          // every heir on the case.
          matchOn: 'self',
          addressSource: 'notice',
          nameKnown: true,
          propertyStreet: property?.propertyAddress ?? null,
          propertyCity: property?.propertyCity ?? null,
          propertyState: property?.propertyState ?? null,
          propertyZip: property?.propertyZip ?? null,
        });
        await this.applyToHeir(heir, persons, result);
      } catch (e: any) {
        result.errors += 1;
        this.logger.warn(`Heir skip trace failed for ${heir.name}: ${e.message}`);
        if (!result.message) result.message = e.message;
        if (/credits/i.test(e.message) || /\b40[13]\b/.test(e.message)) break;
      }
      await this.pause(CALL_DELAY_MS);
    }
    result.submitted = submitted;
    return result;
  }

  /**
   * Attach what came back to one heir, or record why nothing was attached.
   *
   * Uses the same name verification as the claimant path. `livedAtProperty` is
   * NOT promoted to a match here, and that is a deliberate difference in
   * emphasis: an heir who grew up in the house legitimately has it in their
   * address history, so it confirms the family rather than the person.
   */
  private async applyToHeir(
    heir: { id: string; surplusDetailId: string; name: string; street: string | null; city: string | null },
    persons: TracedPerson[],
    result: SurplusTraceResult,
  ): Promise<void> {
    const where = `at ${[heir.street, heir.city].filter(Boolean).join(', ')}`;

    let best: { person: TracedPerson; verdict: TraceVerdict; reason: string } | null = null;
    for (const p of persons) {
      const candidates = [{ first: p.first, last: p.last }, ...p.akas];
      const check = candidates
        .map((n) => verifyTracedName(heir.name, n.first, n.last))
        .reduce((a, b) => (VERDICT_RANK[b.verdict] > VERDICT_RANK[a.verdict] ? b : a));
      if (!best || VERDICT_RANK[check.verdict] > VERDICT_RANK[best.verdict]) {
        best = { person: p, verdict: check.verdict, reason: check.reason };
      }
    }

    if (!best) {
      await this.noteHeir(heir.id, `Skip trace returned no matched person ${where}.`, {
        outcome: 'no_person',
        detail: `The submission went through and came back with nobody matching ${heir.name} ${where}. Re-running the same address returns the same nothing.`,
      });
      return;
    }

    const name = [best.person.first, best.person.last].filter(Boolean).join(' ');

    if (best.verdict === 'stranger') {
      result.mismatched += 1;
      await this.prisma.surplusHeir.update({
        where: { id: heir.id },
        data: {
          contactMismatch: true,
          mismatchedName: name || null,
          tracedAt: new Date(),
          traceOutcome: 'mismatch',
          traceDetail: `Returned ${name || 'an unnamed person'} ${where}, who is not ${heir.name}. ${best.reason}`,
          callNotes: this.appendNote(
            null,
            `Skip trace returned ${name || 'an unnamed person'} ${where}. ${best.reason} Contacts discarded. Check the address on the filing, or search by name.`,
          ),
        },
      });
      await this.logAttempt(heir.surplusDetailId, heir.id, 'mismatch', `Returned ${name || 'an unnamed person'} ${where}, not ${heir.name}.`);
      return;
    }

    const ph = best.person.phones;
    if (!ph.length && !best.person.emails.length) {
      await this.noteHeir(heir.id, `Skip trace matched ${name || 'a person'} but returned no phone or email.`, {
        outcome: 'no_contact',
        detail: `Matched ${name || 'a person'}, but the vendor holds no phone or email for them.`,
      });
      return;
    }

    await this.prisma.surplusHeir.update({
      where: { id: heir.id },
      data: {
        phone1: ph[0]?.num || null,
        phone2: ph[1]?.num || null,
        phone3: ph[2]?.num || null,
        phone4: ph[3]?.num || null,
        phone1Type: ph[0]?.type || null,
        phone2Type: ph[1]?.type || null,
        phone3Type: ph[2]?.type || null,
        phone4Type: ph[3]?.type || null,
        phone1Dnc: ph[0]?.dnc || null,
        phone2Dnc: ph[1]?.dnc || null,
        phone3Dnc: ph[2]?.dnc || null,
        phone4Dnc: ph[3]?.dnc || null,
        email1: best.person.emails[0] || null,
        email2: best.person.emails[1] || null,
        contactMismatch: false,
        mismatchedName: null,
        tracedAt: new Date(),
        traceOutcome:
          best.verdict === 'relative' ? 'relative' : best.verdict === 'unverified' ? 'unverified' : 'matched',
        traceDetail: `Returned ${name || 'contacts'} ${where}. ${best.reason}`,
        callNotes: this.appendNote(
          null,
          best.verdict === 'relative'
            ? `Skip trace returned ${name}, not the heir. ${best.reason} Often the fastest route to them.`
            : `Skip trace matched ${name} ${where}. ${best.reason}`,
        ),
      },
    });
    await this.logAttempt(heir.surplusDetailId, heir.id, 'found', `Returned ${name || 'contacts'} ${where}. ${best.reason}`);
    result.contacted += 1;
  }

  /** Record a reason on an heir, and stamp the structured outcome with it. */
  private async noteHeir(
    heirId: string,
    text: string,
    state: { outcome: string; detail: string },
  ): Promise<void> {
    const row = await this.prisma.surplusHeir.findUnique({
      where: { id: heirId },
      select: { callNotes: true, surplusDetailId: true },
    });
    if (row) {
      await this.logAttempt(
        row.surplusDetailId,
        heirId,
        state.outcome === 'skipped' ? 'skipped' : state.outcome === 'mismatch' ? 'mismatch' : 'nothing',
        state.detail,
      );
    }
    await this.prisma.surplusHeir.update({
      where: { id: heirId },
      data: {
        callNotes: this.appendNote(row?.callNotes, text),
        tracedAt: new Date(),
        traceOutcome: state.outcome,
        traceDetail: state.detail,
      },
    });
  }

  /**
   * One BatchData call. Returns EVERY matched person at the address, not the
   * first: the co-owner lives in that array.
   */
  private async lookup(c: Candidate): Promise<TracedPerson[]> {
    // What the vendor matches on. For a claimant that is the parcel they owned;
    // for an heir it has to be the heir's own address, because they never owned
    // it and the parcel is shared by every heir on the case.
    const self = c.matchOn === 'self';
    const propertyAddress: Record<string, string> = {
      street: String(self ? c.street : c.propertyStreet || c.street),
    };
    const pc = self ? c.city : c.propertyCity;
    const ps = self ? c.state : c.propertyState;
    const pz = self ? c.zip : c.propertyZip;
    if (pc) propertyAddress.city = pc;
    if (ps) propertyAddress.state = ps;
    if (pz) propertyAddress.zip = String(pz).slice(0, 5);

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
    if (!self && c.addressSource === 'notice' && c.street) {
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
      if (p.extra) check = { ...check, reason: `${check.reason} ${p.extra}` };

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
    source: TraceSource = 'batchdata',
  ): Promise<Set<string>> {
    /** Detail ids that came away with a contact, so the caller knows who is left. */
    const contacted = new Set<string>();
    const verb = source === 'endato' ? 'Name search' : 'Skip trace';
    const where =
      source === 'endato'
        ? 'by name'
        : group[0].addressSource === 'notice'
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
        await this.note(
          c.detailId,
          `${verb} returned no matched person ${where}.`,
          {
            outcome: 'no_person',
            detail: `The submission went through and came back with nobody matching ${c.claimant} ${where}. Re-running the same address returns the same nothing; the route now is a name search.`,
          },
          source,
        );
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
            tracedAt: new Date(),
            traceOutcome: 'mismatch',
            traceDetail: `Returned ${name || 'an unnamed person'} ${where}, who is not ${c.claimant}. ${best.reason}`,
            callNotes: this.appendNote(
              null,
              `${verb} returned ${name || 'an unnamed person'} ${where}. ${best.reason} Contacts discarded. The claimant needs a name based route: Sunbiz for an entity, official records for a later deed, or an obituary if deceased.`,
            ),
          },
        });
        await this.logAttempt(c.detailId, null, 'mismatch', `Returned ${name || 'an unnamed person'} ${where}, not ${c.claimant}.`, source);
        continue;
      }

      const hasContact = best.person.phones.length > 0 || best.person.emails.length > 0;
      if (!hasContact) {
        await this.note(
          c.detailId,
          `${verb} matched ${name || 'a person'} but returned no phone or email.${best.person.extra ? ` ${best.person.extra}` : ''}`,
          {
            outcome: 'no_contact',
            detail: `Matched ${name || 'a person'}, but the vendor holds no phone or email for them. The identification is good; the contact route is not.`,
          },
          source,
        );
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
          // BatchData flags DNC per number, so its result counts as scrubbed.
          // Endato does not, and a null here is what makes the board say so.
          dncScrubbedAt: source === 'batchdata' ? new Date() : null,
          email2: best.person.emails[1] || null,
          contactMismatch: false,
          mismatchedName: null,
          tracedAt: new Date(),
          traceOutcome: best.verdict === 'relative' ? 'relative' : best.verdict === 'unverified' ? 'unverified' : 'matched',
          traceDetail: `Returned ${name || 'contacts'} ${where}. ${best.reason}`,
          callNotes: this.appendNote(
            null,
            best.verdict === 'relative'
              ? `${verb} returned ${name}, not the claimant. ${best.reason}`
              : best.verdict === 'unverified'
                ? `${verb} returned ${name || 'contacts'} ${where}. ${best.reason}`
                : // Say HOW it matched, not just that it did. An exact name match
                  // and a match confirmed by the property's address history are
                  // different levels of confidence, and the person calling
                  // should be able to see which one they have.
                  `${verb} matched ${name}. ${best.reason}`,
          ),
        },
      });
      await this.logAttempt(c.detailId, null, 'found', `Returned ${name || 'contacts'} ${where}. ${best.reason}`, source);
      result.contacted += 1;
      contacted.add(c.detailId);
    }
    return contacted;
  }

  /**
   * Record a reason on the lead without clobbering an existing note, and stamp
   * the structured outcome alongside it.
   *
   * The note is for a person reading the lead; the outcome is for the UI, which
   * cannot reliably infer state from prose and previously guessed by matching
   * substrings.
   */
  /**
   * One line in the attempt log per submission, so the panel can show what
   * has been tried and the escalation rule can be checked. A refusal to
   * submit (skipped) costs nothing and is logged at zero; a real submission
   * carries the vendor's per-address cost when configured.
   */
  private async logAttempt(
    detailId: string,
    heirId: string | null,
    result: 'found' | 'nothing' | 'mismatch' | 'skipped',
    summary: string,
    source: TraceSource = 'batchdata',
  ): Promise<void> {
    const cost =
      result === 'skipped'
        ? 0
        : source === 'endato'
          ? this.endato?.costPerSearch ?? null
          : Number(this.config.get<string>('BATCHDATA_COST_PER_ADDRESS') || 0) || null;
    try {
      const detail = await this.prisma.surplusDetail.findUnique({ where: { id: detailId }, select: { organizationId: true } });
      await this.prisma.surplusTraceAttempt.create({
        data: {
          surplusDetailId: detailId,
          heirId,
          organizationId: detail?.organizationId || null,
          channel: SurplusTraceChannel.PAID_DB,
          source,
          result,
          summary: summary.slice(0, 500),
          cost,
          ranAt: new Date(),
        },
      });
    } catch (err: any) {
      // The log is a record of the trace, never a reason for it to fail.
      this.logger.warn(`Could not log the trace attempt on ${detailId}: ${err?.message || err}`);
    }
  }

  private async note(
    detailId: string,
    text: string,
    state?: { outcome: string; detail: string },
    source: TraceSource = 'batchdata',
  ): Promise<void> {
    if (state) {
      await this.logAttempt(
        detailId,
        null,
        state.outcome === 'skipped' ? 'skipped' : state.outcome === 'mismatch' ? 'mismatch' : 'nothing',
        state.detail,
        source,
      );
    }
    const row = await this.prisma.surplusDetail.findUnique({
      where: { id: detailId },
      select: { callNotes: true },
    });
    await this.prisma.surplusDetail.update({
      where: { id: detailId },
      data: {
        callNotes: this.appendNote(row?.callNotes, text),
        // A refusal to submit is still an attempt in the sense that matters:
        // somebody asked, and the answer is on the row.
        ...(state ? { tracedAt: new Date(), traceOutcome: state.outcome, traceDetail: state.detail } : {}),
      },
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

/**
 * "ZUMSTEG, ANITA" as the county writes it, turned round to "ANITA ZUMSTEG"
 * so the name matcher and the vendor see the same shape. A name without a
 * comma is returned as is.
 */
function displayName(raw: string): string {
  const s = String(raw || '').trim();
  const m = /^([^,]+),\s*(.+)$/.exec(s);
  if (!m) return s;
  const [, last, given] = m;
  // "JOHNNY LOVE WILLIAMS, SR" is a suffix, not a surname-first form.
  if (/^(SR|JR|II|III|IV|V|ESQ|ET\s*AL|ETAL|ESTATE\s*OF|DECEASED|TRUSTEE|TR)\.?$/i.test(given.trim())) return s;
  return `${given.trim()} ${last.trim()}`;
}

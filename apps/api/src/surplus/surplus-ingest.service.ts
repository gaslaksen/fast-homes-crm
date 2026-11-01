/**
 * Pulls a county's surplus docket, classifies every case, and writes leads.
 *
 * Idempotent on `dedupeUid`, so a re-run creates nothing new and an overlapping
 * run on a second Railway replica during a deploy is harmless.
 *
 * A re-run is not a no-op though, and that is the point of polling: a case that
 * was OPEN last time and has a `Surplus - Submitted Claim` on it today has to
 * move, and one that reaches `Surplus Distribution` has to be retired before
 * somebody calls a family about money that is already gone.
 */

import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  SurplusClaimStatus,
  SurplusClaimantType,
  SurplusStage,
  SurplusType,
  SurplusFundLocation,
} from '@fast-homes/shared';
import { SurplusService } from './surplus.service';
import { CitrusTaxSmartAdapter, DuvalTaxDeedAdapter, HernandoTaxSmartAdapter } from './pioneer-taxsmart.adapter';
import { CharlotteTaxDeedAdapter } from './charlotte-taxdeed.adapter';
import {
  AlachuaRealTdmAdapter,
  BrevardRealTdmAdapter,
  LakeRealTdmAdapter,
  LeeRealTdmAdapter,
  PinellasRealTdmAdapter,
  PolkRealTdmAdapter,
  SantaRosaRealTdmAdapter,
  FlaglerRealTdmAdapter,
  SarasotaRealTdmAdapter,
  OWNER_ROLES,
} from './realtdm.adapter';
import { SurplusNoticeService, NoticeExtract } from './surplus-notice.service';
import { SurplusProgressService } from './surplus-progress.service';
import { countyRetirement } from './surplus-progress.util';
import { normalizeMailing } from './surplus-address.util';
import { matchRecipient } from './surplus-name-search.util';
import { SurplusSourceAdapter, SurplusCaseDetail, SurplusCaseSummary } from './surplus-source.types';
import { ClassifiedDoc, classifyCase, collapseClaimants, isWorkable } from './surplus-classify.util';
import { surplusUidOf, uidClaimant } from './surplus.util';
import { SURPLUS_FLOOR } from './surplus-compliance';

export type SurplusPollTrigger = 'cron' | 'manual';

export interface SurplusIngestResult {
  scanned: number;
  created: number;
  updated: number;
  skipped: number;
  belowFloor: number;
  classified: number;
  dead: number;
  errors: number;
  /** Held cases whose docket probe matched what we already have. No detail fetch. */
  unchanged: number;
  /** Held cases the list row alone said were paid out. Retired with no detail fetch. */
  retiredFromList: number;
  message?: string;
  /** "case: reason" for each case that threw, so the run row says why without the logs. */
  failures?: string[];
}

/** What one county's day 95 notice sweep did. */
export interface SurplusNoticeSweepResult {
  /** Workable cases with no address and an unread notice on the docket. */
  candidates: number;
  /** Notices read this run. */
  read: number;
  /** Claimant rows that took an address off those reads. */
  addressed: number;
  /** Cases not yet at the read day, left for a later week. */
  tooYoung: number;
  /** Fetch or API failures, tried again next week. */
  errors: number;
  /** Set when the monthly budget stopped the sweep, with the reason. */
  paused?: string;
}

interface IngestOpts {
  organizationId?: string | null;
  trigger?: SurplusPollTrigger;
  /** Cap the detail fetches. Used by the discovery pass and by manual runs. */
  limit?: number;
  /**
   * Fetch every case in full instead of probing held ones for change. The
   * default is the tiered refresh, which is what keeps a weekly county pull
   * to a few hundred requests. `reread` implies this.
   */
  full?: boolean;
  /**
   * Re-read the Notice of Surplus Funds even for cases that already have an
   * owner address, and rewrite the addresses it produced.
   *
   * Off by default, because a notice read costs a vision call and the answer
   * does not change between polls. It exists for the case where the EXTRACTOR
   * changed and the addresses already stored are wrong: reading only the first
   * page of a notice gave every claimant on a case whichever recipient came
   * first, so on a co-owned case one of them was holding the other's address.
   *
   * Only ever rewrites an address this service wrote itself. One somebody typed
   * in by hand outranks anything a machine read off a scan.
   */
  reread?: boolean;
  /**
   * Only these case numbers. With `reread`, the way to correct a handful of
   * addresses without paying to read every notice in the county again.
   */
  cases?: string[];
}

/**
 * Where an owner address came from, as written to ownerAddressSource. Only
 * these may ever be overwritten by a later poll; anything else was typed in by
 * a person and outranks the machine.
 */
const ADDRESS_SOURCE = {
  /** Read off the scanned Notice of Surplus Funds by vision. Duval. */
  notice: 'notice_of_surplus_funds',
  /** The county's own record of who the surplus letter was mailed to. RealTDM. */
  notifications: 'surplus_letter_notifications',
  /** The mailing address on the county's parties list. RealTDM fallback. */
  parties: 'case_parties',
} as const;
const MACHINE_ADDRESS_SOURCES = new Set<string>(Object.values(ADDRESS_SOURCE));

/**
 * SurplusSuppression.reason for a case the county had already paid out or
 * assigned when we first saw it. Nothing to work, nothing to create, and the
 * tiered refresh skips it without a request. Distinct from 'deleted', which is
 * a person's decision and is reported as such.
 */
const RETIRED_BY_COUNTY = 'retired_by_county';

/**
 * How much surplus history a county pull brings in.
 *
 * Past a year the money can only be requested through an attorney, so a case
 * that old is not a lead: it is somebody else's file. The board's Under a year
 * toggle was hiding these one screen at a time; this keeps them out of the
 * database instead. The same 365 days gate the paid lookups in
 * `traceCriteria`, which is where the number comes from.
 */
const PULL_MAX_AGE_DAYS = 365;

/**
 * Whether a list row is older than the pull window. The sale date is the one
 * date every county publishes on the list; the notice comes later and off a
 * scanned letter. No date at all is not too old, the same way it is not too
 * old for a trace.
 */
export function tooOldToPull(
  row: { saleDate?: string | null },
  now = new Date(),
  maxAgeDays = PULL_MAX_AGE_DAYS,
): boolean {
  if (!row.saleDate) return false;
  const when = new Date(`${String(row.saleDate).slice(0, 10)}T00:00:00Z`);
  if (isNaN(when.getTime())) return false;
  return (now.getTime() - when.getTime()) / 86400000 > maxAgeDays;
}

/**
 * Fallback for when the notice cannot be read.
 *
 * Duval publishes no filing dates on the docket, so with no notice extraction
 * the date is estimated as the SALE date and `noticeConfirmed` stays false,
 * which every surface renders as an estimate rather than a confident countdown.
 * The estimate is deliberately early, so a computed deadline lands before the
 * real one rather than after: Myrtis Griffin's notice is dated 7/1/2025 against
 * a 6/11/2025 sale, so the estimate ran 20 days ahead of the truth.
 */
function estimatedNoticeDate(detail: SurplusCaseDetail): string | null {
  return detail.saleDate || null;
}

/**
 * The notice page addressed to this claimant.
 *
 * The fallback matters as much as the match. When a notice yields ONE page and
 * the case has ONE claimant, that page is theirs even if the clerk spelled the
 * name differently from the tax roll. When the case has TWO claimants and the
 * notice yields one page, that page belongs to whoever it names and to nobody
 * else: handing it to both is exactly the bug this replaced, and it ends with a
 * skip trace of the co-owner that reads as a confirmed hit.
 */
function recipientFor<T extends { name?: string | null }>(
  claimant: string,
  recipients: T[] | undefined,
  claimantCount: number,
): T | null {
  const matched = matchRecipient(claimant, recipients || []);
  if (matched) return matched;
  return recipients?.length === 1 && claimantCount === 1 ? recipients[0] : null;
}

interface FoundAddress {
  name: string | null;
  street: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  /** Null for a US address. */
  country?: string | null;
  source: string;
}

/** What the tiered refresh needs to know about a row we already hold. */
interface HeldRow {
  id: string;
  leadId: string;
  sourceCaseId: string | null;
  stage: string | null;
  claimStatus: string | null;
  claimLedger: unknown;
}

/** Every county document id in a persisted ledger. */
function ledgerDocIds(ledger: unknown): string[] {
  if (!Array.isArray(ledger)) return [];
  return ledger
    .map((d: any) => (d && d.docId != null ? String(d.docId) : null))
    .filter((id): id is string => !!id);
}

/**
 * Whether a source hands us the notice for free. RealTDM publishes who the
 * surplus letter was mailed to and when it was filed as structured data, so
 * there is nothing to read with vision and nothing to bill.
 */
function noticeIsFree(detail: SurplusCaseDetail): boolean {
  return !!(detail.noticeRecipients?.length || detail.noticeDate);
}

/**
 * A county-recorded address with its country worked out. A US address is kept
 * exactly as the county wrote it; a foreign one gets its country and loses the
 * US shape, so it is never traced or mailed as American.
 */
function withCountry<T extends { street: string | null; city: string | null; state: string | null; zip: string | null }>(
  a: T & { country?: string | null },
): T & { country: string | null } {
  const n = normalizeMailing(a);
  return n.country ? { ...a, ...n } : { ...a, country: null };
}

/** The notice as the county itself records it, in the shape the vision reader returns. */
function noticeFromSource(detail: SurplusCaseDetail): NoticeExtract | null {
  if (!noticeIsFree(detail)) return null;
  const recipients = (detail.noticeRecipients || []).map((r) =>
    withCountry({
      name: r.name,
      street: r.street,
      city: r.city,
      state: r.state,
      zip: r.zip,
      attention: r.attention ?? null,
    }),
  );
  const first = recipients[0];
  return {
    recipients,
    recipient: first?.name ?? null,
    street: first?.street ?? null,
    city: first?.city ?? null,
    state: first?.state ?? null,
    zip: first?.zip ?? null,
    country: first?.country ?? null,
    noticeDate: detail.noticeDate || null,
    saleDate: detail.saleDate || null,
    surplusAtNotice: detail.surplusAtNotice ?? null,
    certificateNumber: detail.certificateNumber ?? null,
    taxDeedNumber: detail.caseNumber || null,
    realEstateNumber: null,
  };
}

/**
 * The notice that counts on this case. When a case carries several, the LAST
 * is the operative one, since a re-noticed case supersedes its earlier letter.
 * Takes the ledger as classified today or as persisted on the row.
 */
function latestNoticeIn(ledger: unknown): ClassifiedDoc | null {
  if (!Array.isArray(ledger)) return null;
  const notices = (ledger as ClassifiedDoc[]).filter((d) => d && d.kind === 'notice_surplus' && (d.url || d.docId));
  return notices[notices.length - 1] ?? null;
}

/** What identifies a notice document across polls: its docket id, else its url. */
function noticeDocKey(doc: { docId?: string | null; url?: string | null } | null): string | null {
  if (!doc) return null;
  return doc.docId != null ? String(doc.docId) : doc.url || null;
}

@Injectable()
export class SurplusIngestService {
  private readonly logger = new Logger(SurplusIngestService.name);

  constructor(
    private prisma: PrismaService,
    private surplus: SurplusService,
    private duval: DuvalTaxDeedAdapter,
    private notice: SurplusNoticeService,
    private lee?: LeeRealTdmAdapter,
    private polk?: PolkRealTdmAdapter,
    private brevard?: BrevardRealTdmAdapter,
    private pinellas?: PinellasRealTdmAdapter,
    private sarasota?: SarasotaRealTdmAdapter,
    private lake?: LakeRealTdmAdapter,
    private alachua?: AlachuaRealTdmAdapter,
    private santaRosa?: SantaRosaRealTdmAdapter,
    private flagler?: FlaglerRealTdmAdapter,
    private citrus?: CitrusTaxSmartAdapter,
    private hernando?: HernandoTaxSmartAdapter,
    private charlotte?: CharlotteTaxDeedAdapter,
    /** Bookkeeping when the docket retires a case: lead status, timeline, tasks, drips. */
    private progress?: SurplusProgressService,
  ) {}

  /** Every adapter wired up, all weekly: Lee, Polk, Brevard, Pinellas, Sarasota, Lake, Alachua, Santa Rosa and Flagler (RealTDM); Duval, Citrus and Hernando (Pioneer TaxSmart); Charlotte (the clerk's own app). */
  adapters(): SurplusSourceAdapter[] {
    const all: (SurplusSourceAdapter | undefined)[] = [
      this.duval,
      this.lee,
      this.polk,
      this.brevard,
      this.pinellas,
      this.sarasota,
      this.lake,
      this.alachua,
      this.santaRosa,
      this.flagler,
      this.citrus,
      this.hernando,
      this.charlotte,
    ];
    return all.filter((a): a is SurplusSourceAdapter => !!a);
  }

  adapterFor(key: string): SurplusSourceAdapter | undefined {
    return this.adapters().find((a) => a.key === key);
  }

  /**
   * Run one county end to end, recording a SurplusPollRun either way. The run
   * row is written before the work starts so a crashed run is visible as one
   * that never finished, rather than leaving no trace at all.
   */
  /** County pulls in flight on this instance. */
  private readonly inFlight = new Set<string>();

  isRunning(adapterKey: string): boolean {
    return this.inFlight.has(adapterKey);
  }

  /**
   * Run one county, refusing a second run of the same county while one is in
   * flight. The cron has its own lock; a manual pull did not, and a double
   * press on 2026-10-15 ran Charlotte twice side by side for 47 minutes.
   */
  async ingestCounty(
    adapterKey: string,
    opts: IngestOpts = {},
  ): Promise<SurplusIngestResult & { runId: string; createdLeadIds: string[] }> {
    if (this.inFlight.has(adapterKey)) {
      throw new Error(`A ${adapterKey} pull is already running. It records its result when it finishes.`);
    }
    this.inFlight.add(adapterKey);
    try {
      return await this.runCounty(adapterKey, opts);
    } finally {
      this.inFlight.delete(adapterKey);
    }
  }

  private async runCounty(
    adapterKey: string,
    opts: IngestOpts,
  ): Promise<SurplusIngestResult & { runId: string; createdLeadIds: string[] }> {
    const adapter = this.adapterFor(adapterKey);
    const organizationId = opts.organizationId || null;
    // Every lead this run created, so the poll can hand exactly these to the
    // skip trace and never re-spend on a lead an earlier run already tried.
    const createdLeadIds: string[] = [];

    const run = await this.prisma.surplusPollRun.create({
      data: {
        organizationId,
        trigger: opts.trigger || 'manual',
        source: adapterKey,
      },
      select: { id: true },
    });

    const result: SurplusIngestResult = {
      scanned: 0,
      created: 0,
      updated: 0,
      skipped: 0,
      belowFloor: 0,
      classified: 0,
      dead: 0,
      errors: 0,
      unchanged: 0,
      retiredFromList: 0,
    };

    if (!adapter) {
      result.errors = 1;
      result.message = `No surplus adapter registered for "${adapterKey}"`;
      await this.finish(run.id, result);
      return { ...result, runId: run.id, createdLeadIds };
    }

    try {
      const summaries = await adapter.listSurplusCases();
      result.scanned = summaries.length;

      // Only rows that still hold money. On the Duval docket 207 of 208
      // ESCHEATED rows post $0.00, and escheated funds are a Chapter 717 matter
      // needing a registered representative rather than a lead to call. On
      // RealTDM the equivalent is COMPLETED - SOLD BIDDER, which is paid out.
      let candidates = summaries.filter((s) => adapter.isLive(s));

      const beforeFloor = candidates.length;
      candidates = candidates.filter((s) => (s.surplus || 0) >= SURPLUS_FLOOR);
      result.belowFloor = beforeFloor - candidates.length;

      // What we already hold for this county, by the county's own case id.
      // A weekly refresh mostly asks "did anything change?", and the list row
      // plus one probe request answer that for almost every case without the
      // seven-request detail fetch. The first Lee run was 2,600 requests; the
      // tiered refresh is a few hundred.
      const known = await this.knownCases(adapter, organizationId);
      const retired = await this.retiredCases(adapter, organizationId);

      // Only what we can still work. A sale over a year old is left on the
      // county's list rather than fetched and created. A case already on the
      // board stays in the run whatever its age, because a status change on it
      // still matters: the money being gone is worth knowing.
      const beforeAge = candidates.length;
      candidates = candidates.filter(
        (s) => !tooOldToPull(s) || (known.get(s.sourceCaseId) || []).length > 0,
      );
      const tooOld = beforeAge - candidates.length;
      result.skipped += tooOld;
      // Says why a busy list produced nothing, so a quiet run does not read as
      // a broken parser.
      if (tooOld) result.message = `${tooOld} over ${PULL_MAX_AGE_DAYS} days old, left on the county list`;

      // The cap is on detail fetches, so it is spent after the age filter and
      // not on rows that are only going to be dropped.
      if (opts.cases?.length) {
        const want = new Set(opts.cases.map((c) => String(c).trim()));
        candidates = candidates.filter((s) => want.has(s.caseNumber));
      }
      if (opts.limit) candidates = candidates.slice(0, opts.limit);
      const tiered = !opts.full && !opts.reread && !!adapter.probeDocket;

      // Cases the county closed since we last looked. The list status says so:
      // on RealTDM a paid-out case flips to COMPLETED - SOLD BIDDER. Retiring
      // from the list costs nothing and is the transition that matters most,
      // because the alternative is calling a family about money that is gone.
      if (adapter.isPaidOut) {
        for (const s of summaries) {
          const rows = known.get(s.sourceCaseId);
          if (!rows?.length || !adapter.isPaidOut(s)) continue;
          result.retiredFromList += await this.retireFromList(rows, s);
        }
      }

      for (const summary of candidates) {
        try {
          const rows = known.get(summary.sourceCaseId) || [];

          // Already paid out or assigned when we first saw it, and nothing
          // held to update. Terminal, so not even a probe.
          if (tiered && !rows.length && summary.caseNumber && retired.has(summary.caseNumber)) {
            result.unchanged += 1;
            continue;
          }

          let lite = false;
          if (tiered && rows.length) {
            const newest = await adapter.probeDocket!(summary.sourceCaseId);
            const held = new Set(rows.flatMap((r) => ledgerDocIds(r.claimLedger)));
            if (newest && held.has(newest)) {
              // Nothing filed since last time. Carry the posted balance over
              // and move on; the docket, the addresses and the letter are all
              // exactly what we already hold.
              await this.touch(rows, summary);
              result.unchanged += 1;
              await this.pause(adapter.detailDelayMs);
              continue;
            }
            lite = true;
          }

          const detail = await adapter.fetchCase(summary.sourceCaseId, { lite });
          if (!detail) {
            result.skipped += 1;
            continue;
          }
          const outcome = await this.ingestCase(adapter, detail, organizationId, !!opts.reread);
          result.created += outcome.created;
          createdLeadIds.push(...outcome.createdLeadIds);
          result.updated += outcome.updated;
          result.skipped += outcome.skipped;
          result.classified += 1;
          if (outcome.retired) result.dead += 1;
        } catch (e: any) {
          result.errors += 1;
          result.failures = [...(result.failures || []), `${summary.caseNumber}: ${String(e.message).slice(0, 160)}`];
          this.logger.warn(
            `Surplus ingest failed on ${adapter.key} case ${summary.sourceCaseId}: ${e.message}`,
          );
        }
        await this.pause(adapter.detailDelayMs);
      }
    } catch (e: any) {
      result.errors += 1;
      result.message = e.message;
      this.logger.error(`Surplus ingest failed for ${adapterKey}: ${e.message}`);
    }

    await this.finish(run.id, result);
    return { ...result, runId: run.id, createdLeadIds };
  }

  /**
   * Append a line to a finished run's message. The skip trace that follows a
   * cron poll reports here, because the run row is what the health strip and
   * the Daily Brief read, and a trace nobody can see is a trace nobody trusts.
   */
  async noteRun(runId: string, note: string): Promise<void> {
    const run = await this.prisma.surplusPollRun.findUnique({
      where: { id: runId },
      select: { message: true },
    });
    await this.prisma.surplusPollRun.update({
      where: { id: runId },
      data: { message: [run?.message, note].filter(Boolean).join('. ') },
    });
  }

  /**
   * Read the notices of this county's cases that have matured to the read day.
   *
   * The deferred half of the notice read. A case lands with its clock estimated
   * from the sale date; once that estimate reaches SURPLUS_NOTICE_READ_DAY
   * (default 95), and only then, the notice is fetched and read, and the
   * recipients, the real notice date and the surplus at notice are applied to
   * every row of the case exactly as a read during the pull applied them. The
   * sale date is always earlier than the true notice date, so estimated day 95
   * lands before the real day 110 the trace window opens on.
   *
   * A case is in scope when it is still workable, no claimant on it has an
   * address, and its docket carries a notice this exact document id has not
   * been read for. A read that returned nothing recoverable (a fetch or API
   * failure) is not stamped and is tried again next week; a billed read that
   * named nobody is stamped and never bought again. Runs inside each county's
   * weekly pull, after the pull itself, so the ledger it reads is this week's.
   */
  async readMaturedNotices(
    adapterKey: string,
    opts: { organizationId?: string | null; now?: Date; limit?: number } = {},
  ): Promise<SurplusNoticeSweepResult> {
    const out: SurplusNoticeSweepResult = { candidates: 0, read: 0, addressed: 0, tooYoung: 0, errors: 0 };
    const adapter = this.adapterFor(adapterKey);
    if (!adapter) return out;
    const organizationId = opts.organizationId || null;
    const now = opts.now || new Date();
    const readAt = new Date(now.getTime() - this.notice.readDay * 86400000);

    const rows = await this.prisma.surplusDetail.findMany({
      where: {
        organizationId,
        sourceSystem: adapter.key,
        claimStatus: { notIn: [SurplusClaimStatus.DISTRIBUTED, SurplusClaimStatus.ASSIGNED] },
        // Never a case the team has marked Dead. Null stage is a row older
        // than the default and is still in scope.
        OR: [{ stage: null }, { stage: { not: SurplusStage.DEAD } }],
      },
      select: {
        id: true,
        dedupeUid: true,
        caseNumber: true,
        sourceCaseId: true,
        claimLedger: true,
        noticeReadDocId: true,
        ownerMailingStreet: true,
        noticeDate: true,
        saleDate: true,
      },
    });

    // One case at a time: the notice is per case, and every claimant on it
    // takes their own page off the one read.
    const cases = new Map<string, typeof rows>();
    for (const r of rows) {
      const key = r.sourceCaseId || r.caseNumber || r.id;
      cases.set(key, [...(cases.get(key) || []), r]);
    }

    for (const caseRows of cases.values()) {
      if (caseRows.some((r) => r.ownerMailingStreet)) continue;
      const doc = latestNoticeIn(caseRows[0].claimLedger);
      const key = noticeDocKey(doc);
      if (!doc || !key) continue;
      if (caseRows.every((r) => r.noticeReadDocId === key)) continue;
      out.candidates += 1;

      // The clock as the row holds it: the estimate off the sale date until a
      // read confirms it. A case with no date at all cannot mature, so it is
      // read now rather than never.
      const clock = caseRows.find((r) => r.noticeDate || r.saleDate);
      const at = clock?.noticeDate || clock?.saleDate || null;
      if (at && at.getTime() > readAt.getTime()) {
        out.tooYoung += 1;
        continue;
      }
      if (opts.limit && out.read >= opts.limit) continue;

      const spend = await this.notice.canSpend();
      if (!spend.ok) {
        out.paused = spend.reason;
        break;
      }

      const caseNumber = caseRows[0].caseNumber || caseRows[0].sourceCaseId || caseRows[0].id;
      let extract: NoticeExtract | null = null;
      try {
        extract = await this.readNoticeDoc(adapter, doc);
      } catch (e: any) {
        this.logger.warn(`Surplus ${caseNumber}: notice read failed: ${e.message}`);
      }
      if (!extract) {
        out.errors += 1;
        await this.pause(adapter.detailDelayMs);
        continue;
      }
      out.read += 1;

      for (const row of caseRows) {
        const mine = this.addressFor(uidClaimant(row.dedupeUid || ''), extract, {}, caseRows.length);
        if (mine?.street) out.addressed += 1;
        await this.prisma.surplusDetail.update({
          where: { id: row.id },
          data: {
            // THIS claimant's own page, as at ingest: a co-owner's page is
            // never handed to them, and no page means the address stays blank
            // and visible rather than wrong and invisible.
            ...(mine?.street
              ? {
                  noticeRecipient: mine.name,
                  ownerMailingStreet: mine.street,
                  ownerMailingCity: mine.city,
                  ownerMailingState: mine.state,
                  ownerMailingZip: mine.zip,
                  ownerMailingCountry: mine.country ?? null,
                  ownerAddressSource: mine.source,
                }
              : {}),
            // The notice date and the surplus at notice belong to the case,
            // so every claimant takes them, as every claimant did when the
            // read happened at creation.
            ...(extract.noticeDate
              ? { noticeDate: new Date(`${extract.noticeDate}T00:00:00`), noticeConfirmed: true }
              : {}),
            ...(extract.surplusAtNotice ? { surplusAtNotice: extract.surplusAtNotice } : {}),
            noticeReadDocId: key,
          },
        });
      }
      this.logger.log(
        `Surplus ${caseNumber}: notice ${key} read at estimated day ${this.notice.readDay}, ` +
          `${extract.recipients.length} recipient${extract.recipients.length === 1 ? '' : 's'}`,
      );
      await this.pause(adapter.detailDelayMs);
    }

    return out;
  }

  /**
   * One case into zero or more leads.
   *
   * The grain is one lead per CLAIMANT, not per case and not per address. A
   * single sale can owe an owner and two lienholders, and each is a separate
   * conversation with separate economics. Owners routinely appear under several
   * spellings, so they are collapsed first.
   */
  private async ingestCase(
    adapter: SurplusSourceAdapter,
    detail: SurplusCaseDetail,
    organizationId: string | null,
    reread = false,
  ): Promise<{
    created: number;
    updated: number;
    skipped: number;
    retired: boolean;
    createdLeadIds: string[];
  }> {
    const verdict = classifyCase(detail.documents, {
      owners: detail.owners,
      receiptsImplyClaim: !!adapter.receiptsImplyClaim,
      payoutsArePartial: !!adapter.payoutsArePartial,
      categoryFolders: adapter.categoryFolders,
      claimsNotPublished: !!adapter.claimsNotPublished,
      docketInFilingOrder: !!adapter.docketInFilingOrder,
      applicants: String(detail.applicantNames || '')
        .split(/\s*,\s*/)
        .filter(Boolean),
    });
    const claimants = collapseClaimants(detail.owners);
    const out = { created: 0, updated: 0, skipped: 0, retired: false, createdLeadIds: [] as string[] };

    const workable = isWorkable(verdict.claimStatus);
    if (!workable) out.retired = true;

    const uids = claimants.map((c) =>
      surplusUidOf({
        county: adapter.county,
        caseNumber: detail.caseNumber,
        parcelId: detail.parcelId,
        claimant: c.name,
      }),
    );
    const free = noticeIsFree(detail);
    const noticeKey = noticeDocKey(latestNoticeIn(verdict.ledger));

    // A source that publishes the recipients as data costs nothing and is
    // always taken. A scanned notice is NOT read here: every read is a billed
    // vision call, and the address is first needed when the case matures into
    // the trace window, so the weekly pull reads it then (readMaturedNotices,
    // at estimated day SURPLUS_NOTICE_READ_DAY). A case the county pays out
    // before that day is never read at all. Until then the clock is estimated
    // from the sale date and noticeConfirmed stays false, exactly as when a
    // read failed. The one exception is an explicit re-read, which always
    // reads, on a workable case.
    const needsNotice = workable && (free || reread);
    const notice = needsNotice ? await this.readNotice(adapter, verdict, detail) : null;

    for (const claimant of claimants) {
      const dedupeUid = surplusUidOf({
        county: adapter.county,
        caseNumber: detail.caseNumber,
        parcelId: detail.parcelId,
        claimant: claimant.name,
      });

      const existing = await this.prisma.surplusDetail.findFirst({
        where: { organizationId, dedupeUid },
        select: {
          id: true,
          leadId: true,
          stage: true,
          claimStatus: true,
          ownerMailingStreet: true,
          ownerAddressSource: true,
        },
      });

      // A case the team deleted must stay deleted. The tombstone outlives the
      // cascade that takes dedupeUid away with the lead, which is what let the
      // next morning's poll recreate it with every note and edit gone.
      if (!existing && (await this.isSuppressed(organizationId, dedupeUid))) {
        out.skipped += 1;
        continue;
      }

      if (existing) {
        await this.refresh(
          existing,
          detail,
          verdict,
          workable,
          notice,
          claimant.name,
          claimants.length,
          reread,
        );
        out.updated += 1;
        continue;
      }

      // A case the county has already resolved is recorded but not raised as a
      // new lead. Creating it just to mark it Dead would put paid-out cases in
      // front of the team on the day they are ingested. It is remembered as
      // retired, though: with no lead row to probe, the tiered refresh would
      // otherwise re-fetch it in full every week. On the first Lee refresh
      // that was 63 cases, 440 requests, to learn again that they were dead.
      if (!workable) {
        await this.prisma.surplusSuppression.create({
          data: {
            organizationId,
            dedupeUid,
            county: adapter.county,
            caseNumber: detail.caseNumber,
            claimant: claimant.name,
            propertyAddress: detail.propertyAddress || null,
            reason: RETIRED_BY_COUNTY,
          },
        });
        out.skipped += 1;
        continue;
      }

      const deceased = claimant.deceased || verdict.probateOnFile;
      const mine = this.addressFor(claimant.name, notice, detail, claimants.length);
      const res = await this.surplus.createSurplusLead(
        {
          address: detail.propertyAddress || `${adapter.county} County surplus claim`,
          city: detail.propertyCity || undefined,
          state: detail.propertyState || 'FL',
          zip: detail.propertyZip || undefined,
          county: adapter.county,
          parcelId: detail.parcelId || undefined,
          caseNumber: detail.caseNumber,

          claimant: claimant.name,
          claimantType: deceased
            ? SurplusClaimantType.HEIR_ESTATE
            : SurplusClaimantType.PREVIOUS_OWNER,
          deceased,
          heirsRequired: deceased,
          // Informational, not a block. A governmental lien takes a slice off
          // the top; it does not stop the owner claiming the residual.
          competingLien: verdict.counts.govLiens > 0,

          surplusType: SurplusType.TAX_DEED,
          fundLocation: SurplusFundLocation.CLERK,

          saleDate: detail.saleDate,
          salePrice: detail.highBid ?? null,
          // The notice date read off the document, or filed on the docket, is
          // the clerk's own record, so it is confirmed. Without it the clock
          // falls back to the sale date, deliberately early, and stays flagged
          // as an estimate.
          noticeDate: notice?.noticeDate || estimatedNoticeDate(detail),
          noticeConfirmed: !!notice?.noticeDate,
          surplusAtNotice: notice?.surplusAtNotice ?? null,

          // THIS claimant's own address, not the first one on the document.
          // Co-owners are frequently at different addresses, and handing one of
          // them the other's is how a co-owner gets skip traced at the wrong
          // place.
          noticeRecipient: mine?.name ?? null,
          ownerMailingStreet: mine?.street ?? null,
          ownerMailingCity: mine?.city ?? null,
          ownerMailingState: mine?.state ?? null,
          ownerMailingZip: mine?.zip ?? null,
          ownerMailingCountry: mine?.country ?? null,
          ownerAddressSource: mine?.source ?? null,

          grossSurplus: detail.surplus ?? null,

          stage: SurplusStage.NEW,
          notes: verdict.reason,

          claimStatus: verdict.claimStatus,
          mailVerdict: verdict.mailVerdict,
          claimLedger: verdict.ledger as any,
          sourceSystem: adapter.key,
          sourceCaseId: detail.sourceCaseId,
          sourceUrl: detail.sourceUrl,
          importBatch: `${adapter.key} poll`,
        },
        { organizationId },
      );

      if (res.created) {
        out.created += 1;
        if (res.leadId) out.createdLeadIds.push(res.leadId);
      } else out.skipped += 1;
    }

    // A vision read was paid for, so remember which notice it was on every row
    // of the case, including the ones just created. A fetch or API failure
    // comes back null and is not recorded, so it is tried again next poll.
    if (notice && !free && noticeKey) {
      await this.prisma.surplusDetail.updateMany({
        where: { organizationId, dedupeUid: { in: uids } },
        data: { noticeReadDocId: noticeKey },
      });
    }

    return out;
  }

  /**
   * The mailing address for one claimant, and where it came from.
   *
   * The notice (or the county's mailing record standing in for it) wins. When
   * no page or record is addressed to this claimant, the county's parties list
   * is tried, restricted to owner roles so a lienholder's office never becomes
   * an owner's home. Null when neither names them: none is visible, wrong is
   * not.
   */
  private addressFor(
    claimant: string,
    notice: NoticeExtract | null,
    detail: Pick<SurplusCaseDetail, 'parties' | 'noticeRecipients'>,
    claimantCount: number,
  ): FoundAddress | null {
    // The attention line ("C/O GLENN BROWN") travels with the recipient's name
    // rather than the street, so the street still carries a house number and
    // the relative the clerk found is still visible on the card.
    const withAttention = (name: string | null, attention?: string | null) =>
      attention ? `${name || ''}${name ? ', ' : ''}${attention}` : name;

    const fromNotice = recipientFor(claimant, notice?.recipients, claimantCount);
    if (fromNotice?.street) {
      return {
        ...fromNotice,
        name: withAttention(fromNotice.name, fromNotice.attention),
        source: detail.noticeRecipients?.length ? ADDRESS_SOURCE.notifications : ADDRESS_SOURCE.notice,
      };
    }
    const owners = (detail.parties || []).filter((p) => OWNER_ROLES.test(p.role) && p.street);
    const fromParties = recipientFor(claimant, owners, claimantCount);
    if (fromParties?.street) {
      const a = withCountry(fromParties);
      return {
        name: withAttention(fromParties.name, fromParties.attention),
        street: a.street,
        city: a.city,
        state: a.state,
        zip: a.zip,
        country: a.country,
        source: ADDRESS_SOURCE.parties,
      };
    }
    return null;
  }

  /**
   * Bring an existing lead up to date with today's docket.
   *
   * This is the reason the poll runs. The three transitions that matter: a
   * claim appearing, a denial landing, and a distribution closing the case. The
   * last one retires the lead, because the alternative is somebody calling a
   * grieving family about money that was paid to a competitor in March.
   *
   * A stage somebody moved by hand is not overwritten except to retire it. The
   * team's read of a lead beats the poll's.
   */
  /** Has this case been deleted by hand? Checked only before a CREATE. */
  private async isSuppressed(
    organizationId: string | null,
    dedupeUid: string,
  ): Promise<boolean> {
    const hit = await this.prisma.surplusSuppression.findFirst({
      where: { organizationId, dedupeUid },
      select: { id: true },
    });
    if (hit) {
      this.logger.log(`Skipping suppressed surplus case ${dedupeUid}`);
    }
    return !!hit;
  }

  private async refresh(
    existing: {
      id: string;
      leadId: string;
      stage: string | null;
      claimStatus: string | null;
      ownerMailingStreet: string | null;
      ownerAddressSource: string | null;
    },
    detail: SurplusCaseDetail,
    verdict: ReturnType<typeof classifyCase>,
    workable: boolean,
    notice: NoticeExtract | null,
    claimantName: string,
    claimantCount: number,
    reread = false,
  ): Promise<void> {
    const changed = existing.claimStatus !== verdict.claimStatus;
    const retirement = countyRetirement(existing.stage, verdict.claimStatus, workable);

    // The address this claimant's own notice page carries. Null when no page is
    // addressed to them, which on a co-owned case is the honest answer.
    const mine = this.addressFor(claimantName, notice, detail, claimantCount);

    // A machine-written address may be corrected. One somebody typed in by hand
    // may not: a person who went and found the owner outranks anything read off
    // a scan, and silently overwriting that would be the worst kind of bug,
    // because the row would still look filled in.
    const ours = MACHINE_ADDRESS_SOURCES.has(existing.ownerAddressSource || '');
    const correcting = reread && ours && !!notice?.recipients?.length;

    let backfill: Record<string, unknown> = {};
    if (mine?.street && (!existing.ownerMailingStreet || correcting)) {
      // Fills a gap on a lead created before notice extraction existed, or
      // replaces an address the single-page extractor got from the wrong
      // recipient.
      backfill = {
        noticeRecipient: mine.name,
        ownerMailingStreet: mine.street,
        ownerMailingCity: mine.city,
        ownerMailingState: mine.state,
        ownerMailingZip: mine.zip,
        ownerMailingCountry: mine.country ?? null,
        ownerAddressSource: mine.source,
        ...(notice?.noticeDate
          ? { noticeDate: new Date(`${notice.noticeDate}T00:00:00`), noticeConfirmed: true }
          : {}),
        ...(notice?.surplusAtNotice ? { surplusAtNotice: notice.surplusAtNotice } : {}),
      };
    } else if (correcting && existing.ownerMailingStreet && !mine?.street) {
      // The notice read fine and no page is addressed to this claimant, so
      // whatever is on the row came off a co-owner's page. Clear it. A blank
      // address is visible and prompts a name search; a wrong one is invisible
      // and gets skip traced, which returns the co-owner and looks like a hit.
      backfill = {
        noticeRecipient: null,
        ownerMailingStreet: null,
        ownerMailingCity: null,
        ownerMailingState: null,
        ownerMailingZip: null,
        ownerMailingCountry: null,
        ownerAddressSource: null,
      };
      this.logger.warn(
        `Surplus ${detail.caseNumber}: no notice page addressed to ${claimantName}, cleared an address that belonged to a co-owner`,
      );
    }

    if (Object.keys(backfill).length) {
      this.logger.log(
        `Surplus ${detail.caseNumber} owner address for ${claimantName} from the notice: ` +
          `${backfill.ownerMailingStreet || 'cleared'}${backfill.ownerMailingCity ? `, ${backfill.ownerMailingCity} ${backfill.ownerMailingState || ''}` : ''}${backfill.ownerMailingCountry ? `, ${backfill.ownerMailingCountry}` : ''}`,
      );
    }

    await this.prisma.surplusDetail.update({
      where: { id: existing.id },
      data: {
        claimStatus: verdict.claimStatus,
        mailVerdict: verdict.mailVerdict,
        claimLedger: verdict.ledger as any,
        grossSurplus: detail.surplus ?? undefined,
        lastPolledAt: new Date(),
        ...backfill,
        // Retire, but never un-retire: a case the team has already marked Dead
        // stays Dead whatever the docket says today. And never retire a case a
        // client has signed: once we file, our own claim reads as "assigned".
        ...(retirement.action === 'retire' ? retirement.data : {}),
      },
    });

    // The bookkeeping around a retirement (lead status, timeline, open tasks,
    // drips), and the note on a signed case whose docket just changed.
    if (retirement.action === 'retire' || (retirement.action === 'keep' && changed)) {
      await this.progress?.countyRetired(existing.leadId, verdict.claimStatus, existing.stage);
    }

    if (changed) {
      this.logger.log(
        `Surplus ${detail.caseNumber} claim status ${existing.claimStatus} -> ${verdict.claimStatus}`,
      );
    }
  }

  /**
   * The Notice of Surplus Funds for this case.
   *
   * A source that records who the letter went to hands it over as data and
   * nothing is fetched. Otherwise the notice document is found on the docket
   * and read by vision. There is at most one that matters; when a case carries
   * several, the LAST is the operative one, since a re-noticed case supersedes
   * its earlier letter.
   */
  private async readNotice(
    adapter: SurplusSourceAdapter,
    verdict: ReturnType<typeof classifyCase>,
    detail: SurplusCaseDetail,
  ): Promise<NoticeExtract | null> {
    const fromSource = noticeFromSource(detail);
    if (fromSource) return fromSource;
    return this.readNoticeDoc(adapter, latestNoticeIn(verdict.ledger));
  }

  /**
   * Fetch and read one notice document by vision, with the addressees named
   * the way the adapter names its owners. The one path both the re-read during
   * a pull and the day 95 sweep go through, so Charlotte's viewer session and
   * Pioneer's relative links are handled in one place.
   */
  private async readNoticeDoc(
    adapter: SurplusSourceAdapter,
    doc: ClassifiedDoc | null,
  ): Promise<NoticeExtract | null> {
    const extract = await this.fetchNotice(adapter, doc);
    if (!extract || !adapter.ownerName) return extract;
    // Addressees as the adapter names its owners, or the match finds nobody.
    const clean = (name: string | null) => (name ? adapter.ownerName!(name) || name : name);
    const recipients = extract.recipients.map((r) => ({ ...r, name: clean(r.name) }));
    return { ...extract, recipients, recipient: recipients[0]?.name ?? null };
  }

  private async fetchNotice(
    adapter: SurplusSourceAdapter,
    doc: ClassifiedDoc | null,
  ): Promise<NoticeExtract | null> {
    if (!this.notice.available) return null;
    if (!doc) return null;

    // A source whose files sit behind a viewer session hands over the bytes.
    if (adapter.fetchDocument) {
      const file = await adapter.fetchDocument(doc);
      return file ? this.notice.readNoticeFile(file, `${adapter.county} document ${doc.docId}`) : null;
    }

    let url: string | null = null;
    if (doc.url) {
      const base = (adapter as any).baseUrl || 'https://taxdeed.duvalclerk.com';
      url = doc.url.startsWith('http') ? doc.url : `${base}${doc.url}`;
    } else if (adapter.resolveDocumentUrl) {
      url = await adapter.resolveDocumentUrl(doc);
    }
    if (!url) return null;
    return this.notice.readNotice(url);
  }

  /**
   * Every row this county has already produced, keyed by the county's own case
   * id, with just enough to decide whether a case needs fetching again.
   */
  private async knownCases(
    adapter: SurplusSourceAdapter,
    organizationId: string | null,
  ): Promise<Map<string, HeldRow[]>> {
    const rows = await this.prisma.surplusDetail.findMany({
      where: { organizationId, sourceSystem: adapter.key, sourceCaseId: { not: null } },
      select: { id: true, leadId: true, sourceCaseId: true, stage: true, claimStatus: true, claimLedger: true },
    });
    const map = new Map<string, HeldRow[]>();
    for (const r of rows) {
      if (!r.sourceCaseId) continue;
      map.set(r.sourceCaseId, [...(map.get(r.sourceCaseId) || []), r as HeldRow]);
    }
    return map;
  }

  /** Case numbers this county had already resolved when first seen. Never fetched again. */
  private async retiredCases(
    adapter: SurplusSourceAdapter,
    organizationId: string | null,
  ): Promise<Set<string>> {
    const rows = await this.prisma.surplusSuppression.findMany({
      where: { organizationId, county: adapter.county, reason: RETIRED_BY_COUNTY },
      select: { caseNumber: true },
    });
    return new Set(rows.map((r) => r.caseNumber).filter((c): c is string => !!c));
  }

  /** An unchanged case: carry today's posted balance over and note the visit. */
  private async touch(rows: HeldRow[], summary: SurplusCaseSummary): Promise<void> {
    await this.prisma.surplusDetail.updateMany({
      where: { id: { in: rows.map((r) => r.id) } },
      data: {
        lastPolledAt: new Date(),
        ...(summary.surplus != null ? { grossSurplus: summary.surplus } : {}),
      },
    });
  }

  /**
   * The list row says the clerk has paid this case out. Retire every claimant
   * still open on it. Never un-retires, and never touches a stage somebody set
   * by hand beyond moving it to Dead, which is the one direction the poll may
   * push a lead.
   */
  private async retireFromList(rows: HeldRow[], summary: SurplusCaseSummary): Promise<number> {
    let retired = 0;
    for (const row of rows) {
      if (row.stage === SurplusStage.DEAD && row.claimStatus === SurplusClaimStatus.DISTRIBUTED) continue;
      // A signed case is not retired on the list's say-so: the stage stays,
      // the docket status is recorded, and the timeline says to check.
      const retirement = countyRetirement(row.stage, SurplusClaimStatus.DISTRIBUTED, false);
      await this.prisma.surplusDetail.update({
        where: { id: row.id },
        data: {
          claimStatus: SurplusClaimStatus.DISTRIBUTED,
          ...(retirement.action === 'retire' ? retirement.data : {}),
          lastPolledAt: new Date(),
          ...(summary.surplus != null ? { grossSurplus: summary.surplus } : {}),
        },
      });
      if (retirement.action === 'retire' || (retirement.action === 'keep' && row.claimStatus !== SurplusClaimStatus.DISTRIBUTED)) {
        await this.progress?.countyRetired(row.leadId, SurplusClaimStatus.DISTRIBUTED, row.stage);
      }
      retired += 1;
    }
    if (retired) {
      this.logger.log(
        `Surplus ${summary.caseNumber}: county lists it as "${summary.status}", retired ${retired} claimant${retired === 1 ? '' : 's'} from the list row`,
      );
    }
    return retired;
  }

  private async finish(runId: string, r: SurplusIngestResult): Promise<void> {
    // The run table predates the tiered refresh and has no columns for these,
    // so they ride in the message where the health strip already shows it.
    const tiers = [
      r.unchanged ? `${r.unchanged} unchanged since last poll` : null,
      r.retiredFromList ? `${r.retiredFromList} retired from the list row` : null,
    ].filter(Boolean);
    if (tiers.length) r.message = [r.message, tiers.join(', ')].filter(Boolean).join('. ');
    if (r.failures?.length) {
      const shown = r.failures.slice(0, 5).join('; ');
      const more = r.failures.length > 5 ? ` and ${r.failures.length - 5} more` : '';
      r.message = [r.message, `Failed: ${shown}${more}`].filter(Boolean).join('. ');
    }

    await this.prisma.surplusPollRun.update({
      where: { id: runId },
      data: {
        finishedAt: new Date(),
        ok: r.errors === 0,
        scanned: r.scanned,
        created: r.created,
        updated: r.updated,
        skipped: r.skipped,
        belowFloor: r.belowFloor,
        classified: r.classified,
        dead: r.dead,
        errors: r.errors,
        message: r.message || null,
      },
    });
  }

  private pause(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /** The most recent runs, for the health strip on the board. */
  async recentRuns(organizationId?: string | null, take = 10) {
    return this.prisma.surplusPollRun.findMany({
      where: organizationId ? { organizationId } : {},
      orderBy: { startedAt: 'desc' },
      take,
    });
  }

  /**
   * The newest cron run for every registered county, and the newest one that
   * actually pulled the list, whatever their age.
   *
   * The board used to judge each feed off the last ten runs overall. With
   * twelve counties pulled back to back on a Monday, the first two in the
   * order (Duval and Lee) were always pushed out of those ten, so the strip
   * said they had never run when they had pulled minutes earlier.
   */
  async latestCronRuns(organizationId?: string | null) {
    const scope = organizationId ? { organizationId } : {};
    const rows = await Promise.all(
      this.adapters().flatMap((a) => [
        this.prisma.surplusPollRun.findFirst({
          where: { ...scope, source: a.key, trigger: 'cron' },
          orderBy: { startedAt: 'desc' },
        }),
        this.prisma.surplusPollRun.findFirst({
          where: {
            ...scope,
            source: a.key,
            trigger: 'cron',
            OR: [{ ok: true }, { finishedAt: { not: null }, scanned: { gt: 0 } }],
          },
          orderBy: { startedAt: 'desc' },
        }),
      ]),
    );
    return rows.filter((r): r is NonNullable<typeof r> => !!r);
  }
}

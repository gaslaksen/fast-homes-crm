/**
 * Pulls a county's surplus docket, classifies every case, and writes leads.
 *
 * Idempotent on `dedupeUid`, so a re-run creates nothing new and an overlapping
 * run on a second Railway replica during a deploy is harmless.
 *
 * A re-run is not a no-op though, and that is the point of polling daily: a
 * case that was OPEN yesterday and has a `Surplus - Submitted Claim` on it today
 * has to move, and one that reaches `Surplus Distribution` has to be retired
 * before somebody calls a family about money that is already gone.
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
import { DuvalTaxDeedAdapter } from './duval-taxdeed.adapter';
import { SurplusNoticeService, NoticeExtract } from './surplus-notice.service';
import { SurplusSourceAdapter, SurplusCaseDetail } from './surplus-source.types';
import { classifyCase, collapseClaimants, isWorkable } from './surplus-classify.util';
import { surplusUidOf } from './surplus.util';
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
  message?: string;
}

interface IngestOpts {
  organizationId?: string | null;
  trigger?: SurplusPollTrigger;
  /** Cap the detail fetches. Used by the discovery pass and by manual runs. */
  limit?: number;
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

@Injectable()
export class SurplusIngestService {
  private readonly logger = new Logger(SurplusIngestService.name);

  constructor(
    private prisma: PrismaService,
    private surplus: SurplusService,
    private duval: DuvalTaxDeedAdapter,
    private notice: SurplusNoticeService,
  ) {}

  /** Every adapter wired up. Duval only for now; RealTDM is the next one. */
  adapters(): SurplusSourceAdapter[] {
    return [this.duval];
  }

  adapterFor(key: string): SurplusSourceAdapter | undefined {
    return this.adapters().find((a) => a.key === key);
  }

  /**
   * Run one county end to end, recording a SurplusPollRun either way. The run
   * row is written before the work starts so a crashed run is visible as one
   * that never finished, rather than leaving no trace at all.
   */
  async ingestCounty(
    adapterKey: string,
    opts: IngestOpts = {},
  ): Promise<SurplusIngestResult & { runId: string }> {
    const adapter = this.adapterFor(adapterKey);
    const organizationId = opts.organizationId || null;

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
    };

    if (!adapter) {
      result.errors = 1;
      result.message = `No surplus adapter registered for "${adapterKey}"`;
      await this.finish(run.id, result);
      return { ...result, runId: run.id };
    }

    try {
      const summaries = await adapter.listSurplusCases();
      result.scanned = summaries.length;

      // Only SOLD rows carry a live surplus: on the Duval docket 207 of 208
      // ESCHEATED rows post $0.00, and escheated funds are a Chapter 717 matter
      // needing a registered representative rather than a lead to call.
      let candidates = summaries.filter((s) => DuvalTaxDeedAdapter.isLive(s));

      const beforeFloor = candidates.length;
      candidates = candidates.filter((s) => (s.surplus || 0) >= SURPLUS_FLOOR);
      result.belowFloor = beforeFloor - candidates.length;

      if (opts.limit) candidates = candidates.slice(0, opts.limit);

      for (const summary of candidates) {
        try {
          const detail = await adapter.fetchCase(summary.sourceCaseId);
          if (!detail) {
            result.skipped += 1;
            continue;
          }
          const outcome = await this.ingestCase(adapter, detail, organizationId);
          result.created += outcome.created;
          result.updated += outcome.updated;
          result.skipped += outcome.skipped;
          result.classified += 1;
          if (outcome.retired) result.dead += 1;
        } catch (e: any) {
          result.errors += 1;
          this.logger.warn(
            `Surplus ingest failed on ${adapter.key} case ${summary.sourceCaseId}: ${e.message}`,
          );
        }
        await this.pause(DuvalTaxDeedAdapter.detailDelayMs);
      }
    } catch (e: any) {
      result.errors += 1;
      result.message = e.message;
      this.logger.error(`Surplus ingest failed for ${adapterKey}: ${e.message}`);
    }

    await this.finish(run.id, result);
    return { ...result, runId: run.id };
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
  ): Promise<{ created: number; updated: number; skipped: number; retired: boolean }> {
    const verdict = classifyCase(detail.documents, { owners: detail.owners });
    const claimants = collapseClaimants(detail.owners);
    const out = { created: 0, updated: 0, skipped: 0, retired: false };

    const workable = isWorkable(verdict.claimStatus);
    if (!workable) out.retired = true;

    // Read the notice only when it will actually be used: the case is worth
    // working AND at least one of its claimants still has no owner address.
    // A paid-out case does not need one, and a case already carrying one must
    // not be re-read, because every read is a billed API call.
    const needsNotice =
      workable &&
      (await this.prisma.surplusDetail.count({
        where: {
          organizationId,
          dedupeUid: {
            in: claimants.map((c) =>
              surplusUidOf({
                county: adapter.county,
                caseNumber: detail.caseNumber,
                parcelId: detail.parcelId,
                claimant: c.name,
              }),
            ),
          },
          ownerMailingStreet: { not: null },
        },
      })) === 0;
    const notice = needsNotice ? await this.readNotice(adapter, verdict) : null;

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
        },
      });

      if (existing) {
        await this.refresh(existing, detail, verdict, workable, notice);
        out.updated += 1;
        continue;
      }

      // A case the county has already resolved is recorded but not raised as a
      // new lead. Creating it just to mark it Dead would put paid-out cases in
      // front of the team on the day they are ingested.
      if (!workable) {
        out.skipped += 1;
        continue;
      }

      const deceased = claimant.deceased || verdict.probateOnFile;
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
          // The notice date read off the document is the clerk's own record, so
          // it is confirmed. Without it the clock falls back to the sale date,
          // deliberately early, and stays flagged as an estimate.
          noticeDate: notice?.noticeDate || estimatedNoticeDate(detail),
          noticeConfirmed: !!notice?.noticeDate,
          surplusAtNotice: notice?.surplusAtNotice ?? null,

          noticeRecipient: notice?.recipient ?? null,
          ownerMailingStreet: notice?.street ?? null,
          ownerMailingCity: notice?.city ?? null,
          ownerMailingState: notice?.state ?? null,
          ownerMailingZip: notice?.zip ?? null,
          ownerAddressSource: notice?.street ? 'notice_of_surplus_funds' : null,

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

      if (res.created) out.created += 1;
      else out.skipped += 1;
    }

    return out;
  }

  /**
   * Bring an existing lead up to date with today's docket.
   *
   * This is the reason the poll runs daily. The three transitions that matter:
   * a claim appearing, a denial landing, and a distribution closing the case.
   * The last one retires the lead, because the alternative is somebody calling
   * a grieving family about money that was paid to a competitor in March.
   *
   * A stage somebody moved by hand is not overwritten except to retire it. The
   * team's read of a lead beats the poll's.
   */
  private async refresh(
    existing: {
      id: string;
      leadId: string;
      stage: string | null;
      claimStatus: string | null;
      ownerMailingStreet: string | null;
    },
    detail: SurplusCaseDetail,
    verdict: ReturnType<typeof classifyCase>,
    workable: boolean,
    notice: NoticeExtract | null,
  ): Promise<void> {
    const changed = existing.claimStatus !== verdict.claimStatus;

    // Backfill the owner's address on a lead created before notice extraction
    // existed, or one whose earlier read failed. Only ever fills a gap: an
    // address already on the row is left alone, including one somebody typed in
    // by hand, and a re-poll never re-reads a notice it has already read.
    const backfill =
      !existing.ownerMailingStreet && notice?.street
        ? {
            noticeRecipient: notice.recipient,
            ownerMailingStreet: notice.street,
            ownerMailingCity: notice.city,
            ownerMailingState: notice.state,
            ownerMailingZip: notice.zip,
            ownerAddressSource: 'notice_of_surplus_funds',
            ...(notice.noticeDate
              ? { noticeDate: new Date(`${notice.noticeDate}T00:00:00`), noticeConfirmed: true }
              : {}),
            ...(notice.surplusAtNotice ? { surplusAtNotice: notice.surplusAtNotice } : {}),
          }
        : {};

    if (Object.keys(backfill).length) {
      this.logger.log(
        `Surplus ${detail.caseNumber} backfilled owner address from the notice: ${notice?.street}, ${notice?.city} ${notice?.state}`,
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
        // stays Dead whatever the docket says today.
        ...(workable || existing.stage === SurplusStage.DEAD
          ? {}
          : { stage: SurplusStage.DEAD }),
      },
    });

    if (changed) {
      this.logger.log(
        `Surplus ${detail.caseNumber} claim status ${existing.claimStatus} -> ${verdict.claimStatus}`,
      );
    }
  }

  /**
   * Find the Notice of Surplus Funds on the docket and read it.
   *
   * There is at most one that matters; when a case carries several, the LAST is
   * the operative one, since a re-noticed case supersedes its earlier letter.
   */
  private async readNotice(
    adapter: SurplusSourceAdapter,
    verdict: ReturnType<typeof classifyCase>,
  ): Promise<NoticeExtract | null> {
    if (!this.notice.available) return null;
    const notices = verdict.ledger.filter((d) => d.kind === 'notice_surplus' && d.url);
    const doc = notices[notices.length - 1];
    if (!doc?.url) return null;
    const base = (adapter as any).baseUrl || 'https://taxdeed.duvalclerk.com';
    const url = doc.url.startsWith('http') ? doc.url : `${base}${doc.url}`;
    return this.notice.readNotice(url);
  }

  private async finish(runId: string, r: SurplusIngestResult): Promise<void> {
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
}

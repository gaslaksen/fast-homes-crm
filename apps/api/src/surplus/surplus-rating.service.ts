import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import * as XLSX from 'xlsx';
import { LeadSource } from '@fast-homes/shared';
import { PrismaService } from '../prisma/prisma.service';
import { RatingFileRow, ReviewRating, caseKeys, parseRating, readRatingSheets } from './surplus-rating.util';

/**
 * What a ratings file row would do. `new` rates an unrated case, `changed`
 * moves it from one rating to the other, `same` leaves the rating and
 * refreshes the reason. The rest write nothing: `unmatched` names a case
 * Dealcore does not hold, `invalid` has no A or B, and `conflict` is a case
 * the file rates both ways.
 */
export type RatingRowStatus = 'new' | 'changed' | 'same' | 'unmatched' | 'invalid' | 'conflict' | 'duplicate';

export interface RatingPreviewRow extends RatingFileRow {
  status: RatingRowStatus;
  current: string | null;
  /** Claimant rows on the case. One rating covers all of them. */
  leadCount: number;
  claimants: string[];
  detailIds: string[];
}

type DetailRef = {
  id: string;
  county: string | null;
  caseNumber: string | null;
  reviewRating: string | null;
  lead: { sellerFirstName: string | null; sellerLastName: string | null };
};

const WRITES: RatingRowStatus[] = ['new', 'changed', 'same'];

@Injectable()
export class SurplusRatingService {
  private readonly logger = new Logger(SurplusRatingService.name);

  constructor(private prisma: PrismaService) {}

  private async details(organizationId: string | null, county?: string | null): Promise<DetailRef[]> {
    return this.prisma.surplusDetail.findMany({
      where: {
        lead: { source: LeadSource.SURPLUS, ...(organizationId ? { organizationId } : {}) },
        ...(county ? { county: { equals: county, mode: 'insensitive' } } : {}),
      },
      select: {
        id: true,
        county: true,
        caseNumber: true,
        reviewRating: true,
        lead: { select: { sellerFirstName: true, sellerLastName: true } },
      },
    });
  }

  private index(details: DetailRef[]): Map<string, DetailRef[]> {
    const byKey = new Map<string, DetailRef[]>();
    for (const d of details) {
      for (const k of caseKeys(d.county, d.caseNumber)) byKey.set(k, [...(byKey.get(k) || []), d]);
    }
    return byKey;
  }

  /** Every detail row on the case, found by either spelling of the number. */
  private onCase(byKey: Map<string, DetailRef[]>, county: unknown, caseNumber: unknown): DetailRef[] {
    const seen = new Map<string, DetailRef>();
    for (const k of caseKeys(county, caseNumber)) for (const d of byKey.get(k) || []) seen.set(d.id, d);
    return [...seen.values()];
  }

  /** Read a ratings workbook and say what each row would do. Writes nothing. */
  async preview(buffer: Buffer, organizationId: string | null) {
    let workbook: XLSX.WorkBook;
    try {
      workbook = XLSX.read(buffer, { type: 'buffer' });
    } catch {
      throw new BadRequestException('That file could not be read as a spreadsheet.');
    }
    const sheets = workbook.SheetNames.map((name) => ({
      name,
      rows: XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[name], { header: 1, defval: null, raw: false }),
    }));
    const fileRows = readRatingSheets(sheets);
    if (!fileRows.length) {
      throw new BadRequestException('No ratings found. The file needs Rating, County and Case number columns.');
    }

    const byKey = this.index(await this.details(organizationId));

    // A case the file rates twice: the same way is a harmless repeat, two
    // different ways is a question for a person, so neither row writes.
    const ratingsByCase = new Map<string, Set<string>>();
    for (const r of fileRows) {
      if (!r.rating) continue;
      const k = caseKeys(r.county, r.caseNumber)[0];
      if (!k) continue;
      ratingsByCase.set(k, (ratingsByCase.get(k) || new Set()).add(r.rating));
    }
    const firstSeen = new Set<string>();

    const rows: RatingPreviewRow[] = fileRows.map((r) => {
      const on = this.onCase(byKey, r.county, r.caseNumber);
      const current = on.find((d) => d.reviewRating)?.reviewRating ?? null;
      const k = caseKeys(r.county, r.caseNumber)[0];
      let status: RatingRowStatus;
      if (!r.rating || !k) status = 'invalid';
      else if (!on.length) status = 'unmatched';
      else if ((ratingsByCase.get(k)?.size || 0) > 1) status = 'conflict';
      else if (firstSeen.has(k)) status = 'duplicate';
      else status = !current ? 'new' : current === r.rating && on.every((d) => d.reviewRating === r.rating) ? 'same' : 'changed';
      if (k && r.rating) firstSeen.add(k);
      return {
        ...r,
        status,
        current,
        leadCount: on.length,
        claimants: on
          .map((d) => [d.lead.sellerFirstName, d.lead.sellerLastName].filter(Boolean).join(' '))
          .filter(Boolean)
          .slice(0, 4),
        detailIds: on.map((d) => d.id),
      };
    });

    const count = (s: RatingRowStatus) => rows.filter((r) => r.status === s).length;
    return {
      rows,
      summary: {
        rows: rows.length,
        A: rows.filter((r) => r.rating === 'A' && WRITES.includes(r.status)).length,
        B: rows.filter((r) => r.rating === 'B' && WRITES.includes(r.status)).length,
        new: count('new'),
        changed: count('changed'),
        same: count('same'),
        unmatched: count('unmatched'),
        invalid: count('invalid'),
        conflict: count('conflict'),
        duplicate: count('duplicate'),
        leads: rows.filter((r) => WRITES.includes(r.status)).reduce((n, r) => n + r.leadCount, 0),
      },
    };
  }

  /**
   * Apply a ratings file. Matched cases take the file's rating, reason and
   * reviewer; cases the file does not name keep whatever they had, so an A
   * file and a B file can go in one after the other.
   */
  async apply(buffer: Buffer, organizationId: string | null, userId?: string | null) {
    const { rows, summary } = await this.preview(buffer, organizationId);
    const fallbackBy = await this.userName(userId);
    const now = new Date();
    const writes = rows.filter((r) => WRITES.includes(r.status));
    await this.prisma.$transaction(
      writes.map((r) =>
        this.prisma.surplusDetail.updateMany({
          where: { id: { in: r.detailIds } },
          data: {
            reviewRating: r.rating,
            reviewReason: r.reason,
            reviewRatedBy: r.ratedBy || fallbackBy,
            reviewRatedAt: now,
          },
        }),
      ),
    );
    this.logger.log(
      `Ratings import: ${writes.length} case(s) rated (${summary.A} A, ${summary.B} B) across ${summary.leads} claimant row(s); ${summary.unmatched} unmatched`,
    );
    return { applied: writes.length, summary, skipped: rows.filter((r) => !WRITES.includes(r.status)) };
  }

  /**
   * Rate one case by hand from the case panel, or clear it with null. Every
   * claimant row on the case moves together, the same as an import.
   */
  async setForLead(
    leadId: string,
    body: { rating?: unknown; reason?: unknown },
    organizationId: string | null,
    userId?: string | null,
  ) {
    const rating: ReviewRating | null = body.rating == null || body.rating === '' ? null : parseRating(body.rating);
    if (body.rating != null && body.rating !== '' && !rating) {
      throw new BadRequestException('The rating is A, B, or none.');
    }
    const detail = await this.prisma.surplusDetail.findFirst({
      where: { leadId, lead: { source: LeadSource.SURPLUS, ...(organizationId ? { organizationId } : {}) } },
      select: { id: true, county: true, caseNumber: true },
    });
    if (!detail) throw new NotFoundException('That surplus lead was not found.');

    const on = detail.caseNumber
      ? this.onCase(this.index(await this.details(organizationId, detail.county)), detail.county, detail.caseNumber)
      : [];
    const ids = [...new Set([detail.id, ...on.map((d) => d.id)])];
    const reason = body.reason === undefined ? undefined : String(body.reason ?? '').trim() || null;
    const res = await this.prisma.surplusDetail.updateMany({
      where: { id: { in: ids } },
      data: rating
        ? {
            reviewRating: rating,
            ...(reason !== undefined ? { reviewReason: reason } : {}),
            reviewRatedBy: await this.userName(userId),
            reviewRatedAt: new Date(),
          }
        : { reviewRating: null, reviewReason: null, reviewRatedBy: null, reviewRatedAt: null },
    });
    return { rating, updated: res.count };
  }

  private async userName(userId?: string | null): Promise<string | null> {
    if (!userId) return null;
    const u = await this.prisma.user.findUnique({ where: { id: userId }, select: { firstName: true, lastName: true } });
    return u ? `${u.firstName} ${u.lastName}`.trim() || null : null;
  }
}

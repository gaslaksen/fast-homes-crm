import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LeadSource, SurplusClaimantType, SurplusTraceChannel } from '@fast-homes/shared';
import { PrismaService } from '../prisma/prisma.service';
import { candidateOf } from './surplus-skiptrace.service';
import { displayName } from './surplus-skiptrace.util';
import { tierOf } from './surplus.util';
import {
  buildIdiBatchCsv,
  IdiBatchRow,
  idiFirstName,
  idiRelationshipLabel,
  idiSurname,
  IdiMatch,
  IdiMatchCandidate,
  IdiRelative,
  IdiResultRow,
  idiBatchCode,
  idiEchoKey,
  matchIdiRow,
  pairBatchRows,
  mergeEmails,
  mergePhones,
  namesSeveralPeople,
  parseIdiResults,
  prettyPhone,
  readIdiTable,
  shortDate,
  SlotPhone,
} from './surplus-idi.util';

/** The source name on trace attempts, death records and filed relatives. */
export const IDI_SOURCE = 'idi';

/** Lines this service writes to call notes. A re-import replaces them rather than stacking. */
const IDI_NOTE = /^IDI batch /;

/** A relative IDI lists at this age or older is probably dead; the note says to check. */
const LIKELY_DEAD_AGE = 100;

export interface IdiExportResult {
  csv: string;
  fileName: string;
  included: number;
  skipped: { leadId: string; claimant: string; reason: string }[];
  /** The saved batch, or null when nobody could be sent. */
  batch: { id: string; number: number; code: string } | null;
}

/** A saved batch, as the import preview and result describe it. */
export interface IdiBatchSummary {
  id: string;
  code: string;
  fileName: string;
  createdAt: Date;
  rowCount: number;
  /** Rows in this results file that echo a row of the batch. */
  paired: number;
}

/** One batch in the Batches list. */
export interface IdiBatchListItem {
  id: string;
  code: string;
  fileName: string;
  createdAt: Date;
  createdBy: string | null;
  rowCount: number;
  skippedCount: number;
  resultsAppliedAt: Date | null;
  resultsFileName: string | null;
  /** Rows by what IDI returned. Waiting is every row with no result yet. */
  matched: number;
  noContact: number;
  noPerson: number;
  waiting: number;
  deceased: number;
  relativesFiled: number;
  /** Claimants somebody has called, texted, emailed or written to since the results came in. */
  touchedSince: number;
}

/** A person IDI filed as a relative of a batch claimant. */
export interface IdiBatchRelative {
  id: string;
  name: string;
  relationship: string | null;
  phones: string[];
  emails: string[];
  place: string | null;
  deceased: boolean;
  doNotCall: boolean;
  contactStatus: string;
  lastContactedAt: Date | null;
}

/** One row of an open batch: the claimant it was sent for and what came back. */
export interface IdiBatchMemberRow {
  rowNumber: number;
  sent: { first: string; last: string; street: string; city: string; state: string; zip: string };
  result: string | null;
  deceased: boolean;
  phonesReturned: number;
  emailsReturned: number;
  relativesFiled: number;
  leadId: string;
  claimant: string;
  county: string | null;
  caseNumber: string | null;
  stage: string | null;
  claimantDeceased: boolean;
  doNotCall: boolean;
  /** Numbers on the claimant today, IDI's and any held before. */
  phoneCount: number;
  lastTouchedAt: Date | null;
  relatives: IdiBatchRelative[];
}

/** How many recent batches a results file is checked against. */
const BATCH_LOOKBACK = 30;

interface LoadedBatchMember {
  id: string;
  rowNumber: number;
  key: string;
  candidate: IdiMatchCandidate;
}

interface LoadedBatch {
  summary: IdiBatchSummary;
  /** Returned row index to the sent row it echoes. */
  pairs: Map<number, LoadedBatchMember>;
}

export interface IdiPreviewRow {
  index: number;
  input: IdiResultRow['input'];
  found: boolean;
  deceased: 'Y' | 'N' | 'U';
  phones: number;
  emails: number;
  relatives: number;
  confidence: IdiMatch['confidence'];
  /** The claimant the row will be filed against unless a person picks another. */
  leadId: string | null;
  options: {
    leadId: string;
    claimant: string;
    county: string | null;
    caseNumber: string | null;
    addressMatch: boolean;
  }[];
  /** Another row in the same file is matched to the same claimant. */
  sharedWith: number[];
  /** The batch row this one echoes, one based, when it echoes one. */
  batchRow: number | null;
}

export interface IdiApplyResult {
  rows: number;
  applied: number;
  withContact: number;
  noMatch: number;
  deceased: number;
  relativesFiled: number;
  skipped: { index: number; name: string; reason: string }[];
  errors: { index: number; name: string; message: string }[];
  /** The batch the results were recorded against, when the file echoed one. */
  batch: { id: string; code: string } | null;
}

/**
 * IDI batch skip trace, both directions: the upload file built from claimants
 * on the board, and the results file applied back onto them.
 *
 * Applying follows the same rules as the BatchData and Endato traces: a death
 * record marks the claimant dead and moves the file to the heir search, the
 * vendor's relatives are filed as relatives and never as heirs, and every row
 * is logged as a paid database search so the escalation rule can see it ran.
 * Phones are merged newest first rather than overwritten, because IDI dates
 * every number and a number seen last month beats one we have held since a
 * 2019 trace.
 */
@Injectable()
export class SurplusIdiService {
  private readonly logger = new Logger(SurplusIdiService.name);

  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
  ) {}

  // ─── Export ───────────────────────────────────────────────────────────────

  /**
   * The upload file for the chosen claimants, at the address a trace should
   * use: the clerk's notice address when we have one, the property otherwise.
   * Entities, claimants without a usable name, and foreign addresses are left
   * out and named, because IDI can do nothing useful with them.
   */
  async exportBatch(opts: {
    organizationId?: string | null;
    leadIds: string[];
    userId?: string | null;
  }): Promise<IdiExportResult> {
    const leads = await this.prisma.lead.findMany({
      where: {
        source: LeadSource.SURPLUS,
        ...(opts.organizationId ? { organizationId: opts.organizationId } : {}),
        id: { in: opts.leadIds },
      },
      include: { surplusDetail: true },
    });
    const skipped: IdiExportResult['skipped'] = [];
    const rows: (IdiBatchRow & { detailId: string })[] = [];
    for (const l of leads as any[]) {
      if (!l.surplusDetail) continue;
      const c = candidateOf(l);
      const claimant = c.claimant || '(no name)';
      if (c.isEntity) {
        skipped.push({ leadId: l.id, claimant, reason: 'An entity, not a person. Sunbiz is the route.' });
        continue;
      }
      if (!c.nameKnown || !l.sellerLastName) {
        skipped.push({ leadId: l.id, claimant, reason: 'No first and last name to send.' });
        continue;
      }
      if (c.country) {
        skipped.push({ leadId: l.id, claimant, reason: `Address is outside the US (${c.country}).` });
        continue;
      }
      if (!c.street || !c.city || !c.state) {
        skipped.push({ leadId: l.id, claimant, reason: 'No street, city and state on file.' });
        continue;
      }
      rows.push({
        first: idiFirstName(l.sellerFirstName),
        last: String(l.sellerLastName).trim(),
        street: String(c.street).trim(),
        city: String(c.city).trim(),
        state: String(c.state).trim().toUpperCase(),
        zip: String(c.zip || '').replace(/[^0-9]/g, '').slice(0, 5),
        detailId: l.surplusDetail.id,
      });
    }
    const day = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
    const batch = rows.length
      ? await this.saveBatch({ organizationId: opts.organizationId || null, userId: opts.userId || null, rows, skipped: skipped.length, day })
      : null;
    return {
      csv: buildIdiBatchCsv(rows),
      fileName: batch ? batch.fileName : `${day}_IDI_Batch_Surplus.csv`,
      included: rows.length,
      skipped,
      batch: batch ? { id: batch.id, number: batch.number, code: idiBatchCode(batch.number) } : null,
    };
  }

  /**
   * Save the batch and every row exactly as sent. The number counts up per
   * organization; two exports in the same instant collide on the unique
   * index, and the second simply takes the next number.
   */
  private async saveBatch(opts: {
    organizationId: string | null;
    userId: string | null;
    rows: (IdiBatchRow & { detailId: string })[];
    skipped: number;
    day: string;
  }): Promise<{ id: string; number: number; fileName: string }> {
    for (let attempt = 0; ; attempt += 1) {
      const last = await this.prisma.surplusBatch.findFirst({
        where: { organizationId: opts.organizationId },
        orderBy: { number: 'desc' },
        select: { number: true },
      });
      const number = (last?.number || 0) + 1;
      const fileName = `${opts.day}_IDI_Batch_Surplus_${idiBatchCode(number)}.csv`;
      try {
        const made = await this.prisma.surplusBatch.create({
          data: {
            organizationId: opts.organizationId,
            number,
            kind: 'idi_export',
            fileName,
            createdByUserId: opts.userId,
            rowCount: opts.rows.length,
            skippedCount: opts.skipped,
            members: {
              create: opts.rows.map((r, i) => ({
                surplusDetailId: r.detailId,
                organizationId: opts.organizationId,
                rowNumber: i + 1,
                sentFirst: r.first,
                sentLast: r.last,
                sentStreet: r.street,
                sentCity: r.city,
                sentState: r.state,
                sentZip: r.zip,
              })),
            },
          },
          select: { id: true },
        });
        return { id: made.id, number, fileName };
      } catch (err: any) {
        if (err?.code === 'P2002' && attempt < 3) continue;
        throw err;
      }
    }
  }

  // ─── Batches ──────────────────────────────────────────────────────────────

  /** Every saved batch, newest first, with what came back and how much has been worked. */
  async listBatches(organizationId?: string | null): Promise<IdiBatchListItem[]> {
    const batches = await this.prisma.surplusBatch.findMany({
      where: organizationId ? { organizationId } : {},
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: {
        members: {
          select: {
            result: true,
            deceased: true,
            relativesFiled: true,
            surplusDetail: { select: { lead: { select: { lastTouchedAt: true } } } },
          },
        },
      },
    });
    return this.summarize(batches);
  }

  /** The list line for each batch. Members need result, deceased, relativesFiled and the lead's last touch. */
  private async summarize(batches: any[]): Promise<IdiBatchListItem[]> {
    const userIds = Array.from(new Set(batches.map((b) => b.createdByUserId).filter((x): x is string => !!x)));
    const users = userIds.length
      ? await this.prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, firstName: true, lastName: true } })
      : [];
    const nameOf = new Map(users.map((u) => [u.id, `${u.firstName || ''} ${u.lastName || ''}`.trim() || null]));

    return batches.map((b) => {
      const since = b.resultsAppliedAt || b.createdAt;
      const count = (fn: (m: any) => boolean) => b.members.filter(fn).length;
      return {
        id: b.id,
        code: idiBatchCode(b.number),
        fileName: b.fileName,
        createdAt: b.createdAt,
        createdBy: (b.createdByUserId && nameOf.get(b.createdByUserId)) || null,
        rowCount: b.rowCount,
        skippedCount: b.skippedCount,
        resultsAppliedAt: b.resultsAppliedAt,
        resultsFileName: b.resultsFileName,
        matched: count((m) => m.result === 'matched'),
        noContact: count((m) => m.result === 'no_contact'),
        noPerson: count((m) => m.result === 'no_person'),
        waiting: count((m) => !m.result),
        deceased: count((m) => m.deceased),
        relativesFiled: b.members.reduce((n: number, m: any) => n + (m.relativesFiled || 0), 0),
        touchedSince: count((m) => {
          const t = m.surplusDetail?.lead?.lastTouchedAt;
          return !!t && new Date(t).getTime() > new Date(since).getTime();
        }),
      };
    });
  }

  /**
   * One batch, row by row: the claimant each row was sent for as they stand
   * today, and every relative IDI filed on that case, so the people a batch
   * turned up can be found and worked from one place.
   */
  async getBatch(
    batchId: string,
    organizationId?: string | null,
  ): Promise<{ batch: IdiBatchListItem; members: IdiBatchMemberRow[] } | null> {
    const b = await this.prisma.surplusBatch.findFirst({
      where: { id: batchId, ...(organizationId ? { organizationId } : {}) },
      include: {
        members: {
          orderBy: { rowNumber: 'asc' },
          include: {
            surplusDetail: {
              include: {
                lead: true,
                heirs: { where: { sourceKind: IDI_SOURCE }, orderBy: { createdAt: 'asc' } },
              },
            },
          },
        },
      },
    });
    if (!b) return null;
    const [summary] = await this.summarize([b]);

    const members: IdiBatchMemberRow[] = (b.members as any[]).map((m) => {
      const d = m.surplusDetail;
      const l = d.lead;
      const phones = [l.sellerPhone, d.phone2, d.phone3, d.phone4].filter((p) => digits(p));
      return {
        rowNumber: m.rowNumber,
        sent: { first: m.sentFirst, last: m.sentLast, street: m.sentStreet, city: m.sentCity, state: m.sentState, zip: m.sentZip },
        result: m.result,
        deceased: m.deceased,
        phonesReturned: m.phonesReturned,
        emailsReturned: m.emailsReturned,
        relativesFiled: m.relativesFiled,
        leadId: l.id,
        claimant: `${l.sellerFirstName || ''} ${l.sellerLastName || ''}`.trim(),
        county: d.county || null,
        caseNumber: d.caseNumber || null,
        stage: d.stage || null,
        claimantDeceased: !!d.deceased || !!d.heirsRequired,
        doNotCall: !!d.doNotCall || !!l.doNotContact,
        phoneCount: phones.length,
        lastTouchedAt: l.lastTouchedAt || null,
        relatives: (d.heirs as any[]).map((h) => ({
          id: h.id,
          name: h.name,
          relationship: h.relationship || null,
          phones: [h.phone1, h.phone2, h.phone3, h.phone4].filter((p) => digits(p)).map((p) => prettyPhone(digits(p))),
          emails: [h.email1, h.email2].filter(Boolean),
          place: [h.city, h.state].filter(Boolean).join(', ') || null,
          deceased: !!h.deceased,
          doNotCall: !!h.doNotCall,
          contactStatus: h.contactStatus || 'not_contacted',
          lastContactedAt: h.lastContactedAt || null,
        })),
      };
    });
    return { batch: summary, members };
  }

  // ─── Import ───────────────────────────────────────────────────────────────

  /** What a results file would do, written nowhere. */
  async previewImport(
    buffer: Buffer,
    opts: { organizationId?: string | null; fileName?: string },
  ): Promise<{ rows: IdiPreviewRow[]; batch: IdiBatchSummary | null }> {
    const rows = parseIdiResults(readIdiTable(buffer, opts.fileName));
    const batch = await this.findBatch(rows, opts.organizationId);
    const matches = await this.matchAll(rows, opts.organizationId, batch);
    const preview: IdiPreviewRow[] = rows.map((r, i) => ({
      index: r.index,
      input: r.input,
      found: r.matched,
      deceased: r.deceased,
      phones: r.phones.length,
      emails: r.emails.length,
      relatives: r.relatives.length,
      confidence: matches[i].confidence,
      leadId: matches[i].pick?.leadId || null,
      options: matches[i].options.map((o) => ({
        leadId: o.candidate.leadId,
        claimant: o.candidate.claimant,
        county: o.candidate.county,
        caseNumber: o.candidate.caseNumber,
        addressMatch: o.addressMatch,
      })),
      sharedWith: [],
      batchRow: batch?.pairs.get(r.index)?.rowNumber ?? null,
    }));
    for (const p of preview) {
      if (!p.leadId) continue;
      p.sharedWith = preview.filter((o) => o !== p && o.leadId === p.leadId).map((o) => o.index);
    }
    return { rows: preview, batch: batch?.summary || null };
  }

  /**
   * Apply a results file. `assignments` is the preview's choices: row index to
   * lead id, or null to leave the row out. A row with no assignment uses the
   * automatic match, and an ambiguous or unmatched row with no assignment is
   * skipped and named. Nothing is guessed.
   */
  async applyImport(
    buffer: Buffer,
    opts: {
      organizationId?: string | null;
      fileName?: string;
      assignments?: Record<string, string | null>;
      userId?: string | null;
    },
  ): Promise<IdiApplyResult> {
    const rows = parseIdiResults(readIdiTable(buffer, opts.fileName));
    const batch = await this.findBatch(rows, opts.organizationId);
    const matches = await this.matchAll(rows, opts.organizationId, batch);
    const result: IdiApplyResult = {
      rows: rows.length,
      applied: 0,
      withContact: 0,
      noMatch: 0,
      deceased: 0,
      relativesFiled: 0,
      skipped: [],
      errors: [],
      batch: batch ? { id: batch.summary.id, code: batch.summary.code } : null,
    };
    const assignments = opts.assignments || {};
    const recorded = new Set<string>();

    for (let i = 0; i < rows.length; i += 1) {
      const row = rows[i];
      const name = `${row.input.first} ${row.input.last}`.trim();
      const chosen = Object.prototype.hasOwnProperty.call(assignments, String(row.index))
        ? assignments[String(row.index)]
        : matches[i].pick?.leadId || null;
      if (!chosen) {
        result.skipped.push({
          index: row.index,
          name,
          reason:
            Object.prototype.hasOwnProperty.call(assignments, String(row.index))
              ? 'Left out in the preview.'
              : matches[i].confidence === 'ambiguous'
                ? 'More than one claimant fits this name. Pick one in the preview.'
                : 'No claimant on the board has this name.',
        });
        continue;
      }
      const lead: any = await this.prisma.lead.findFirst({
        where: {
          id: chosen,
          source: LeadSource.SURPLUS,
          ...(opts.organizationId ? { organizationId: opts.organizationId } : {}),
        },
        include: { surplusDetail: true },
      });
      if (!lead?.surplusDetail) {
        result.skipped.push({ index: row.index, name, reason: 'That claimant is not on this board.' });
        continue;
      }
      try {
        const out = await this.applyRow(row, lead, opts.userId || null);
        // Recorded on the batch row only when the result went to the claimant
        // that row was sent for. A row a person re-pointed belongs elsewhere.
        const member = batch?.pairs.get(row.index);
        if (member && member.candidate.leadId === lead.id) {
          recorded.add(member.id);
          await this.prisma.surplusBatchMember.update({
            where: { id: member.id },
            data: {
              result: !row.matched ? 'no_person' : out.contact ? 'matched' : 'no_contact',
              deceased: row.deceased === 'Y',
              phonesReturned: row.phones.length,
              emailsReturned: row.emails.length,
              relativesFiled: out.relativesFiled,
              appliedAt: new Date(),
            },
          });
        }
        result.applied += 1;
        if (!row.matched) result.noMatch += 1;
        if (out.contact) result.withContact += 1;
        if (out.deceased) result.deceased += 1;
        result.relativesFiled += out.relativesFiled;
      } catch (err: any) {
        this.logger.warn(`IDI row ${row.index} (${name}) failed: ${err?.message || err}`);
        result.errors.push({ index: row.index, name, message: err?.message || String(err) });
      }
    }
    // A row IDI came back empty on is still an answer for the batch, even
    // when nobody chose to stamp it on the claimant, so the batch never shows
    // it as waiting. Nothing is written to the claimant.
    const emptyAt = new Date();
    for (const row of rows) {
      const member = batch?.pairs.get(row.index);
      if (!member || row.matched || recorded.has(member.id)) continue;
      await this.prisma.surplusBatchMember.update({
        where: { id: member.id },
        data: { result: 'no_person', appliedAt: emptyAt },
      });
      recorded.add(member.id);
    }
    if (batch && recorded.size) {
      await this.prisma.surplusBatch.update({
        where: { id: batch.summary.id },
        data: { resultsAppliedAt: new Date(), resultsFileName: opts.fileName || null, resultsAppliedById: opts.userId || null },
      });
    }
    return result;
  }

  /**
   * The saved batch this results file answers: of the recent batches, the one
   * whose sent rows the most returned rows echo, newest on a tie. Null when
   * the file echoes none of them, which is every file exported before batches
   * were saved.
   */
  private async findBatch(rows: IdiResultRow[], organizationId?: string | null): Promise<LoadedBatch | null> {
    if (!rows.length) return null;
    const recent = await this.prisma.surplusBatch.findMany({
      where: { kind: 'idi_export', ...(organizationId ? { organizationId } : {}) },
      orderBy: { createdAt: 'desc' },
      take: BATCH_LOOKBACK,
      select: {
        id: true,
        members: { select: { id: true, rowNumber: true, sentFirst: true, sentLast: true, sentStreet: true } },
      },
    });
    let best: { id: string; paired: number } | null = null;
    for (const b of recent) {
      const keyed = b.members.map((m) => ({ ...m, key: idiEchoKey({ first: m.sentFirst, last: m.sentLast, street: m.sentStreet }) }));
      const paired = pairBatchRows(rows, keyed).size;
      // Newest first, so only a strictly better count replaces the pick.
      if (paired > 0 && (!best || paired > best.paired)) best = { id: b.id, paired };
    }
    if (!best) return null;

    const full = await this.prisma.surplusBatch.findUnique({
      where: { id: best.id },
      include: { members: { include: { surplusDetail: { include: { lead: true } } } } },
    });
    if (!full) return null;
    const members: LoadedBatchMember[] = (full.members as any[]).map((m) => {
      const d = m.surplusDetail;
      const l = d.lead;
      return {
        id: m.id,
        rowNumber: m.rowNumber,
        key: idiEchoKey({ first: m.sentFirst, last: m.sentLast, street: m.sentStreet }),
        candidate: {
          leadId: l.id,
          detailId: d.id,
          claimant: `${l.sellerFirstName || ''} ${l.sellerLastName || ''}`.trim(),
          county: d.county || null,
          caseNumber: d.caseNumber || null,
          streets: [d.ownerMailingStreet, l.propertyAddress],
        },
      };
    });
    const pairs = pairBatchRows(rows, members);
    return {
      summary: {
        id: full.id,
        code: idiBatchCode(full.number),
        fileName: full.fileName,
        createdAt: full.createdAt,
        rowCount: full.rowCount,
        paired: pairs.size,
      },
      pairs,
    };
  }

  /**
   * Candidates by surname, then the name and address test in the util. A row
   * that echoes one in the saved batch goes to the claimant it was sent for,
   * and the name matches stay listed so a person can still re-point it.
   */
  private async matchAll(rows: IdiResultRow[], organizationId?: string | null, batch?: LoadedBatch | null): Promise<IdiMatch[]> {
    const cache = new Map<string, IdiMatchCandidate[]>();
    const out: IdiMatch[] = [];
    for (const row of rows) {
      const surname = idiSurname(row);
      if (!surname) {
        out.push({ confidence: 'none', pick: null, options: [] });
        continue;
      }
      if (!cache.has(surname)) {
        const leads = await this.prisma.lead.findMany({
          where: {
            source: LeadSource.SURPLUS,
            ...(organizationId ? { organizationId } : {}),
            surplusDetail: { isNot: null },
            OR: [
              { sellerLastName: { contains: surname, mode: 'insensitive' } },
              { sellerFirstName: { contains: surname, mode: 'insensitive' } },
            ],
          },
          include: { surplusDetail: true },
          take: 200,
        });
        cache.set(
          surname,
          (leads as any[]).map((l) => ({
            leadId: l.id,
            detailId: l.surplusDetail.id,
            claimant: `${l.sellerFirstName || ''} ${l.sellerLastName || ''}`.trim(),
            county: l.surplusDetail.county || null,
            caseNumber: l.surplusDetail.caseNumber || null,
            streets: [l.surplusDetail.ownerMailingStreet, l.propertyAddress],
          })),
        );
      }
      const byName = matchIdiRow(row, cache.get(surname)!);
      const sent = batch?.pairs.get(row.index);
      out.push(
        sent
          ? {
              confidence: 'batch',
              pick: sent.candidate,
              options: [
                { candidate: sent.candidate, addressMatch: true },
                ...byName.options.filter((o) => o.candidate.leadId !== sent.candidate.leadId),
              ],
            }
          : byName,
      );
    }
    return out;
  }

  /** Write one returned row onto one claimant. */
  private async applyRow(
    row: IdiResultRow,
    lead: any,
    userId: string | null,
  ): Promise<{ contact: boolean; deceased: boolean; relativesFiled: number }> {
    const d = lead.surplusDetail;
    const claimant = `${lead.sellerFirstName || ''} ${lead.sellerLastName || ''}`.trim();
    const who = displayName(claimant) || claimant;
    const sent = [row.input.street, row.input.city].filter(Boolean).join(', ');
    const now = new Date();

    if (!row.matched) {
      const detail = `IDI returned no match for ${row.input.first} ${row.input.last} at ${sent}. Re-sending the same address returns the same nothing; try the clerk's notice address or a newer one.`;
      await this.prisma.surplusDetail.update({
        where: { id: d.id },
        data: {
          tracedAt: now,
          traceOutcome: 'no_person',
          traceDetail: detail,
          callNotes: this.withNote(d.callNotes, `IDI batch returned no match at ${sent}.`),
        },
      });
      await this.logAttempt(d, 'nothing', detail, userId);
      return { contact: false, deceased: false, relativesFiled: 0 };
    }

    // ── Contacts, merged newest first ──
    const existingPhones: SlotPhone[] = [
      { num: digits(lead.sellerPhone), type: d.phone1Type || null, dnc: d.phone1Dnc || null },
      { num: digits(d.phone2), type: d.phone2Type || null, dnc: d.phone2Dnc || null },
      { num: digits(d.phone3), type: d.phone3Type || null, dnc: d.phone3Dnc || null },
      { num: digits(d.phone4), type: d.phone4Type || null, dnc: d.phone4Dnc || null },
    ].filter((p) => p.num);
    const phones = mergePhones(existingPhones, row.phones, now);
    const emails = mergeEmails([lead.sellerEmail, d.email2].filter(Boolean), row.emails, now);
    const ph = phones.phones;
    const contact = ph.length > 0 || emails.emails.length > 0;

    await this.prisma.lead.update({
      where: { id: lead.id },
      data: {
        sellerPhone: ph[0] ? `+1${ph[0].num}` : lead.sellerPhone || '',
        sellerEmail: emails.emails[0] || lead.sellerEmail || null,
      },
    });

    const phoneLine = row.phones.length
      ? row.phones
          .map((p) => `${prettyPhone(p.num)}${p.type ? ` ${p.type.toLowerCase()}` : ''}${p.lastSeen ? `, last seen ${shortDate(p.lastSeen)}` : ''}`)
          .join('; ')
      : 'no phones';
    const emailLine = row.emails.length
      ? row.emails.map((e) => `${e.email}${e.lastSeen ? ` (last seen ${shortDate(e.lastSeen)})` : ''}`).join('; ')
      : 'no emails';
    const droppedLine = phones.dropped.length
      ? ` Older numbers past the four slots: ${phones.dropped.map((p) => prettyPhone(p.num)).join(', ')}.`
      : '';
    const traceDetail = `IDI matched ${row.input.first} ${row.input.last} at ${sent}: ${row.phones.length} phone${row.phones.length === 1 ? '' : 's'}, ${row.emails.length} email${row.emails.length === 1 ? '' : 's'}, ${row.relatives.length} relative${row.relatives.length === 1 ? '' : 's'}.`;

    await this.prisma.surplusDetail.update({
      where: { id: d.id },
      data: {
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
        // IDI does not scrub, so a new number makes the set unscrubbed again.
        ...(phones.added > 0 ? { dncScrubbedAt: null } : {}),
        email2: emails.emails[1] || null,
        contactMismatch: false,
        mismatchedName: null,
        tracedAt: now,
        traceOutcome: contact ? 'matched' : 'no_contact',
        traceDetail,
        // IDI answered the death question either way.
        deathCheckedAt: now,
        callNotes: this.withNote(d.callNotes, `IDI batch matched ${who}. Phones: ${phoneLine}. Emails: ${emailLine}.${droppedLine}`),
      },
    });
    await this.logAttempt(d, 'found', traceDetail, userId);

    // ── Death record ──
    let markedDead = false;
    if (row.deceased === 'Y') {
      markedDead = await this.markDeceased(lead, row, who);
    }

    // ── Relatives ──
    const relativesFiled = await this.fileRelatives(d, row.relatives, who, markedDead || !!d.deceased);
    return { contact, deceased: markedDead, relativesFiled };
  }

  /**
   * IDI's death flag on the claimant. Same effect as an Endato death record:
   * deceased, heirs required, claimant type heir/estate, tier recomputed. The
   * flag stays editable on the card, and the source says IDI.
   */
  private async markDeceased(lead: any, row: IdiResultRow, who: string): Promise<boolean> {
    const d = lead.surplusDetail;
    const claimant = `${lead.sellerFirstName || ''} ${lead.sellerLastName || ''}`.trim();
    const fresh = await this.prisma.surplusDetail.findUnique({ where: { id: d.id }, select: { callNotes: true } });
    if (namesSeveralPeople(claimant)) {
      // One co-owner's death does not make the other one dead.
      await this.prisma.surplusDetail.update({
        where: { id: d.id },
        data: {
          callNotes: this.withNote(
            fresh?.callNotes,
            `IDI batch lists ${row.input.first} ${row.input.last} as deceased. This lead names more than one person, so it was not marked dead; split the claimants or tick it by hand.`,
          ),
        },
      });
      return false;
    }
    const living = row.relatives.filter((r) => !r.age || r.age < LIKELY_DEAD_AGE);
    const relList = living
      .slice(0, 6)
      .map((r) => `${r.name} (${idiRelationshipLabel(r.relationship).toLowerCase()})`)
      .join(', ');
    const line =
      `Death record (IDI): ${who} is recorded as deceased, no date given. Marked deceased, so only an heir can sign. ` +
      (living.length
        ? `Relatives on file to start the heir search from: ${relList}.`
        : 'IDI lists no living relatives, so the probate court and an obituary are where the heirs are.');
    const facts = { ...d, deceased: true, heirsRequired: true };
    await this.prisma.surplusDetail.update({
      where: { id: d.id },
      data: {
        deceased: true,
        heirsRequired: true,
        claimantType: SurplusClaimantType.HEIR_ESTATE,
        deathSource: IDI_SOURCE,
        tier: tierOf(facts),
        callNotes: /^Death record \(/m.test(fresh?.callNotes || '')
          ? fresh?.callNotes
          : [fresh?.callNotes, line].filter(Boolean).join('\n'),
      },
    });
    return true;
  }

  /**
   * File IDI's relatives as relatives, never heirs. A relative already on the
   * lead under the same name is filled in where it is blank and otherwise
   * left alone, so a hand edit is never overwritten.
   */
  private async fileRelatives(d: any, relatives: IdiRelative[], who: string, claimantDead: boolean): Promise<number> {
    if (!relatives.length) return 0;
    const have = await this.prisma.surplusHeir.findMany({ where: { surplusDetailId: d.id } });
    const byKey = new Map((have as any[]).map((h) => [personKey(h.name), h]));
    let filed = 0;
    for (const r of relatives) {
      const key = personKey(r.name);
      if (!key) continue;
      const label = idiRelationshipLabel(r.relationship);
      const ageNote = r.age ? ` IDI lists them at age ${r.age}.` : '';
      const oldNote = r.age && r.age >= LIKELY_DEAD_AGE ? ' At that age they are probably deceased; check before calling.' : '';
      const route = claimantDead
        ? 'A route to the heirs, not an heir until a probate filing or the family says so.'
        : 'A route to the claimant.';
      const existing = byKey.get(key);
      if (existing) {
        const patch: Record<string, unknown> = {};
        if (!existing.relationship) patch.relationship = label;
        if (!existing.street && r.street) Object.assign(patch, { street: r.street, city: r.city, state: r.state, zip: r.zip });
        if (!existing.phone1 && !existing.phone2 && !existing.phone3 && !existing.phone4 && r.phones.length) {
          Object.assign(patch, { phone1: r.phones[0] || null, phone2: r.phones[1] || null, phone3: r.phones[2] || null });
        }
        if (!existing.email1 && !existing.email2 && r.emails.length) {
          Object.assign(patch, { email1: r.emails[0] || null, email2: r.emails[1] || null });
        }
        if (Object.keys(patch).length) {
          await this.prisma.surplusHeir.update({ where: { id: existing.id }, data: patch });
        }
        continue;
      }
      const made = await this.prisma.surplusHeir.create({
        data: {
          surplusDetailId: d.id,
          organizationId: d.organizationId || null,
          name: r.name,
          relationship: label,
          street: r.street,
          city: r.city,
          state: r.state,
          zip: r.zip,
          phone1: r.phones[0] || null,
          phone2: r.phones[1] || null,
          phone3: r.phones[2] || null,
          email1: r.emails[0] || null,
          email2: r.emails[1] || null,
          role: 'relative',
          sourceKind: IDI_SOURCE,
          callNotes: `IDI lists ${r.name} as ${label.toLowerCase()} of ${who}.${ageNote}${oldNote} ${route}`,
        },
      });
      byKey.set(key, made);
      filed += 1;
    }
    return filed;
  }

  private async logAttempt(d: any, result: 'found' | 'nothing', summary: string, userId: string | null): Promise<void> {
    const cost = Number(this.config.get<string>('IDI_COST_PER_SEARCH') || 0) || null;
    try {
      await this.prisma.surplusTraceAttempt.create({
        data: {
          surplusDetailId: d.id,
          organizationId: d.organizationId || null,
          channel: SurplusTraceChannel.PAID_DB,
          source: 'IDI',
          result,
          summary: summary.slice(0, 500),
          cost,
          ranAt: new Date(),
          byUserId: userId,
        },
      });
    } catch (err: any) {
      // The log is a record of the import, never a reason for it to fail.
      this.logger.warn(`Could not log the IDI attempt on ${d.id}: ${err?.message || err}`);
    }
  }

  /** Replace this service's earlier line rather than stacking another. */
  private withNote(existing: string | null | undefined, text: string): string {
    const kept = String(existing || '')
      .split('\n')
      .filter((line) => line.trim() && !IDI_NOTE.test(line.trim()))
      .join('\n');
    return [kept, text].filter(Boolean).join('\n');
  }
}

function digits(v: string | null | undefined): string {
  const d = String(v || '').replace(/[^0-9]/g, '');
  return d.length >= 10 ? d.slice(-10) : '';
}

/** Sorted name tokens, so "SAMPLE, JOHN P" and "JOHN P SAMPLE" are one person. */
function personKey(n: string | null | undefined): string {
  return String(n || '')
    .toUpperCase()
    .replace(/[^A-Z ]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 1)
    .sort()
    .join(' ');
}

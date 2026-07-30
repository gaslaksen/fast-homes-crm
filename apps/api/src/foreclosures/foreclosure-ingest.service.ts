import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import * as crypto from 'crypto';
import Parser from 'rss-parser';
import { ForeclosureSourceKind } from '@fast-homes/shared';
import { ForeclosuresService } from './foreclosures.service';
import { ForeclosureSkiptraceService } from './foreclosure-skiptrace.service';
import { ForeclosureDocumentService } from './foreclosure-document.service';
import { ForeclosureFilingService } from './foreclosure-filing.service';
import { ForeclosureRulesService } from './foreclosure-rules.service';
import { ForeclosureSignalsService } from './foreclosure-signals.service';
import { ForeclosureExtractService, ExtractedNotice } from './foreclosure-extract.service';
import { ForeclosureLeadInput } from './foreclosure.types';
import { computePriority, parseDateISO, daysToSale } from './foreclosure-scoring.util';

const MECK_TIMES_RSS =
  'https://mecktimes.com/public-notice/export-rss/?feeds=real_estate';

@Injectable()
export class ForeclosureIngestService {
  private readonly logger = new Logger(ForeclosureIngestService.name);
  private readonly rss = new Parser({ timeout: 30000 });
  private readonly feedUrl: string;

  constructor(
    private config: ConfigService,
    private foreclosures: ForeclosuresService,
    private skiptrace: ForeclosureSkiptraceService,
    private extract: ForeclosureExtractService,
    private documents: ForeclosureDocumentService,
    private filings: ForeclosureFilingService,
    private rules: ForeclosureRulesService,
    private signals: ForeclosureSignalsService,
  ) {
    this.feedUrl = this.config.get<string>('FORECLOSURE_RSS_URL') || MECK_TIMES_RSS;
  }

  /**
   * Parse an uploaded eCourts PDF into a single foreclosure lead.
   *
   * The filing is persisted first, so a PDF we cannot read is recorded and
   * surfaced for manual entry instead of being dropped. The document holds the
   * full text; only an 800-char snippet is mirrored onto ForeclosureDetail for
   * the card preview.
   */
  async ingestPdf(
    buffer: Buffer,
    filename: string,
    opts: { organizationId?: string | null },
  ): Promise<{
    created: boolean;
    leadId: string | null;
    documentId: string;
    extracted?: ExtractedNotice;
    reason?: string;
  }> {
    const doc = await this.documents.storePdf(buffer, filename, {
      organizationId: opts.organizationId,
      noticeUrl: null,
    });

    if (!doc.text.trim()) {
      return {
        created: false,
        leadId: doc.leadId,
        documentId: doc.id,
        reason: doc.extractionError || 'no text in PDF',
      };
    }

    // Same file, already turned into a lead. Return that lead rather than
    // re-running extraction. A duplicate with no lead yet falls through and
    // retries, so a previously failed run is recoverable by re-uploading.
    if (doc.duplicate && doc.leadId) {
      return { created: false, leadId: doc.leadId, documentId: doc.id, reason: 'duplicate' };
    }

    const extracted = await this.extract.extractFromText(doc.text);
    if (!extracted.propertyAddress && !extracted.caseNumber && !extracted.ownerNames) {
      return {
        created: false,
        leadId: null,
        documentId: doc.id,
        reason: 'could not extract notice fields',
        extracted,
      };
    }

    // Stable notice id from the file contents so re-uploads dedupe. Kept on
    // sha1 to match ids already written for PDFs ingested before documents
    // existed; the document table's own idempotency key is a sha256.
    const noticeId = `pdf_${crypto.createHash('sha1').update(buffer).digest('hex').slice(0, 16)}`;
    const input = this.extractedToInput(extracted, {
      sourceKind: ForeclosureSourceKind.PDF,
      noticeId,
      rawSnippet: doc.text.slice(0, 800),
      // Regex-read case number backstops the model when it returns nothing.
      caseNumber: extracted.caseNumber || doc.caseNumber || undefined,
    });

    const res = await this.foreclosures.createForeclosureLead(input, { organizationId: opts.organizationId });
    if (res.leadId) await this.documents.attachToLead(doc.id, res.leadId);

    // Full 25-field extraction runs off the same stored text. Failures here
    // must not lose the lead, so it is logged and swallowed.
    try {
      await this.filings.extractAndStore(doc.id, doc.text, {
        organizationId: opts.organizationId,
        leadId: res.leadId,
      });
      // Deterministic classification runs off the stored filing. This is what
      // suppresses equity math on a reverse mortgage.
      if (res.leadId) {
        await this.rules.evaluateLead(res.leadId, opts.organizationId);
        await this.signals.analyzeLead(res.leadId, opts.organizationId);
      }
    } catch (e: any) {
      this.logger.warn(`Filing extraction failed for document ${doc.id}: ${e.message}`);
    }

    if (res.created && res.leadId) this.enrichAsync(res.leadId, opts.organizationId);
    return {
      created: res.created,
      leadId: res.leadId,
      documentId: doc.id,
      extracted,
      reason: res.reason,
    };
  }

  /** Pull the Mecklenburg Times feed and ingest every new, future-dated notice. */
  async ingestRssFeed(
    opts: { organizationId?: string | null },
  ): Promise<{ scanned: number; created: number; skipped: number; pastDated: number; errors: number }> {
    let xml: string;
    try {
      const resp = await axios.get(this.feedUrl, { timeout: 30000, responseType: 'text' });
      xml = resp.data;
    } catch (e: any) {
      this.logger.error(`RSS fetch failed: ${e.message}`);
      return { scanned: 0, created: 0, skipped: 0, pastDated: 0, errors: 1 };
    }

    let feed: Parser.Output<any>;
    try {
      feed = await this.rss.parseString(xml);
    } catch (e: any) {
      this.logger.error(`RSS parse failed: ${e.message}`);
      return { scanned: 0, created: 0, skipped: 0, pastDated: 0, errors: 1 };
    }

    const items = feed.items || [];
    let created = 0;
    let skipped = 0;
    let pastDated = 0;
    let errors = 0;

    for (const item of items) {
      try {
        const noticeUrl = item.link || '';
        const noticeId = this.noticeIdFromLink(noticeUrl);
        const text = [item.title, (item as any).contentSnippet, (item as any).content]
          .filter(Boolean)
          .join('\n');

        const extracted = await this.extract.extractFromText(text);
        if (!extracted.propertyAddress && !extracted.caseNumber) {
          skipped++;
          continue;
        }

        const input = this.extractedToInput(extracted, {
          sourceKind: ForeclosureSourceKind.RSS,
          noticeId: noticeId || undefined,
          noticeUrl,
          rawSnippet: text.slice(0, 800),
        });

        // Skip auctions that have already happened.
        const saleIso = parseDateISO(input.saleDate);
        const dts = saleIso ? daysToSale(saleIso) : null;
        if (dts != null && dts < 0) {
          pastDated++;
          continue;
        }

        const res = await this.foreclosures.createForeclosureLead(input, {
          organizationId: opts.organizationId,
        });
        if (res.created && res.leadId) {
          created++;
          this.enrichAsync(res.leadId, opts.organizationId);
        } else {
          skipped++;
        }
      } catch (e: any) {
        this.logger.warn(`RSS item ingest failed: ${e.message}`);
        errors++;
      }
    }

    this.logger.log(
      `Foreclosure RSS ingest: scanned ${items.length}, created ${created}, skipped ${skipped}, pastDated ${pastDated}`,
    );
    return { scanned: items.length, created, skipped, pastDated, errors };
  }

  /** Convert AI-extracted notice fields to a normalized lead input. */
  private extractedToInput(
    e: ExtractedNotice,
    meta: {
      sourceKind: ForeclosureSourceKind;
      noticeId?: string;
      noticeUrl?: string;
      rawSnippet?: string;
      caseNumber?: string;
    },
  ): ForeclosureLeadInput {
    const isHearing = (e.noticeType || '').includes('hearing');
    // For a hearing notice the actionable date is the hearing date; mirror it
    // into saleDate so it sorts and filters alongside true sale dates.
    const saleDate = e.saleDate || (isHearing ? e.hearingDate : '') || '';

    const priority = computePriority({
      noticeType: e.noticeType,
      ownerNames: e.ownerNames,
      loanDateIso: parseDateISO(e.loanDate) || null,
      city: e.city,
      county: e.county,
    });

    return {
      sourceKind: meta.sourceKind,
      noticeId: meta.noticeId,
      noticeUrl: meta.noticeUrl,
      rawSnippet: meta.rawSnippet,
      noticeType: e.noticeType,
      address: e.propertyAddress,
      city: e.city,
      state: e.state,
      zip: e.zip,
      ownerNames: e.ownerNames,
      caseNumber: meta.caseNumber || e.caseNumber,
      county: e.county,
      trustee: e.trustee,
      saleDate,
      hearingDate: e.hearingDate,
      loanDate: e.loanDate,
      loanAmount: e.loanAmount ?? null,
      priority,
    };
  }

  /** Meck Times notice id is the detail= number on the notice link. */
  private noticeIdFromLink(link: string): string {
    const m = String(link || '').match(/[?&]detail=(\d+)/);
    return m ? m[1] : '';
  }

  /** Fire-and-forget skip-trace enrich so ingestion stays fast. */
  private enrichAsync(leadId: string, organizationId?: string | null) {
    this.skiptrace
      .enrichLead(leadId, organizationId || undefined)
      .catch((e) => this.logger.warn(`Skip-trace enrich failed for ${leadId}: ${e.message}`));
  }
}

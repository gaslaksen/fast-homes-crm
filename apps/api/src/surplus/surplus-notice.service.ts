/**
 * Reads the Notice of Surplus Funds and pulls out the owner's own address.
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 *
 * The skip-trace target is the owner the clerk mailed the notice to, and that
 * address is usually NOT the property. Duval case 2025-0023TD sold a vacant lot
 * in Jacksonville and noticed Myrtis Griffin at 72 Smith Drive, Hartford, CT.
 * Tracing the property instead returned whoever lives on the parcel now, which
 * is why the first live skip-trace run came back six strangers out of six.
 *
 * The address only exists on the notice document, and Duval's notices are scans
 * with no text layer at all (verified: 0 characters across 2 pages, and 6 across
 * 3 on another). pdf-parse gets nothing. So the PDF goes to Claude as a document
 * block and is read by vision.
 *
 * ── What one read buys ──────────────────────────────────────────────────────
 *
 * The notice is a clean, fixed-layout form, and a single extraction yields four
 * things we could not otherwise get:
 *
 *   1. The owner's mailing address, which is the entire point.
 *   2. The real notice DATE. Until now noticeDate was estimated from the sale
 *      date with noticeConfirmed left false, because Duval publishes no filing
 *      dates. Myrtis Griffin's notice is dated 7/1/2025 against a 6/11/2025
 *      sale, so the estimate was 20 days early.
 *   3. The surplus as stated at notice ($8,752.78) against the $8,611.05 posted
 *      today. That is the number to say on a call.
 *   4. Certificate and tax deed numbers, for matching against other records.
 */

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Anthropic from '@anthropic-ai/sdk';
import axios from 'axios';
import sharp from 'sharp';
import { SurplusDocumentFile } from './surplus-source.types';

/** 32 MB is the API request cap; stay well under it after base64 inflation. */
const MAX_PDF_BYTES = 8 * 1024 * 1024;
/**
 * Pages read off a scanned image notice. Charlotte's run two per addressee
 * (the notice, then a blank Proof of Claim) and the largest seen is 14.
 */
const MAX_IMAGE_PAGES = 24;
/** The long edge the model reads at without downscaling. A 300 dpi letter page is 3300. */
const IMAGE_LONG_EDGE = 1568;

/** One addressee on the notice. The clerk prints one page per recipient. */
export interface NoticeRecipient {
  name: string | null;
  street: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  /** An attention line above the street ("C/O GLENN BROWN"), where the source separates one. */
  attention?: string | null;
}

export interface NoticeExtract {
  /**
   * EVERY addressee, one per page. A co-owned case gets one page per owner, and
   * they do not necessarily share an address: reading only the first and
   * applying it to the whole property gives one claimant the other's address,
   * and then skip traces them at it.
   */
  recipients: NoticeRecipient[];
  /** The first recipient, for callers that only need one. */
  recipient: string | null;
  street: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  /** ISO date the notice is dated, which starts the 120 day clock. */
  noticeDate: string | null;
  /** ISO date of sale as stated on the notice. */
  saleDate: string | null;
  /** The surplus the notice states, before later fees. */
  surplusAtNotice: number | null;
  certificateNumber: string | null;
  taxDeedNumber: string | null;
  realEstateNumber: string | null;
}

const PROMPT = `You are reading a Florida county "NOTICE OF SURPLUS FUNDS FROM TAX DEED SALE".

The clerk prints ONE PAGE PER RECIPIENT. A co-owned property has several pages,
each identical except for the addressee block near the top left. Read EVERY page
and return every addressee, even when two share an address.

Return a single JSON object, no prose, no code fence:

{
  "recipients": [
    { "name": "addressee name", "street": "...", "city": "...", "state": "XX", "zip": "12345" }
  ],
  "noticeDate": "the DATED value in the header, as YYYY-MM-DD",
  "saleDate": "the DATE OF SALE value, as YYYY-MM-DD",
  "surplusAtNotice": the surplus dollar amount stated in the body as a number with no symbols or commas,
  "certificateNumber": "the CERTIFICATE No value",
  "taxDeedNumber": "the TAX DEED No value",
  "realEstateNumber": "the REAL ESTATE No value"
}

Rules:
- One entry in "recipients" per PAGE that carries an addressee block, in page
  order. Do not merge two recipients and do not skip a repeat.
- The ADDRESSEE BLOCK is the owner being notified. Do NOT return the clerk's own
  address, which sits in the letterhead at the top of the page (W Adams St in
  Jacksonville, E Marion Ave in Punta Gorda, and so on). If a page shows only
  the clerk's address, omit it.
- Some counties enclose a blank PROOF OF CLAIM form after each notice. It has
  no addressee block; skip it.
- Some notices print no DATED value. Then use the date the clerk certifies the
  notice was mailed ("mailed ... on this 29th day of January, 2026").
- An addressee is frequently in a different city or state from the property, and
  co-owners are frequently at different addresses from each other. The same
  owner may be noticed at two addresses; return both. That is expected and is
  the reason we are reading this. Do not "correct" any of it.
- For an address outside the US, put the province or region in "state" and the
  postal code in "zip" exactly as printed.
- Use null for anything not printed. Never guess or infer a value.
- Return names exactly as printed, including ESTATE or suffixes.`;

@Injectable()
export class SurplusNoticeService {
  private readonly logger = new Logger(SurplusNoticeService.name);
  private readonly anthropic?: Anthropic;
  private readonly enabled: boolean;

  constructor(private config: ConfigService) {
    const key = this.config.get<string>('ANTHROPIC_API_KEY');
    if (key) this.anthropic = new Anthropic({ apiKey: key });
    // Default on: without the mailing address the ingested leads are not
    // callable, which is the state the first Duval batch shipped in.
    this.enabled =
      (this.config.get<string>('SURPLUS_NOTICE_EXTRACT_ENABLED') ?? 'true') !== 'false';
  }

  get available(): boolean {
    return this.enabled && !!this.anthropic;
  }

  /**
   * Fetch one notice document and read it.
   *
   * Returns null rather than throwing on anything recoverable, because a case
   * whose notice cannot be read is still a real lead: it just falls back to the
   * property address, flagged as such.
   */
  async readNotice(url: string): Promise<NoticeExtract | null> {
    if (!this.available) return null;

    let file: SurplusDocumentFile;
    try {
      const res = await axios.get(url, {
        responseType: 'arraybuffer',
        timeout: 30000,
        maxContentLength: MAX_PDF_BYTES,
        headers: { 'User-Agent': 'DealcoreSurplusBot/1.0 (+https://mydealcore.com)' },
      });
      file = { data: Buffer.from(res.data), contentType: String(res.headers['content-type'] || 'application/pdf') };
    } catch (e: any) {
      this.logger.warn(`Could not fetch notice ${url}: ${e.message}`);
      return null;
    }
    return this.readNoticeFile(file, url);
  }

  /**
   * Read a notice the adapter has already fetched. A PDF goes over as a
   * document; a scanned image (Charlotte's Group 4 TIFF, which the API does not
   * take) goes over as one PNG per page.
   */
  async readNoticeFile(file: SurplusDocumentFile, label: string): Promise<NoticeExtract | null> {
    if (!this.available) return null;

    const bytes = file.data;
    if (!bytes.length || bytes.length > MAX_PDF_BYTES) {
      this.logger.warn(`Notice ${label} is ${bytes.length} bytes, outside the readable range`);
      return null;
    }

    let content: any[];
    try {
      content = isPdf(file)
        ? [{ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: bytes.toString('base64') } }]
        : (await imagePages(bytes)).map((png) => ({
            type: 'image',
            source: { type: 'base64', media_type: 'image/png', data: png.toString('base64') },
          }));
    } catch (e: any) {
      this.logger.warn(`Notice ${label} (${file.contentType}) could not be prepared: ${e.message}`);
      return null;
    }
    if (!content.length) return null;

    try {
      const response = await this.anthropic!.messages.create({
        // Deliberately not the repo's usual claude-haiku-4-5 extraction model.
        // A misread street number here means calling a stranger about someone
        // else's money, and this runs once per case and never again, so the
        // accuracy is worth far more than the per-call cost.
        model: 'claude-opus-5',
        max_tokens: 2000,
        output_config: { effort: 'low' },
        messages: [
          {
            role: 'user',
            content: [...content, { type: 'text', text: PROMPT }],
          },
        ],
      } as any);

      const text = (response.content || [])
        .filter((b: any) => b.type === 'text')
        .map((b: any) => b.text)
        .join('\n');
      return this.parse(text);
    } catch (e: any) {
      this.logger.warn(`Notice extraction failed for ${label}: ${e.message}`);
      return null;
    }
  }

  /** Pull the JSON object out of the reply and normalise it. */
  parse(text: string): NoticeExtract | null {
    const raw = String(text || '');
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start < 0 || end <= start) return null;

    let o: any;
    try {
      o = JSON.parse(raw.slice(start, end + 1));
    } catch {
      return null;
    }

    const str = (v: any) => {
      const s = String(v ?? '').trim();
      return s && s.toLowerCase() !== 'null' ? s : null;
    };
    const num = (v: any) => {
      if (v == null) return null;
      const n = Number(String(v).replace(/[^0-9.-]/g, ''));
      return Number.isFinite(n) && n > 0 ? n : null;
    };
    const date = (v: any) => {
      const s = str(v);
      if (!s) return null;
      const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
      if (iso) return s;
      const us = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
      if (us) return `${us[3]}-${us[1].padStart(2, '0')}-${us[2].padStart(2, '0')}`;
      return null;
    };

    // Recipients, one per page, with the clerk's own letterhead rejected.
    const rawRecipients: any[] = Array.isArray(o.recipients)
      ? o.recipients
      : // Tolerate the older single-recipient shape so a cached or partial
        // reply still yields something rather than nothing.
        [{ name: o.recipient, street: o.street, city: o.city, state: o.state, zip: o.zip }];

    const recipients: NoticeRecipient[] = rawRecipients
      .map((r) => ({
        name: str(r?.name),
        street: str(r?.street),
        city: str(r?.city),
        state: str(r?.state)?.toUpperCase().slice(0, 2) || null,
        // Five digits or nothing. Stripping the letters out of a Canadian
        // postcode ("L4T 1M9") would leave "419", a ZIP that is not one.
        zip: /^\d{5}/.exec(str(r?.zip) || '')?.[0] || null,
      }))
      // The clerk's own block is the one wrong answer the layout invites: it is
      // a perfectly valid address, so a wrong read fails silently and would send
      // every lead to the courthouse.
      .filter((r) => !isClerkAddress(r.street, r.city))
      .filter((r) => r.name || r.street);

    const first = recipients[0];

    const out: NoticeExtract = {
      recipients,
      recipient: first?.name ?? null,
      street: first?.street ?? null,
      city: first?.city ?? null,
      state: first?.state ?? null,
      zip: first?.zip ?? null,
      noticeDate: date(o.noticeDate),
      saleDate: date(o.saleDate),
      surplusAtNotice: num(o.surplusAtNotice),
      certificateNumber: str(o.certificateNumber),
      taxDeedNumber: str(o.taxDeedNumber),
      realEstateNumber: str(o.realEstateNumber),
    };

    return out;
  }
}

/** A clerk's own address (Duval, Charlotte), which must never be read as the owner's. */
export function isClerkAddress(street?: string | null, city?: string | null): boolean {
  const s = String(street || '').toUpperCase();
  const c = String(city || '').toUpperCase();
  if (!s) return false;
  if (/\bW(EST)?\s+ADAMS\s+ST/.test(s) && (!c || c.includes('JACKSONVILLE'))) return true;
  return /^350\s+E(AST|\.)?\s+MARION\s+AVE/.test(s) && (!c || c.includes('PUNTA GORDA'));
}

function isPdf(file: SurplusDocumentFile): boolean {
  return /pdf/i.test(file.contentType) || file.data.subarray(0, 5).toString('latin1') === '%PDF-';
}

/** Every page of a scanned image as a PNG the model can read, capped. */
async function imagePages(bytes: Buffer): Promise<Buffer[]> {
  const meta = await sharp(bytes).metadata();
  const count = Math.min(meta.pages || 1, MAX_IMAGE_PAGES);
  const out: Buffer[] = [];
  for (let page = 0; page < count; page++) {
    out.push(
      await sharp(bytes, { page })
        .resize({ width: IMAGE_LONG_EDGE, height: IMAGE_LONG_EDGE, fit: 'inside', withoutEnlargement: true })
        .png()
        .toBuffer(),
    );
  }
  return out;
}

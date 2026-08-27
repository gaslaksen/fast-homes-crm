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

/** 32 MB is the API request cap; stay well under it after base64 inflation. */
const MAX_PDF_BYTES = 8 * 1024 * 1024;

export interface NoticeExtract {
  /** Name as addressed on the notice. */
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

Extract ONLY what is printed on the page. Return a single JSON object, no prose, no code fence:

{
  "recipient": "the name in the addressee block, near the top left, above the street address",
  "street": "addressee street line",
  "city": "addressee city",
  "state": "addressee two letter state",
  "zip": "addressee 5 digit ZIP",
  "noticeDate": "the DATED value in the header block, as YYYY-MM-DD",
  "saleDate": "the DATE OF SALE value, as YYYY-MM-DD",
  "surplusAtNotice": the surplus dollar amount stated in the body as a number with no symbols or commas,
  "certificateNumber": "the CERTIFICATE No value",
  "taxDeedNumber": "the TAX DEED No value",
  "realEstateNumber": "the REAL ESTATE No value"
}

Rules:
- The ADDRESSEE BLOCK is the owner being notified. Do NOT return the clerk's own
  address, which appears in the letterhead beside the county seal and is in
  Jacksonville on W Adams St. If the only address you can find is the clerk's,
  return null for the address fields.
- The addressee is frequently in a different city or state from the property.
  That is expected and is the reason we are reading this. Do not "correct" it.
- Use null for anything not printed on the page. Never guess or infer a value
  from another field.
- Return the addressee exactly as printed, including ESTATE or suffixes.`;

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

    let pdf: Buffer;
    try {
      const res = await axios.get(url, {
        responseType: 'arraybuffer',
        timeout: 30000,
        maxContentLength: MAX_PDF_BYTES,
        headers: { 'User-Agent': 'DealcoreSurplusBot/1.0 (+https://mydealcore.com)' },
      });
      pdf = Buffer.from(res.data);
    } catch (e: any) {
      this.logger.warn(`Could not fetch notice ${url}: ${e.message}`);
      return null;
    }

    if (!pdf.length || pdf.length > MAX_PDF_BYTES) {
      this.logger.warn(`Notice ${url} is ${pdf.length} bytes, outside the readable range`);
      return null;
    }

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
            content: [
              {
                type: 'document',
                source: {
                  type: 'base64',
                  media_type: 'application/pdf',
                  data: pdf.toString('base64'),
                },
              },
              { type: 'text', text: PROMPT },
            ],
          },
        ],
      } as any);

      const text = (response.content || [])
        .filter((b: any) => b.type === 'text')
        .map((b: any) => b.text)
        .join('\n');
      return this.parse(text);
    } catch (e: any) {
      this.logger.warn(`Notice extraction failed for ${url}: ${e.message}`);
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

    const out: NoticeExtract = {
      recipient: str(o.recipient),
      street: str(o.street),
      city: str(o.city),
      state: str(o.state)?.toUpperCase().slice(0, 2) || null,
      zip: str(o.zip)?.replace(/[^0-9]/g, '').slice(0, 5) || null,
      noticeDate: date(o.noticeDate),
      saleDate: date(o.saleDate),
      surplusAtNotice: num(o.surplusAtNotice),
      certificateNumber: str(o.certificateNumber),
      taxDeedNumber: str(o.taxDeedNumber),
      realEstateNumber: str(o.realEstateNumber),
    };

    // The clerk's own letterhead is the one wrong answer the layout invites,
    // since it sits at the top of the page in a larger block than the addressee.
    // Reject it here as well as in the prompt: a belt-and-braces check is cheap
    // and the failure is silent, because the address looks perfectly valid.
    if (isClerkAddress(out.street, out.city)) {
      out.recipient = null;
      out.street = null;
      out.city = null;
      out.state = null;
      out.zip = null;
    }

    return out;
  }
}

/** The Duval clerk's own address, which must never be read as the owner's. */
export function isClerkAddress(street?: string | null, city?: string | null): boolean {
  const s = String(street || '').toUpperCase();
  const c = String(city || '').toUpperCase();
  if (!s) return false;
  return /\bW(EST)?\s+ADAMS\s+ST/.test(s) && (!c || c.includes('JACKSONVILLE'));
}

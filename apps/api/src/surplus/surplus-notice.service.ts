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
 *
 * ── What it costs, and the three controls on it ─────────────────────────────
 *
 * Every read is a vision call on an Opus-class model, the biggest fixed Claude
 * spend on the surplus side. Three things keep it down (2026-11-01):
 *
 *   1. It runs late. A case that lands with no address is NOT read during the
 *      pull. The address is first needed when the case matures into the trace
 *      window at day 110, so the weekly pull reads the notices of cases whose
 *      estimated clock has reached SURPLUS_NOTICE_READ_DAY (default 95). A case
 *      the county pays out before then is never read at all. See
 *      SurplusIngestService.readMaturedNotices.
 *   2. It sends fewer pixels. Near-blank pages of a scanned TIFF (a duplex
 *      scan's empty backs) are dropped before upload. See dropBlankPages.
 *   3. It is metered. Every read is costed from the response's token usage and
 *      recorded in vendor_usage under vendor "notice", and an optional monthly
 *      budget pauses reads when the month cannot cover one more.
 */

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Anthropic from '@anthropic-ai/sdk';
import axios from 'axios';
import sharp from 'sharp';
import { PrismaService } from '../prisma/prisma.service';
import { SurplusDocumentFile } from './surplus-source.types';
import { normalizeMailing } from './surplus-address.util';

/** 32 MB is the API request cap; stay well under it after base64 inflation. */
const MAX_PDF_BYTES = 8 * 1024 * 1024;
/**
 * Pages read off a scanned image notice. Charlotte's run two per addressee
 * (the notice, then a blank Proof of Claim) and the largest seen is 14.
 */
export const MAX_IMAGE_PAGES = 24;
/** The long edge the model reads at without downscaling. A 300 dpi letter page is 3300. */
const IMAGE_LONG_EDGE = 1568;
/** The reply never needs more: a 14 page notice parses to well under 1,000 tokens. */
export const MAX_OUTPUT_TOKENS = 2000;
/**
 * What one page at IMAGE_LONG_EDGE costs in input tokens, rounded up. A
 * 1568 x 1213 image is about 2,540 tokens (pixels / 750); the worst-case read
 * is priced off this so the budget check errs on the side of stopping.
 */
const TOKENS_PER_IMAGE_PAGE = 2600;

/**
 * A page is near-blank when its greyscale mean is this light and its spread
 * this small. On a bilevel scan a page with 0.15 percent of its pixels inked
 * has a standard deviation of about 10, so this catches an empty back and a
 * scanner smudge and nothing with a printed line on it. A page the clerk
 * printed, even an empty Proof of Claim form, carries far more ink than that
 * and is kept: the prompt's one-page-per-recipient rule needs every printed
 * page, and a dropped printed page could be a recipient.
 */
export const BLANK_PAGE_MAX_STDEV = 10;
export const BLANK_PAGE_MIN_MEAN = 235;

/** The vendor name every notice read is metered under in vendor_usage. */
export const NOTICE_VENDOR = 'notice';
/** The model the notice is read with unless SURPLUS_NOTICE_MODEL says otherwise. */
export const DEFAULT_NOTICE_MODEL = 'claude-opus-5';
/**
 * Dollars per million tokens for DEFAULT_NOTICE_MODEL, as the Anthropic price
 * list had claude-opus-5 on 2026-11-01. These are DEFAULTS for the
 * SURPLUS_NOTICE_INPUT_PRICE and SURPLUS_NOTICE_OUTPUT_PRICE settings and must
 * be checked against the current price list whenever the model changes:
 * the meter is only as honest as these two numbers.
 */
export const DEFAULT_NOTICE_INPUT_PRICE = 5;
export const DEFAULT_NOTICE_OUTPUT_PRICE = 25;
/** The day of the estimated claim clock the weekly pull first reads a notice on. */
export const DEFAULT_NOTICE_READ_DAY = 95;

/** One addressee on the notice. The clerk prints one page per recipient. */
export interface NoticeRecipient {
  name: string | null;
  street: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  /** An attention line above the street ("C/O GLENN BROWN"), where the source separates one. */
  attention?: string | null;
  /** Null for a US address. See normalizeMailing. */
  country?: string | null;
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
  country?: string | null;
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

/** Token usage of one read, as the API reports it. Cache tokens count as input. */
export interface NoticeReadUsage {
  inputTokens: number;
  outputTokens: number;
}

/**
 * A content block the notice goes over as: a PDF document, or one PNG image
 * per page of a scan. Built by prepareNoticeContent and sent as is.
 */
export type NoticeContentBlock =
  | { type: 'document'; source: { type: 'base64'; media_type: 'application/pdf'; data: string } }
  | { type: 'image'; source: { type: 'base64'; media_type: 'image/png'; data: string } };

/**
 * The one call the reader makes. The service prepares the pages and parses the
 * reply; what sits between is this, so a second model or vendor can be tried
 * (scripts/compare-notice-reads.ts) without touching either side.
 */
export interface NoticeReaderClient {
  /** The model id this client reads with, for the log and the meter. */
  readonly model: string;
  /** Send the pages and the prompt; return the reply's text and what it cost in tokens. */
  read(content: NoticeContentBlock[], prompt: string): Promise<{ text: string; usage: NoticeReadUsage }>;
}

/** The Anthropic Messages API behind NoticeReaderClient. */
export class AnthropicNoticeReaderClient implements NoticeReaderClient {
  constructor(
    private readonly anthropic: Anthropic,
    readonly model: string,
  ) {}

  async read(content: NoticeContentBlock[], prompt: string): Promise<{ text: string; usage: NoticeReadUsage }> {
    const response: any = await this.anthropic.messages.create({
      // Deliberately not the repo's usual claude-haiku-4-5 extraction model.
      // A misread street number here means calling a stranger about someone
      // else's money, and this runs once per case and never again, so the
      // accuracy is worth far more than the per-call cost.
      model: this.model,
      max_tokens: MAX_OUTPUT_TOKENS,
      output_config: { effort: 'low' },
      messages: [
        {
          role: 'user',
          content: [...content, { type: 'text', text: prompt }],
        },
      ],
    } as any);
    const text = (response?.content || [])
      .filter((b: any) => b.type === 'text')
      .map((b: any) => b.text)
      .join('\n');
    return { text, usage: usageOf(response?.usage) };
  }
}

/** Token counts out of a Messages API reply. Cache writes and reads are billed as input here, which errs high. */
export function usageOf(u: any): NoticeReadUsage {
  return {
    inputTokens: (u?.input_tokens || 0) + (u?.cache_creation_input_tokens || 0) + (u?.cache_read_input_tokens || 0),
    outputTokens: u?.output_tokens || 0,
  };
}

/** Dollars for one read at the given per-million prices. */
export function noticeReadCost(usage: NoticeReadUsage, prices: { input: number; output: number }): number {
  return (usage.inputTokens * prices.input + usage.outputTokens * prices.output) / 1e6;
}

export const NOTICE_PROMPT = `You are reading a Florida county "NOTICE OF SURPLUS FUNDS FROM TAX DEED SALE".

The clerk prints ONE PAGE PER RECIPIENT. A co-owned property has several pages,
each identical except for the addressee block near the top left. Read EVERY page
and return every addressee, even when two share an address.

Return a single JSON object, no prose, no code fence:

{
  "recipients": [
    { "name": "addressee name", "street": "...", "city": "...", "state": "XX", "zip": "12345", "country": null }
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
- "country" is null for a US address, Puerto Rico included. For any other
  address it is the country as printed, in English ("CANADA", "FRANCE"), with
  the province or region in "state" and the postal code in "zip" exactly as
  printed. Never squeeze a foreign address into a US state code: ONTARIO is not
  CA, and a French postcode is not a ZIP. The city is the town, not the
  province.
- Use null for anything not printed. Never guess or infer a value.
- Return names exactly as printed, including ESTATE or suffixes.`;

/** Whether the month can pay for one more read, and if not, why. */
export interface NoticeSpendCheck {
  ok: boolean;
  reason?: string;
}

@Injectable()
export class SurplusNoticeService {
  private readonly logger = new Logger(SurplusNoticeService.name);
  private readonly client?: NoticeReaderClient;
  private readonly enabled: boolean;
  /** Read once at boot. SURPLUS_NOTICE_MODEL, default claude-opus-5. */
  readonly model: string;
  /** Dollars per million tokens, from SURPLUS_NOTICE_INPUT_PRICE and SURPLUS_NOTICE_OUTPUT_PRICE. */
  readonly prices: { input: number; output: number };
  /** Day of the estimated claim clock the pull first reads a notice on. SURPLUS_NOTICE_READ_DAY. */
  readonly readDay: number;
  /** Dollars per calendar month (New York time). 0 is no cap. SURPLUS_NOTICE_MONTHLY_BUDGET. */
  readonly monthlyBudget: number;

  constructor(
    private config: ConfigService,
    private prisma: PrismaService,
  ) {
    const key = this.config.get<string>('ANTHROPIC_API_KEY');
    this.model = this.config.get<string>('SURPLUS_NOTICE_MODEL') || DEFAULT_NOTICE_MODEL;
    if (key) this.client = new AnthropicNoticeReaderClient(new Anthropic({ apiKey: key }), this.model);
    // Default on: without the mailing address the ingested leads are not
    // callable, which is the state the first Duval batch shipped in.
    this.enabled =
      (this.config.get<string>('SURPLUS_NOTICE_EXTRACT_ENABLED') ?? 'true') !== 'false';
    this.prices = {
      input: positive(this.config.get<string>('SURPLUS_NOTICE_INPUT_PRICE'), DEFAULT_NOTICE_INPUT_PRICE),
      output: positive(this.config.get<string>('SURPLUS_NOTICE_OUTPUT_PRICE'), DEFAULT_NOTICE_OUTPUT_PRICE),
    };
    const day = Number(this.config.get<string>('SURPLUS_NOTICE_READ_DAY'));
    this.readDay = Number.isFinite(day) && day >= 0 ? day : DEFAULT_NOTICE_READ_DAY;
    this.monthlyBudget = positive(this.config.get<string>('SURPLUS_NOTICE_MONTHLY_BUDGET'), 0);
  }

  get available(): boolean {
    return this.enabled && !!this.client;
  }

  /**
   * The most one read can cost at the configured prices: every page the cap
   * allows, at full size, and the longest reply allowed. The budget check
   * refuses a read the month cannot cover at this price, so a month never ends
   * a few cents over.
   */
  get worstCaseRead(): number {
    return noticeReadCost(
      { inputTokens: MAX_IMAGE_PAGES * TOKENS_PER_IMAGE_PAGE, outputTokens: MAX_OUTPUT_TOKENS },
      this.prices,
    );
  }

  /** The month to date, in the shape the obituary and social searches report. */
  async usage(): Promise<{ period: string; checks: number; spent: number; budget: number; paused: boolean; left: number | null }> {
    const period = monthNY();
    const row = await this.prisma.vendorUsage.findUnique({ where: { vendor_period: { vendor: NOTICE_VENDOR, period } } });
    const spent = Math.round((row?.spend || 0) * 100) / 100;
    const budget = this.monthlyBudget;
    const paused = !this.available || (budget > 0 && spent + this.worstCaseRead > budget);
    return {
      period,
      checks: row?.calls || 0,
      spent,
      budget,
      paused,
      left: budget ? Math.max(0, Math.round((budget - spent) * 100) / 100) : null,
    };
  }

  /**
   * Whether one more read may be bought right now. Unset or zero budget means
   * no cap, which is how the reader always behaved; a set budget stops reads
   * once the month cannot cover a worst-case read. The pull writes the reason
   * on its run so a quiet week reads as paused, not broken.
   */
  async canSpend(): Promise<NoticeSpendCheck> {
    if (!this.available) {
      return { ok: false, reason: this.client ? 'the notice reader is off (SURPLUS_NOTICE_EXTRACT_ENABLED)' : 'ANTHROPIC_API_KEY is not set' };
    }
    if (!this.monthlyBudget) return { ok: true };
    const u = await this.usage();
    if (u.spent + this.worstCaseRead > u.budget) {
      return {
        ok: false,
        reason: `notice reads paused, $${u.spent} of the $${u.budget} SURPLUS_NOTICE_MONTHLY_BUDGET spent in ${u.period}`,
      };
    }
    return { ok: true };
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
   * take) goes over as one PNG per page, less the near-blank ones.
   */
  async readNoticeFile(file: SurplusDocumentFile, label: string): Promise<NoticeExtract | null> {
    if (!this.available) return null;

    let content: NoticeContentBlock[];
    try {
      content = await prepareNoticeContent(file, (line) => this.logger.log(`Notice ${label}: ${line}`));
    } catch (e: any) {
      this.logger.warn(`Notice ${label} (${file.contentType}) could not be prepared: ${e.message}`);
      return null;
    }
    if (!content.length) return null;

    // The budget gate sits after preparation and before the call: nothing has
    // been billed yet, and null here means "try again next week", which is
    // right for a month that is out of money.
    const spend = await this.canSpend();
    if (!spend.ok) {
      this.logger.warn(`Notice ${label} not read: ${spend.reason}`);
      return null;
    }

    try {
      const { text, usage } = await this.client!.read(content, NOTICE_PROMPT);
      await this.record(usage);
      const extract = this.parse(text);
      if (extract) return extract;
      // The call was made and billed, so this counts as a read: an empty
      // extract rather than null, or the weekly poll pays for the same
      // unreadable reply every Monday. Null is kept for the failures that
      // cost nothing and are worth trying again.
      this.logger.warn(`Notice ${label} came back with no readable JSON`);
      return emptyExtract();
    } catch (e: any) {
      this.logger.warn(`Notice extraction failed for ${label}: ${e.message}`);
      return null;
    }
  }

  /** One read on the month's meter: a call, and its dollars at the configured prices. */
  private async record(usage: NoticeReadUsage): Promise<void> {
    const cost = noticeReadCost(usage, this.prices);
    const period = monthNY();
    await this.prisma.vendorUsage
      .upsert({
        where: { vendor_period: { vendor: NOTICE_VENDOR, period } },
        create: { vendor: NOTICE_VENDOR, period, calls: 1, spend: cost },
        update: { calls: { increment: 1 }, spend: { increment: cost } },
      })
      .catch((e: any) => this.logger.warn(`Could not record notice read spend: ${e?.message || e}`));
  }

  /** Pull the JSON object out of the reply and normalise it. */
  parse(text: string): NoticeExtract | null {
    return parseNoticeReply(text);
  }
}

/**
 * The reply, parsed and normalised. A module function rather than a method so
 * the comparison script can parse two models' replies without a service.
 */
export function parseNoticeReply(text: string): NoticeExtract | null {
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
      [{ name: o.recipient, street: o.street, city: o.city, state: o.state, zip: o.zip, country: o.country }];

  const recipients: NoticeRecipient[] = rawRecipients
    .map((r) => ({ name: str(r?.name), ...normalizeMailing(r || {}) }))
    // The clerk's own block is the one wrong answer the layout invites: it is
    // a perfectly valid address, so a wrong read fails silently and would send
    // every lead to the courthouse.
    .filter((r) => !isClerkAddress(r.street, r.city))
    .filter((r) => r.name || r.street);

  const first = recipients[0];

  return {
    recipients,
    recipient: first?.name ?? null,
    street: first?.street ?? null,
    city: first?.city ?? null,
    state: first?.state ?? null,
    zip: first?.zip ?? null,
    country: first?.country ?? null,
    noticeDate: date(o.noticeDate),
    saleDate: date(o.saleDate),
    surplusAtNotice: num(o.surplusAtNotice),
    certificateNumber: str(o.certificateNumber),
    taxDeedNumber: str(o.taxDeedNumber),
    realEstateNumber: str(o.realEstateNumber),
  };
}

/** A clerk's own address (Duval, Charlotte), which must never be read as the owner's. */
export function isClerkAddress(street?: string | null, city?: string | null): boolean {
  const s = String(street || '').toUpperCase();
  const c = String(city || '').toUpperCase();
  if (!s) return false;
  if (/\bW(EST)?\s+ADAMS\s+ST/.test(s) && (!c || c.includes('JACKSONVILLE'))) return true;
  return /^350\s+E(AST|\.)?\s+MARION\s+AVE/.test(s) && (!c || c.includes('PUNTA GORDA'));
}

/** A read that was paid for and named nobody. */
function emptyExtract(): NoticeExtract {
  return {
    recipients: [],
    recipient: null,
    street: null,
    city: null,
    state: null,
    zip: null,
    country: null,
    noticeDate: null,
    saleDate: null,
    surplusAtNotice: null,
    certificateNumber: null,
    taxDeedNumber: null,
    realEstateNumber: null,
  };
}

/** A number setting that must be positive, else the default. */
function positive(raw: string | undefined, fallback: number): number {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/** "2026-09", in the business's own time zone. The budget month. */
export function monthNY(d = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit' }).formatToParts(d);
  return `${parts.find((p) => p.type === 'year')?.value}-${parts.find((p) => p.type === 'month')?.value}`;
}

export function isPdf(file: SurplusDocumentFile): boolean {
  return /pdf/i.test(file.contentType) || file.data.subarray(0, 5).toString('latin1') === '%PDF-';
}

/**
 * The content blocks one notice goes over as. Shared by the service and the
 * comparison script so both send exactly the same pixels. Throws when the file
 * is outside the readable range or cannot be rendered; `log` gets one line
 * when blank pages are dropped.
 */
export async function prepareNoticeContent(
  file: SurplusDocumentFile,
  log: (line: string) => void = () => undefined,
): Promise<NoticeContentBlock[]> {
  const bytes = file.data;
  if (!bytes.length || bytes.length > MAX_PDF_BYTES) {
    throw new Error(`${bytes.length} bytes, outside the readable range`);
  }
  if (isPdf(file)) {
    return [{ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: bytes.toString('base64') } }];
  }
  const pages = await imagePages(bytes);
  const { kept, dropped } = await dropBlankPages(pages);
  if (dropped) log(`dropped ${dropped} near-blank page${dropped === 1 ? '' : 's'} of ${pages.length} before upload`);
  return kept.map((png) => ({
    type: 'image',
    source: { type: 'base64', media_type: 'image/png', data: png.toString('base64') },
  }));
}

/** Every page of a scanned image as a PNG the model can read, capped. */
export async function imagePages(bytes: Buffer): Promise<Buffer[]> {
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

/** Whether a rendered page is near-blank, by its greyscale statistics. */
export async function isNearBlank(png: Buffer): Promise<boolean> {
  const stats = await sharp(png).greyscale().stats();
  const ch = stats.channels[0];
  if (!ch) return false;
  return ch.mean >= BLANK_PAGE_MIN_MEAN && ch.stdev <= BLANK_PAGE_MAX_STDEV;
}

/**
 * The pages worth sending, in their original order. A near-blank page carries
 * no addressee, so dropping it removes no recipient and the prompt's
 * one-page-per-recipient rule still holds over what is sent. At least one
 * page is always kept, so an all-blank scan still produces a billed read that
 * names nobody and is not bought again.
 */
export async function dropBlankPages(pages: Buffer[]): Promise<{ kept: Buffer[]; dropped: number }> {
  const kept: Buffer[] = [];
  for (const page of pages) {
    if (!(await isNearBlank(page))) kept.push(page);
  }
  if (!kept.length && pages.length) kept.push(pages[0]);
  return { kept, dropped: pages.length - kept.length };
}

/**
 * RealTDM tax deed surplus, one adapter instance per county subdomain.
 *
 * RealTDM is Realauction's tax deed case system and it fronts seven Florida
 * counties that publish a Surplus Balance column: Alachua, Brevard, Lee,
 * Pinellas, Polk, Sarasota and Lake. Lee is first because it is the largest
 * (231 sold cases and $3.98M of surplus in the spec window) and the cleanest:
 * its claim documents carry the claimant's name in the title, so who filed is
 * read rather than inferred.
 *
 * ── Access, and why the User-Agent looks the way it does ────────────────────
 *
 * Every `*.realtdm.com` host sits behind an AWS load balancer that answers 403
 * to any request whose User-Agent does not begin with `Mozilla/5.0`. The plain
 * `DealcoreSurplusBot/1.0` string the Duval adapter sends is refused, and so is
 * axios's default. `Mozilla/5.0 (compatible; DealcoreSurplusBot/1.0; +url)` is
 * accepted. That is the standard crawler form, the same shape Googlebot and
 * bingbot use, it names us, and it gives the clerk an address to complain to.
 * It is not browser impersonation. Do not "upgrade" it to a Chrome string.
 *
 * The poll is WEEKLY rather than nightly and detail fetches are paced, because
 * a docket does not change by the hour and the site's robots.txt asks not to be
 * crawled. Decision taken 2026-09-03 with the alternatives on the table (the
 * Lee Clerk's own weekly PDF has no docket and no mailing addresses, and those
 * two are the point).
 *
 * ── Shape of the source ─────────────────────────────────────────────────────
 *
 * Everything is a form-encoded POST that returns an HTML fragment.
 *
 *   /public/cases/list              paged case list, "Page 1 of N" in the body
 *   /public/cases/dspCaseSummary    address, sale date, homestead, legal
 *   /public/cases/dspCaseParties    every party of record with a mailing address
 *   /public/cases/dspCaseDocuments  the docket, 20 per page, NEWEST FIRST on Lee
 *   /public/cases/dspNotifications  control=SURPLUS_LETTER: who the clerk
 *                                   actually mailed the surplus letter to
 *   /public/cases/getDocumentLink   a pre-signed S3 URL that expires within
 *                                   the hour, so it is minted on click and
 *                                   never stored
 *
 * The status filter is deliberately NOT sent. The site remembers it in the
 * session and sending it again toggles it OFF, which silently widens a search
 * (600 rows where 233 was right). Rows are filtered on the Status text here.
 *
 * An unknown subdomain serves a demo site titled `realTDM : TEST`, so the page
 * title is checked before an empty result is believed.
 */

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance } from 'axios';
import pdfParse from 'pdf-parse';
import {
  FetchCaseOptions,
  SurplusSourceAdapter,
  SurplusCaseSummary,
  SurplusCaseDetail,
  SurplusCaseDocument,
  SurplusCaseParty,
  SurplusNoticeRecipient,
} from './surplus-source.types';

export interface RealTdmCountySpec {
  /** Written to SurplusDetail.sourceSystem, eg 'realtdm_lee'. */
  key: string;
  /** Matches FL_COUNTIES. */
  county: string;
  /** The `<subdomain>.realtdm.com` host. */
  subdomain: string;
}

export const REALTDM_USER_AGENT =
  'Mozilla/5.0 (compatible; DealcoreSurplusBot/1.0; +https://mydealcore.com; contact deals@quickcashhomebuyers.com)';

const PAGE_SIZE = 100;
/**
 * Pause between cases. Weekly cadence and a tiered refresh, so there is no
 * hurry: a held case is one probe request, and 300 of them at this pace is
 * under ten minutes.
 */
const DETAIL_DELAY_MS = 1500;
/** How far back the sale-date window reaches. Lee escheats after one to two years. */
const DEFAULT_LOOKBACK_MONTHS = 18;
/** Only these still hold money. COMPLETED - SOLD BIDDER has been paid out. */
const LIVE_STATUS = /^ACTIVE\s*-\s*SOLD\s*BIDDER$/i;
/** The clerk has disbursed and closed the case. Retire from the list alone. */
const PAID_OUT_STATUS = /^COMPLETED\s*-\s*SOLD\s*BIDDER$/i;
/** The list's column order, asserted on every run rather than assumed. */
const LIST_COLUMNS = [
  'Case Number',
  'Date Created',
  'App Number',
  'Parcel Number',
  'Sale Date',
  'Surplus Balance',
] as const;

/**
 * Party roles that mean owner of record. Every county labels these
 * differently: Lee says OWNER, Pinellas TITLEHOLDER and LEGAL TITLE HOLDER,
 * Brevard OWNER beside TITLE HOLDER AGENT (an agent, not an owner). A role
 * filter carried across counties caught 15 of 393 owner records once.
 */
export const OWNER_ROLES = /^(OWNER|TITLE\s*HOLDER|TITLEHOLDER|LEGAL\s*TITLE\s*HOLDER)$/i;

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

export function decode(s: string): string {
  return String(s || '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

/** Visible text of a fragment: tags gone, entities decoded, whitespace collapsed. */
export function text(html: string): string {
  return decode(String(html || '').replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

/** `<br>` and block boundaries become lines; each line is cleaned separately. */
export function lines(html: string): string[] {
  return String(html || '')
    .split(/<br\s*\/?>|<\/?div[^>]*>|<\/?p[^>]*>|\n/i)
    .map((l) => text(l))
    .filter(Boolean);
}

/**
 * RealTDM prints dates as "September 9, 2025" on detail pages and
 * "Sep 9, 2025" on the list. Both land here. Returns ISO, or null rather than
 * an epoch: a 1970 notice date would sort to the top as the most overdue lead.
 */
export function realTdmDate(v?: string | null): string | null {
  const s = String(v || '').trim();
  const m = /^([A-Za-z]{3})[A-Za-z]*\.?\s+(\d{1,2}),?\s+(\d{4})/.exec(s);
  if (m) {
    const mm = MONTHS[m[1].toLowerCase()];
    if (!mm) return null;
    return `${m[3]}-${String(mm).padStart(2, '0')}-${m[2].padStart(2, '0')}`;
  }
  const n = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(s);
  if (n) return `${n[3]}-${n[1].padStart(2, '0')}-${n[2].padStart(2, '0')}`;
  return null;
}

export function money(v?: string | null): number | null {
  if (v == null) return null;
  const n = Number(String(v).replace(/[^0-9.-]/g, ''));
  return Number.isFinite(n) ? n : null;
}

/** The MM/DD/YYYY the search form's date pickers submit. */
export function formDate(d: Date): string {
  return `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}/${d.getFullYear()}`;
}

/** A line that can be a deliverable street: starts with a number, or is a box. */
const STREET_LINE = /^\d|^p\.?\s*o\.?\s*box\b|^po\s*box\b/i;

/**
 * "BAY SHORE, NY 11706" and the street lines above it into parts.
 *
 * When the clerk prints an attention line above the street ("C/O GLENN BROWN",
 * "EDWARD H POTTER, TRUSTEE") it is returned separately. Folded into the
 * street it left "C/O GLENN BROWN, 4 BEE RIDGE CT", which no house-number
 * check accepts and no address match resolves. A foreign address, whose last
 * line is not CITY, ST 12345, stays whole with no state or zip: splitting it
 * by US rules yields a state that does not exist and a zip that matches a
 * stranger.
 */
export function splitAddressLines(addr: string[]): {
  street: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  attention: string | null;
} {
  const none = { street: null, city: null, state: null, zip: null, attention: null };
  const ls = (addr || []).map((l) => l.trim()).filter(Boolean);
  if (!ls.length) return none;
  const last = ls[ls.length - 1];
  const m = /^(.*?),?\s+([A-Z]{2})\s+(\d{5})(?:-\d{4})?$/i.exec(last);
  if (!m) return { ...none, street: ls.join(', ') };

  const above = ls.slice(0, -1);
  const streetIdx = above.findIndex((l) => STREET_LINE.test(l));
  // No numbered line at all: keep everything as the street rather than guess.
  const street = streetIdx < 0 ? above.join(', ') : above.slice(streetIdx).join(', ');
  const attention = streetIdx > 0 ? above.slice(0, streetIdx).join(', ') : null;
  return {
    street: street || null,
    city: m[1].trim() || null,
    state: m[2].toUpperCase(),
    zip: m[3],
    attention: attention || null,
  };
}

// ─── The list ───────────────────────────────────────────────────────────────

export interface ListPage {
  title: string;
  rows: SurplusCaseSummary[];
  totalPages: number;
}

/**
 * One page of `/public/cases/list`. The fragment carries the same rows twice,
 * as a desktop table and as mobile cards; the table is read because its cells
 * are positional and its header can be asserted.
 */
export function parseListPage(html: string): ListPage {
  const h = String(html || '');
  const title = text((/<title>([\s\S]*?)<\/title>/i.exec(h) || [])[1] || '');

  const headers = [...h.matchAll(/<th[^>]*>([\s\S]*?)<\/th>/gi)]
    .map((m) => text(m[1]))
    .filter(Boolean);
  if (headers.length) {
    const seen = headers.filter((x) => (LIST_COLUMNS as readonly string[]).includes(x));
    const ok = seen.length === LIST_COLUMNS.length && LIST_COLUMNS.every((c, i) => seen[i] === c);
    if (!ok) {
      throw new Error(
        `RealTDM list column order changed: expected ${LIST_COLUMNS.join(',')} but page declares ${headers.join(',')}`,
      );
    }
  }

  const rows: SurplusCaseSummary[] = [];
  const rowRe = /<tr[^>]*\bload-case\b[^>]*data-caseid="(\d+)"[^>]*>([\s\S]*?)<\/tr>/gi;
  for (let m = rowRe.exec(h); m; m = rowRe.exec(h)) {
    const cells = [...m[2].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((c) => text(c[1]));
    if (cells.length < 7) continue;
    const [status, caseNumber, , , parcelId, saleDate, surplus] = cells;
    if (!caseNumber) continue;
    rows.push({
      sourceCaseId: m[1],
      caseNumber,
      parcelId: parcelId || null,
      saleDate: realTdmDate(saleDate),
      status: status || null,
      surplus: money(surplus),
      owners: [],
    });
  }

  const pages = /Page\s+\d+\s+of\s+(\d+)/i.exec(text(h));
  return { title, rows, totalPages: pages ? Number(pages[1]) || 1 : 1 };
}

/**
 * An unknown subdomain does not 404, it serves a demo titled
 * `realTDM : TEST`. A zero result from that looks exactly like an empty
 * county, so the title is checked first.
 */
export function assertCountySite(title: string, county: string): void {
  if (!new RegExp(`realTDM\\s*:\\s*${county}\\b`, 'i').test(title)) {
    throw new Error(`RealTDM page title "${title}" is not the ${county} site; refusing to trust its results`);
  }
}

// ─── Case summary ───────────────────────────────────────────────────────────

export interface CaseSummaryFields {
  saleDate: string | null;
  appReceiveDate: string | null;
  street: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  homestead: boolean | null;
  legalDescription: string | null;
}

/** The lines of one labelled `data-row` on a detail fragment. */
export function dataRow(html: string, label: string): string[] {
  const re = new RegExp(
    `<div class="data-label[^"]*">\\s*${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*</div>\\s*<div class="data-value[^"]*">([\\s\\S]*?)</div>`,
    'i',
  );
  const m = re.exec(String(html || ''));
  return m ? lines(m[1]) : [];
}

export function parseSummary(html: string): CaseSummaryFields {
  const h = String(html || '');
  // A case with no address renders "No Address" over a bare ", FL". Neither
  // line is an address, and keeping the second would file the lead at ", FL".
  const addr = splitAddressLines(
    dataRow(h, 'Property Address').filter((l) => !/^no address$/i.test(l) && !/^[\s,]*(?:[A-Z]{2})?[\s,]*$/i.test(l)),
  );
  const homestead = (dataRow(h, 'Homestead')[0] || '').toLowerCase();
  const legal = text((/<div class="p-3 text-large">([\s\S]*?)<\/div>/i.exec(h) || [])[1] || '');
  return {
    saleDate: realTdmDate(dataRow(h, 'Sale Date')[0]),
    appReceiveDate: realTdmDate(dataRow(h, 'App Receive Date')[0]),
    street: addr.street,
    city: addr.city,
    state: addr.state,
    zip: addr.zip,
    homestead: homestead ? /^(yes|true)$/.test(homestead) : null,
    legalDescription: legal && !/^not entered$/i.test(legal) ? legal : null,
  };
}

// ─── Parties ────────────────────────────────────────────────────────────────

/**
 * Every party of record from the desktop table: name and role in the first
 * cell, mailing address in the second, country in the third. The mobile cards
 * that follow repeat the same people and are not read.
 */
export function parseParties(html: string): SurplusCaseParty[] {
  const out: SurplusCaseParty[] = [];
  const seen = new Set<string>();
  const re =
    /<span class="text-black">([\s\S]*?)<\/span>\s*<div class="text-dark[^"]*">([\s\S]*?)<\/div>[\s\S]*?<td class="text-end">([\s\S]*?)<\/td>\s*<td class="text-end">([\s\S]*?)<\/td>/gi;
  const h = String(html || '');
  for (let m = re.exec(h); m; m = re.exec(h)) {
    const name = text(m[1]);
    const role = text(m[2]).toUpperCase();
    if (!name) continue;
    const addr = splitAddressLines(lines(m[3]));
    const key = `${name}|${role}|${addr.street || ''}|${addr.zip || ''}`.toUpperCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ name, role, ...addr, country: text(m[4]) || null });
  }
  return out;
}

// ─── Documents ──────────────────────────────────────────────────────────────

/**
 * The claimant, when the county wrote it into the title. Lee files claims as
 * `Surplus Claim_Kevin Saturno`; a clerk occasionally types the filename in as
 * the label instead (`2025000500 Surplus Claim_Ashley Berger.pdf`), so the
 * case number prefix and the extension are both tolerated. Anything else
 * returns null rather than a guess.
 */
export function claimantFromTitle(title: string): string | null {
  const m = /surplus\s*claim[_\s-]+([\s\S]+?)(?:\.pdf)?\s*$/i.exec(String(title || '').trim());
  if (!m) return null;
  const name = m[1].replace(/^\d{6,}\s+/, '').replace(/\s+/g, ' ').trim();
  return name || null;
}

export interface DocumentsPage {
  docs: SurplusCaseDocument[];
  totalPages: number;
}

/**
 * One page of the docket, read from the mobile cards because each card carries
 * the label, the upload date and the View button's document id together. The
 * label is the classification key: "Returned Mail", "Sheriff's Service",
 * "SURPLUS_LETTER", "Surplus Claim_<name>". The filename is noise.
 */
export function parseDocumentsPage(html: string): DocumentsPage {
  const h = String(html || '');
  const docs: SurplusCaseDocument[] = [];
  const cards = h.split(/<div class="content-box p-4 mb-1">/i).slice(1);
  for (const card of cards) {
    const label = text((/fa-file[^>]*><\/i>\s*([\s\S]*?)<\/div>/i.exec(card) || [])[1] || '');
    const docId = (/data-documentid="(\d+)"/i.exec(card) || [])[1] || null;
    const docType = (/data-doctype="([^"]+)"/i.exec(card) || [])[1] || null;
    const filedAt = realTdmDate(dataRow(card, 'Upload Date')[0]);
    const fileName = dataRow(card, 'Filename')[0] || null;
    const title = label || fileName || '';
    if (!title) continue;
    docs.push({
      title,
      docId,
      url: null,
      claimant: claimantFromTitle(title),
      filedAt,
      fileName,
      docType,
    });
  }
  const pages = /Page\s+\d+\s+of\s+(\d+)/i.exec(text(h));
  return { docs, totalPages: pages ? Number(pages[1]) || 1 : 1 };
}

/**
 * The docket in FILING ORDER, oldest first. Lee serves newest first, and both
 * the classifier's "last notice is the operative one" rule and the board's
 * ledger read oldest to newest. Documents filed the same day keep the county's
 * own relative order, reversed, so a claim still precedes its receipt.
 */
export function inFilingOrder(docs: SurplusCaseDocument[]): SurplusCaseDocument[] {
  return docs
    .map((d, i) => ({ d, i }))
    .sort((a, b) => (a.d.filedAt || '').localeCompare(b.d.filedAt || '') || b.i - a.i)
    .map((x) => x.d);
}

// ─── Notifications ──────────────────────────────────────────────────────────

/**
 * Who the clerk actually mailed a letter to, from the mobile cards of
 * `dspNotifications`. This is the skip-trace target list: it is the clerk's own
 * record of the address of record, which on a surplus file is usually not the
 * property. Empty when the county has not generated that letter.
 */
export function parseNotifications(html: string): SurplusNoticeRecipient[] {
  const h = String(html || '');
  const out: SurplusNoticeRecipient[] = [];
  const cards = h.split(/<div class="content-box h-100 p-4">/i).slice(1);
  for (const card of cards) {
    const name = text((/<div class="fs-5">[\s\S]*?<\/i>\s*([\s\S]*?)<\/div>/i.exec(card) || [])[1] || '');
    if (!name) continue;
    const role = (dataRow(card, 'Party Type')[0] || '').toUpperCase() || null;
    const addrMatch = /Address<\/div>\s*<div class="data-value[^"]*">([\s\S]*?)<\/div>\s*<\/div>/i.exec(card);
    const addr = splitAddressLines(lines(addrMatch ? addrMatch[1] : ''));
    const delivery = dataRow(card, 'Delivery Type')[0] || null;
    out.push({ name, role, ...addr, delivery });
  }
  return out;
}

// ─── The surplus letter ─────────────────────────────────────────────────────

/**
 * The surplus as the clerk stated it in the mailed letter. Differs from the
 * balance the list posts today, which erodes as fees come off: Lee 2025001841
 * was noticed at $180,791.34 and listed at $177,867.97. The letter figure is
 * what the claimant was told they are owed and is the number to say on a call.
 */
export function surplusFromLetter(letterText: string): number | null {
  const m = /surplus\s+of\s+approximately\s*\$?\s*([\d,]+(?:\.\d{2})?)/i.exec(String(letterText || ''));
  return m ? money(m[1]) : null;
}

/**
 * The certificate number the letter cites, eg "23-04107". pdf-parse runs the
 * value straight into the next label ("23-04107Certificate Year"), so the
 * match stops at the digits-hyphen-digits shape rather than at whitespace.
 */
export function certificateFromLetter(letterText: string): string | null {
  const m = /Certificate\s+Number\s*:\s*(\d+-\d+)/i.exec(String(letterText || ''));
  return m ? m[1] : null;
}

// ─── The adapter ────────────────────────────────────────────────────────────

export class RealTdmAdapter implements SurplusSourceAdapter {
  readonly key: string;
  readonly county: string;
  readonly cadence = 'weekly' as const;
  readonly detailDelayMs = DETAIL_DELAY_MS;
  /**
   * Lee files a "Receipt" only when a claim's fee is paid: 68 of 68 sat on
   * claimed cases in the spec pull, none on an unclaimed one. Verify this on
   * every further county before reusing the spec; Duval's receipts are the
   * bidder's and sit on open cases.
   */
  readonly receiptsImplyClaim = true;
  readonly baseUrl: string;

  private readonly logger: Logger;
  private readonly lookbackMonths: number;
  /**
   * The list rows from the most recent listing, by case id. The detail
   * fragments never repeat the case number or parcel, so fetchCase needs the
   * row it came from. Refilled by listSurplusCases on every run.
   */
  private listed = new Map<string, SurplusCaseSummary>();

  constructor(
    protected config: ConfigService,
    private spec: RealTdmCountySpec,
  ) {
    this.key = spec.key;
    this.county = spec.county;
    this.logger = new Logger(`RealTdmAdapter:${spec.county}`);
    this.baseUrl = (
      this.config.get<string>(`REALTDM_${spec.subdomain.toUpperCase()}_BASE_URL`) ||
      `https://${spec.subdomain}.realtdm.com`
    ).replace(/\/+$/, '');
    const months = Number(this.config.get<string>('REALTDM_LOOKBACK_MONTHS'));
    this.lookbackMonths = Number.isFinite(months) && months > 0 ? months : DEFAULT_LOOKBACK_MONTHS;
  }

  /**
   * A client with its own cookie jar. The load balancer sets a sticky cookie
   * and the ColdFusion app a session; a list page and its detail fetches must
   * share both or the paging drifts.
   */
  private client(): AxiosInstance {
    const jar: string[] = [];
    const http = axios.create({
      baseURL: this.baseUrl,
      timeout: 60000,
      maxRedirects: 3,
      headers: {
        'User-Agent': REALTDM_USER_AGENT,
        Accept: 'text/html,application/json;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      validateStatus: (s) => s < 400,
    });
    http.interceptors.response.use((res) => {
      const set = res.headers['set-cookie'];
      if (Array.isArray(set)) for (const c of set) jar.push(c.split(';')[0]);
      return res;
    });
    http.interceptors.request.use((cfg) => {
      if (jar.length) cfg.headers.Cookie = jar.join('; ');
      return cfg;
    });
    return http;
  }

  private async post(http: AxiosInstance, path: string, form: Record<string, string>): Promise<string> {
    const res = await http.post(`/public/cases/${path}`, new URLSearchParams(form).toString(), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });
    return typeof res.data === 'string' ? res.data : JSON.stringify(res.data ?? '');
  }

  async listSurplusCases(): Promise<SurplusCaseSummary[]> {
    try {
      return await this.fetchList(this.client());
    } catch (e: any) {
      this.logger.warn(`${this.county} list failed (${e.message}), retrying once`);
      await new Promise((r) => setTimeout(r, 5000));
      return this.fetchList(this.client());
    }
  }

  /** The sale-date window: today back `lookbackMonths`. */
  private window(): { start: string; stop: string } {
    const stop = new Date();
    const start = new Date(stop);
    start.setMonth(start.getMonth() - this.lookbackMonths);
    return { start: formDate(start), stop: formDate(stop) };
  }

  private async fetchList(http: AxiosInstance): Promise<SurplusCaseSummary[]> {
    const { start, stop } = this.window();
    const out: SurplusCaseSummary[] = [];
    let page = 1;
    let totalPages = 1;
    do {
      const html = await this.post(http, 'list', {
        filterPageNumber: String(page),
        filterFiltered: '1',
        sectionRouteCode: '',
        isPublic: '1',
        // Deliberately empty. See the header comment: sending it toggles it.
        filtercasestatus: '',
        filterPartyName: '',
        filterCaseNumber: '',
        filterParcelNumber: '',
        filterAppNumber: '',
        filterCertNumber: '',
        filterPropAddress: '',
        filterSaleDateStart: start,
        filterSaleDateStop: stop,
        filterBalanceType: '',
        filterCasesPerPage: String(PAGE_SIZE),
      });
      const parsed = parseListPage(html);
      if (page === 1) assertCountySite(parsed.title, this.county);
      totalPages = parsed.totalPages;
      out.push(...parsed.rows);
      page += 1;
      if (page <= totalPages) await new Promise((r) => setTimeout(r, 300));
    } while (page <= totalPages);

    this.listed = new Map(out.map((r) => [r.sourceCaseId, r]));
    this.logger.log(`${this.county}: ${out.length} cases listed for sales ${start} to ${stop}`);
    return out;
  }

  isLive(summary: SurplusCaseSummary): boolean {
    return LIVE_STATUS.test(summary.status || '');
  }

  /** COMPLETED - SOLD BIDDER: the clerk has disbursed and closed the case. */
  isPaidOut(summary: SurplusCaseSummary): boolean {
    return PAID_OUT_STATUS.test(summary.status || '');
  }

  /**
   * The newest document id on the docket, from page one alone. Lee serves
   * newest first, so one request says whether anything has been filed since
   * we last looked.
   */
  async probeDocket(sourceCaseId: string): Promise<string | null> {
    const page = parseDocumentsPage(
      await this.post(this.client(), 'dspCaseDocuments', { caseID: String(sourceCaseId), pagenum: '1' }),
    );
    return page.docs[0]?.docId ?? null;
  }

  async fetchCase(sourceCaseId: string, opts: FetchCaseOptions = {}): Promise<SurplusCaseDetail | null> {
    const id = String(sourceCaseId);
    if (!this.listed.has(id)) await this.listSurplusCases();
    const row = this.listed.get(id);
    if (!row) {
      this.logger.warn(`${this.county} case ${id} is not on the current list; cannot read its case number`);
      return null;
    }

    const http = this.client();
    const summaryHtml = await this.post(http, 'dspCaseSummary', { caseID: id });
    if (!/Case Summary/i.test(summaryHtml)) return null;
    const summary = parseSummary(summaryHtml);

    const parties = parseParties(await this.post(http, 'dspCaseParties', { caseID: id }));
    const documents = await this.fetchDocuments(http, id);
    const recipients = parseNotifications(
      await this.post(http, 'dspNotifications', { caseID: id, pagenum: '1', control: 'SURPLUS_LETTER' }),
    );

    // Owners of record, in the order the county lists them. Spelling variants
    // ("BEVERLY F. KONOPKA" beside "BEVERLY F KONOPKA") are left for
    // collapseClaimants, which is where that rule lives.
    const owners: string[] = [];
    for (const p of parties) {
      if (OWNER_ROLES.test(p.role) && !owners.some((o) => o.toUpperCase() === p.name.toUpperCase())) {
        owners.push(p.name);
      }
    }

    // The operative surplus letter is the LAST one filed; the docket is now in
    // filing order so that is the last match.
    const letters = documents.filter((d) => /^surplus[_\s]*letter$/i.test(d.title));
    const letter = letters[letters.length - 1];
    let surplusAtNotice: number | null = null;
    let certificateNumber: string | null = null;
    // The letter never changes once filed, so a lite fetch of a held case
    // skips the link request and the PDF download, the two heaviest calls.
    if (letter?.docId && !opts.lite) {
      const read = await this.readLetter(http, letter);
      surplusAtNotice = read.surplusAtNotice;
      certificateNumber = read.certificateNumber;
    }

    return {
      ...row,
      sourceCaseId: id,
      certificateNumber,
      saleDate: summary.saleDate || row.saleDate || null,
      owners,
      propertyAddress: summary.street,
      propertyCity: summary.city,
      propertyState: summary.state || 'FL',
      propertyZip: summary.zip,
      legalDescription: summary.legalDescription,
      applicantNames:
        parties
          .filter((p) => p.role === 'APPLICANT')
          .map((p) => p.name)
          .join(', ') || null,
      assessedAs: summary.homestead == null ? null : summary.homestead ? 'Homestead' : 'Non-homestead',
      documents,
      parties,
      // Only owner-role recipients: the letter also goes to lienholders and
      // interested parties, and a single-recipient fallback must not hand an
      // interested party's address to the owner.
      noticeRecipients: recipients.filter((r) => !r.role || OWNER_ROLES.test(r.role)),
      noticeDate: letter?.filedAt || null,
      surplusAtNotice,
      sourceUrl: `${this.baseUrl}/public/cases/list`,
    };
  }

  /**
   * Every page of the docket, returned in FILING ORDER. Lee serves newest
   * first, and the classifier's "last notice is the operative one" rule and
   * the board's ledger both read oldest to newest.
   */
  private async fetchDocuments(http: AxiosInstance, id: string): Promise<SurplusCaseDocument[]> {
    const all: SurplusCaseDocument[] = [];
    let page = 1;
    let totalPages = 1;
    do {
      const parsed = parseDocumentsPage(
        await this.post(http, 'dspCaseDocuments', { caseID: id, pagenum: String(page) }),
      );
      totalPages = parsed.totalPages;
      all.push(...parsed.docs);
      page += 1;
    } while (page <= totalPages);
    return inFilingOrder(all);
  }

  /**
   * A fresh pre-signed URL for one document. Expires within the hour, which is
   * why the ledger stores the id and the board asks for a link on click.
   */
  async resolveDocumentUrl(doc: Pick<SurplusCaseDocument, 'docId' | 'docType'>): Promise<string | null> {
    if (!doc.docId) return null;
    const http = this.client();
    const raw = await this.post(http, 'getDocumentLink', {
      documentID: doc.docId,
      caseLogID: doc.docId,
      type: doc.docType || 'CASE_LOG',
    });
    try {
      const json = JSON.parse(raw);
      const url = json?.DATA?.DOCUMENTLINK;
      return typeof url === 'string' && /^https?:\/\//.test(url) ? url : null;
    } catch {
      return null;
    }
  }

  /**
   * The surplus letter is generated, not scanned, so its text layer is read
   * with pdf-parse and no vision call is needed. Failure here is not failure of
   * the case: the amount and certificate are nice to have, the addresses came
   * from the notifications tab already.
   */
  private async readLetter(
    http: AxiosInstance,
    doc: SurplusCaseDocument,
  ): Promise<{ surplusAtNotice: number | null; certificateNumber: string | null }> {
    const none = { surplusAtNotice: null, certificateNumber: null };
    try {
      const url = await this.resolveDocumentUrl(doc);
      if (!url) return none;
      const res = await axios.get(url, {
        responseType: 'arraybuffer',
        timeout: 30000,
        maxContentLength: 8 * 1024 * 1024,
        headers: { 'User-Agent': REALTDM_USER_AGENT },
      });
      const parsed = await pdfParse(Buffer.from(res.data));
      const t = parsed?.text || '';
      return { surplusAtNotice: surplusFromLetter(t), certificateNumber: certificateFromLetter(t) };
    } catch (e: any) {
      this.logger.warn(`${this.county}: could not read surplus letter ${doc.docId}: ${e.message}`);
      return none;
    }
  }
}

/** Lee County, `lee.realtdm.com`. The first RealTDM county wired up. */
@Injectable()
export class LeeRealTdmAdapter extends RealTdmAdapter {
  constructor(config: ConfigService) {
    super(config, { key: 'realtdm_lee', county: 'Lee', subdomain: 'lee' });
  }
}

/**
 * Duval County tax deed surplus, from taxdeed.duvalclerk.com.
 *
 * ── Why Duval and not RealTDM first ─────────────────────────────────────────
 *
 * The RealTDM spec covers seven counties, but Duval is not one of them: it runs
 * its own ASP.NET app with a completely separate document vocabulary. It is
 * also the better first target on three counts.
 *
 *   1. It publishes a dedicated Surplus Funds search, so we ask for exactly the
 *      cases we want instead of scraping a sale-date window and filtering.
 *      RealTDM has no such filter and its status filter toggles itself OFF when
 *      re-selected, which silently widens a search.
 *   2. Its results come back as JSON from a jqGrid endpoint, not HTML fragments.
 *   3. RealTDM's robots.txt disallows automated fetching. Duval serves no
 *      robots.txt at all (404 as of 2026-08-27), so the objection that stalls a
 *      nightly RealTDM scraper does not apply here.
 *
 * ── Shape of the source ─────────────────────────────────────────────────────
 *
 * The list is a two-step. POST `/` with `buttonSubmitSurplus` puts "Surplus"
 * into the session, then GET `/Home/GridSearchData?SearchType=Surplus` returns
 * paged JSON. The session cookie carries the search type, so the two requests
 * must share a cookie jar or the grid returns whatever the last search was.
 *
 * Rows arrive as a positional `cell` array in colModel order. That order is
 * declared in a script tag on the results page and is asserted below rather
 * than trusted, because a column reordering upstream would otherwise write
 * parcel numbers into the sale date without failing.
 */

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance } from 'axios';
import {
  SurplusSourceAdapter,
  SurplusCaseSummary,
  SurplusCaseDetail,
  SurplusCaseDocument,
} from './surplus-source.types';

const DEFAULT_BASE_URL = 'https://taxdeed.duvalclerk.com';
const PAGE_SIZE = 100;
/** A courtesy pause between detail fetches. The docket is small; be polite. */
const DETAIL_DELAY_MS = 400;

/**
 * The jqGrid colModel, in the order the results page declares it. Asserted on
 * every run, never assumed.
 */
const GRID_COLUMNS = [
  'Applicant',
  'CaseNumber',
  'CertificateNumber',
  'ParcelID',
  'SaleDate',
  'Status',
  'OpeningBid',
  'HighBid',
  'Surplus',
  'PropertyOwners',
] as const;

/** Only SOLD cases carry a live surplus. 207 of 208 ESCHEATED rows post $0.00. */
const LIVE_STATUS = /^SOLD$/i;

function money(v?: string | null): number | null {
  if (v == null) return null;
  const n = Number(String(v).replace(/[^0-9.-]/g, ''));
  return Number.isFinite(n) ? n : null;
}

/** Duval ships M/D/YYYY. Returns an ISO date, or null rather than an epoch. */
export function duvalDate(v?: string | null): string | null {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(String(v || '').trim());
  if (!m) return null;
  const [, mm, dd, yyyy] = m;
  return `${yyyy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`;
}

/**
 * Owners, from either of the two formats Duval uses.
 *
 * The search grid ships them tilde-delimited and heavily duplicated: one row
 * repeats the same trustee three times and the same LLC twice. The DETAIL page
 * ships the same list newline-delimited with a trailing comma on every entry
 * but the last:
 *
 *     DANNIE LESTER STEWART ESTATE,\nDANNIE LESTER STEWART\n
 *
 * Both separators are handled here so one function serves both call sites.
 *
 * Splitting on the comma as well would be actively WRONG, and it is the obvious
 * thing to try because every line but the last ends in one. Entity owners carry
 * commas inside the name: `HERCELL, LLLP` and `HEAVENLY HANDS FUNDING, LLC` are
 * each ONE owner, and comma-splitting turns them into two claimants, two leads,
 * and two people to call who do not exist.
 */
export function parseOwners(raw?: string | null): string[] {
  const seen = new Map<string, string>();
  for (const part of String(raw || '').split(/[~\r\n]+/)) {
    const name = part.trim().replace(/,$/, '').replace(/\s+/g, ' ');
    if (!name) continue;
    const key = name.toUpperCase();
    if (!seen.has(key)) seen.set(key, name);
  }
  return [...seen.values()];
}

/** "2533 JERNIGAN RD, JACKSONVILLE, FL 32207" into its parts. */
export function parseAddress(raw?: string | null): {
  street: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
} {
  const s = String(raw || '').trim();
  if (!s) return { street: null, city: null, state: null, zip: null };
  const m = /^(.*?),\s*([^,]+?),\s*([A-Z]{2})\s*(\d{5})(?:-\d{4})?$/i.exec(s);
  if (!m) return { street: s, city: null, state: 'FL', zip: null };
  return { street: m[1].trim(), city: m[2].trim(), state: m[3].toUpperCase(), zip: m[4] };
}

function decode(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .trim();
}

/**
 * Pull a labelled value out of the Case Details block. The page is a run of
 * `<label>Case Number</label><span>2025-0774TD</span>` style pairs with the
 * markup varying between fields, so this reads "the next text after the label"
 * rather than assuming a tag.
 */
export function detailField(html: string, label: string): string | null {
  const re = new RegExp(
    `>\\s*${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*<\\/[^>]+>\\s*(?:<[^>]+>\\s*)*?([^<]{1,200}?)\\s*<`,
    'i',
  );
  const m = re.exec(html);
  return m ? decode(m[1]) || null : null;
}

/**
 * Every document on the docket, in filing order.
 *
 * Two kinds appear. Most are anchors to `/Home/Image/<id>`. Some are plain text
 * followed by "(Image Not Available)", which are real filings the clerk has
 * indexed but not scanned. Those matter: `Applicant Disbursement` is almost
 * always image-less, and dropping the unlinked ones would also drop
 * `Surplus Breakdown` on some cases, which is distribution evidence.
 */
export function parseDocuments(html: string): SurplusCaseDocument[] {
  const body = html.slice(Math.max(0, html.indexOf('Documents')));
  const docs: SurplusCaseDocument[] = [];

  const anchor = /<a[^>]+href="(\/Home\/Image\/(\d+))"[^>]*>\s*([^<]{2,80}?)\s*<\/a>/gi;
  for (let m = anchor.exec(body); m; m = anchor.exec(body)) {
    docs.push({ title: decode(m[3]), docId: m[2], url: m[1] });
  }

  const unlinked = /([A-Za-z][^<>\n]{3,70}?)\s*\(Image Not Available\)/gi;
  for (let m = unlinked.exec(body); m; m = unlinked.exec(body)) {
    docs.push({ title: decode(m[1]), docId: null, url: null });
  }

  return docs;
}

@Injectable()
export class DuvalTaxDeedAdapter implements SurplusSourceAdapter {
  readonly key = 'duval_taxdeed';
  readonly county = 'Duval';
  /** Daily: the county serves no robots.txt and the docket is a few hundred JSON rows. */
  readonly cadence = 'daily' as const;
  readonly detailDelayMs = DETAIL_DELAY_MS;

  private readonly logger = new Logger(DuvalTaxDeedAdapter.name);
  /** Public so the ingest can absolutize a document's relative URL. */
  readonly baseUrl: string;

  constructor(private config: ConfigService) {
    this.baseUrl = (
      this.config.get<string>('DUVAL_TAXDEED_BASE_URL') || DEFAULT_BASE_URL
    ).replace(/\/+$/, '');
  }

  /** A client with its own cookie jar, since the search type lives in session. */
  private client(): AxiosInstance {
    const jar: string[] = [];
    const http = axios.create({
      baseURL: this.baseUrl,
      // The docket list is a POST plus five paged grid calls against a county
      // server, and 30s covered the whole sequence only on a good morning: the
      // 2026-08-28 cron run died with "timeout of 30000ms exceeded" having
      // scanned nothing, while a second replica two minutes later scanned all
      // 443. A per-request minute is generous for one call and still bounded.
      timeout: 60000,
      maxRedirects: 3,
      headers: {
        // Identify ourselves rather than impersonating a browser, and give the
        // clerk's office somewhere to complain to if the poll is a nuisance.
        'User-Agent': 'DealcoreSurplusBot/1.0 (+https://mydealcore.com; contact deals@quickcashhomebuyers.com)',
        Accept: 'text/html,application/json',
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

  async listSurplusCases(): Promise<SurplusCaseSummary[]> {
    const http = this.client();

    // One retry on the whole sequence. A county web server that times out at
    // 9:45 usually answers at 9:46, and a poll that gives up scans nothing:
    // the run recorded scanned=0, created=0, which reads like an empty docket
    // rather than a failed fetch.
    try {
      return await this.fetchList(http);
    } catch (e: any) {
      this.logger.warn(`Duval list failed (${e.message}), retrying once`);
      await new Promise((r) => setTimeout(r, 5000));
      return this.fetchList(this.client());
    }
  }

  private async fetchList(http: AxiosInstance): Promise<SurplusCaseSummary[]> {
    // Step one: put "Surplus" into the session. The button name is the whole
    // payload; the search takes no other parameters.
    const form = new URLSearchParams({ buttonSubmitSurplus: 'Search for Surplus Funds' });
    const page = await http.post('/', form.toString(), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });

    this.assertColumnOrder(String(page.data || ''));

    // Step two: page the grid.
    const out: SurplusCaseSummary[] = [];
    let pageNum = 1;
    let totalPages = 1;
    do {
      const res = await http.get('/Home/GridSearchData', {
        params: {
          SearchType: 'Surplus',
          _search: false,
          rows: PAGE_SIZE,
          page: pageNum,
          sidx: '',
          sord: 'asc',
        },
        headers: { 'X-Requested-With': 'XMLHttpRequest' },
      });
      const data = res.data || {};
      totalPages = Number(data.total) || 1;
      for (const row of data.rows || []) {
        const summary = this.rowToSummary(row);
        if (summary) out.push(summary);
      }
      pageNum += 1;
    } while (pageNum <= totalPages);

    return out;
  }

  /**
   * Fail loudly if the grid's column order moves. Without this a reordering
   * upstream would quietly write the parcel number into the sale date, and
   * every downstream clock would be wrong with nothing logged.
   */
  private assertColumnOrder(html: string): void {
    const names = [...html.matchAll(/name:\s*'([A-Za-z]+)'/g)].map((m) => m[1]);
    const seen = GRID_COLUMNS.filter((c) => names.includes(c));
    if (seen.length !== GRID_COLUMNS.length) return; // page shape changed entirely; the grid call will surface it
    const ordered = names.filter((n) => (GRID_COLUMNS as readonly string[]).includes(n));
    const matches = GRID_COLUMNS.every((c, i) => ordered[i] === c);
    if (!matches) {
      throw new Error(
        `Duval grid column order changed: expected ${GRID_COLUMNS.join(',')} but page declares ${ordered.join(',')}`,
      );
    }
  }

  private rowToSummary(row: any): SurplusCaseSummary | null {
    const cell: string[] = row?.cell || [];
    if (cell.length < GRID_COLUMNS.length) return null;
    const [, caseNumber, certificateNumber, parcelId, saleDate, status, openingBid, highBid, surplus, owners] =
      cell;
    const id = row?.id;
    if (id == null || !caseNumber) return null;
    return {
      sourceCaseId: String(id),
      caseNumber: String(caseNumber).trim(),
      certificateNumber: String(certificateNumber || '').trim() || null,
      parcelId: String(parcelId || '').trim() || null,
      saleDate: duvalDate(saleDate),
      status: String(status || '').trim() || null,
      surplus: money(surplus),
      openingBid: money(openingBid),
      highBid: money(highBid),
      owners: parseOwners(owners),
    };
  }

  async fetchCase(sourceCaseId: string): Promise<SurplusCaseDetail | null> {
    const http = this.client();
    const path = `/Home/Details?id=${encodeURIComponent(sourceCaseId)}`;
    const res = await http.get(path);
    const html = String(res.data || '');
    if (!html.includes('Case Details')) return null;

    const caseNumber = detailField(html, 'Case Number');
    if (!caseNumber) return null;

    const addr = parseAddress(detailField(html, 'Property Address'));

    return {
      sourceCaseId: String(sourceCaseId),
      caseNumber,
      certificateNumber: detailField(html, 'Certificate'),
      parcelId: detailField(html, 'Parcel ID'),
      saleDate: duvalDate(detailField(html, 'Auction Date')),
      status: detailField(html, 'Status'),
      surplus: money(detailField(html, 'Surplus')),
      openingBid: money(detailField(html, 'Opening Bid')),
      highBid: money(detailField(html, 'High Bid')),
      owners: parseOwners(detailField(html, 'Property Owners')),
      propertyAddress: addr.street,
      propertyCity: addr.city,
      propertyState: addr.state,
      propertyZip: addr.zip,
      legalDescription: detailField(html, 'Legal Description'),
      applicantNames: detailField(html, 'Applicant Names'),
      assessedAs: detailField(html, 'Assessed As'),
      documents: parseDocuments(html),
      sourceUrl: `${this.baseUrl}${path}`,
    };
  }

  /** Whether a list row is worth opening the detail page for. */
  isLive(summary: SurplusCaseSummary): boolean {
    return LIVE_STATUS.test(summary.status || '');
  }
}

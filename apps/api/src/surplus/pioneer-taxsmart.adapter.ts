/**
 * Pioneer TaxSmart tax deed surplus, the app Duval, Citrus and Hernando all run.
 *
 * ── One product, three counties ─────────────────────────────────────────────
 *
 * Duval was built first, as `taxdeed.duvalclerk.com`. Citrus
 * (`search.citrusclerk.org/TaxSmartWeb`) and Hernando
 * (`or.hernandoclerk.com/TaxSmart`) turned out to be the same vendor product
 * behind a different host and path: the same `buttonSubmitSurplus` POST, the
 * same jqGrid colModel in the same order, the same `/Home/Details?id=N` page
 * and the same `/Home/Image/N` documents. So this is one adapter with a spec
 * per county rather than three parsers.
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
 * parcel numbers into the sale date without failing. Hernando names the
 * seventh column BaseBid where Duval and Citrus name it OpeningBid, which is
 * the only difference between the three.
 *
 * ── What each county's docket is worth ──────────────────────────────────────
 *
 * The document list is titles only: no filing dates and no claimant names, so
 * the ledger reads kinds and never who filed. Hernando labels a claim
 * "Claims Filed", but it lists that folder on all 82 of its cases and 47 of
 * them are empty, marked "(Image Not Available)". Only a folder with a
 * document behind it is a claim, which is what unlinkedDocsAreFolders means. Citrus publishes
 * no claim document at all, and files "Returned Mail", "Additional Taxes" and
 * "APPLICATION" as empty category folders on EVERY case (147 of 147 in the
 * 2026-09-18 discovery pass), so reading its "Returned Mail" as a dead address
 * would mark every Citrus claimant undeliverable. Both facts are spec flags,
 * not rules in the classifier.
 */

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance } from 'axios';
import {
  SurplusSourceAdapter,
  SurplusCaseSummary,
  SurplusCaseDetail,
  SurplusCaseDocument,
  SurplusPollCadence,
} from './surplus-source.types';

const PAGE_SIZE = 100;
/** A courtesy pause between detail fetches. The docket is small; be polite. */
const DETAIL_DELAY_MS = 400;

/**
 * The jqGrid colModel, in the order the results page declares it. Asserted on
 * every run, never assumed.
 */
const GRID_COLUMNS = [
  ['Applicant'],
  ['CaseNumber'],
  ['CertificateNumber'],
  ['ParcelID'],
  ['SaleDate'],
  ['Status'],
  // Hernando calls the opening bid BaseBid, on the grid and on the detail page.
  ['OpeningBid', 'BaseBid'],
  ['HighBid'],
  ['Surplus'],
  ['PropertyOwners'],
] as const;
const GRID_COLUMN_NAMES: string[] = GRID_COLUMNS.flatMap((c) => [...c]);

/** Only SOLD cases carry a live surplus. 207 of 208 ESCHEATED rows post $0.00. */
const LIVE_STATUS = /^SOLD$/i;

function money(v?: string | null): number | null {
  if (v == null) return null;
  const n = Number(String(v).replace(/[^0-9.-]/g, ''));
  return Number.isFinite(n) ? n : null;
}

/** The grid ships M/D/YYYY. Returns an ISO date, or null rather than an epoch. */
export function taxSmartDate(v?: string | null): string | null {
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

  // Citrus and Hernando serve the app under a path prefix
  // (`/TaxSmartWeb/Home/Image/145437`), Duval at the root.
  const anchor = /<a[^>]+href="((?:\/[A-Za-z]+)?\/Home\/Image\/(\d+))"[^>]*>\s*([^<]{2,80}?)\s*<\/a>/gi;
  for (let m = anchor.exec(body); m; m = anchor.exec(body)) {
    docs.push({ title: decode(m[3]), docId: m[2], url: m[1] });
  }

  const unlinked = /([A-Za-z][^<>\n]{3,70}?)\s*\(Image Not Available\)/gi;
  for (let m = unlinked.exec(body); m; m = unlinked.exec(body)) {
    docs.push({ title: decode(m[1]), docId: null, url: null });
  }

  return docs;
}

export interface PioneerCountySpec {
  /** Written to SurplusDetail.sourceSystem, eg 'duval_taxdeed'. */
  key: string;
  /** Matches FL_COUNTIES. */
  county: string;
  /** Host plus any path prefix, eg 'https://or.hernandoclerk.com/TaxSmart'. */
  defaultBaseUrl: string;
  /** Env var that overrides the base URL, where one exists. */
  baseUrlEnv?: string;
  cadence?: SurplusPollCadence;
  /**
   * Titles the county files as an empty category folder on every case. They
   * carry no signal and must not be read as evidence: Citrus files "Returned
   * Mail" on all 147 live cases, and the mail rules would otherwise call every
   * Citrus claimant's address dead.
   */
  categoryFolders?: string[];
  /**
   * The county publishes no claim document, so an empty docket is not evidence
   * nobody has filed. Citrus. The verdict stays open and says so.
   */
  claimsNotPublished?: boolean;
  /**
   * The county lists its whole folder structure on every case, whether or not
   * anything was filed into it, and an empty folder carries "(Image Not
   * Available)" instead of a link. TRUE on Hernando, where all 82 cases list
   * "Claims Filed" and 47 of them are empty: read literally, every case in the
   * county has a claim against it and nothing is ever workable.
   *
   * FALSE on Duval, where an image-less filing is a real one the clerk has
   * indexed but not scanned. "Applicant Disbursement" is almost always
   * image-less there, and dropping it would lose the distribution evidence.
   */
  unlinkedDocsAreFolders?: boolean;
}

@Injectable()
export class PioneerTaxSmartAdapter implements SurplusSourceAdapter {
  readonly key: string;
  readonly county: string;
  readonly cadence: SurplusPollCadence;
  readonly detailDelayMs = DETAIL_DELAY_MS;
  readonly categoryFolders?: string[];
  readonly claimsNotPublished?: boolean;
  readonly unlinkedDocsAreFolders?: boolean;

  protected readonly logger: Logger;
  /** Public so the ingest can absolutize a document's relative URL. */
  readonly baseUrl: string;

  constructor(
    protected config: ConfigService,
    spec: PioneerCountySpec,
  ) {
    this.key = spec.key;
    this.county = spec.county;
    this.cadence = spec.cadence || 'weekly';
    this.categoryFolders = spec.categoryFolders;
    this.claimsNotPublished = spec.claimsNotPublished;
    this.unlinkedDocsAreFolders = spec.unlinkedDocsAreFolders;
    this.logger = new Logger(`${PioneerTaxSmartAdapter.name}:${spec.county}`);
    const override = spec.baseUrlEnv ? this.config.get<string>(spec.baseUrlEnv) : null;
    this.baseUrl = (override || spec.defaultBaseUrl).replace(/\/+$/, '');
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
      this.logger.warn(`${this.county} list failed (${e.message}), retrying once`);
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
    const seen = GRID_COLUMNS.filter((aliases) => aliases.some((a) => names.includes(a)));
    if (seen.length !== GRID_COLUMNS.length) return; // page shape changed entirely; the grid call will surface it
    const ordered = names.filter((n) => GRID_COLUMN_NAMES.includes(n));
    const matches = GRID_COLUMNS.every((aliases, i) => (aliases as readonly string[]).includes(ordered[i]));
    if (!matches) {
      throw new Error(
        `${this.county} grid column order changed: expected ${GRID_COLUMNS.map((c) => c[0]).join(',')} but page declares ${ordered.join(',')}`,
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
      saleDate: taxSmartDate(saleDate),
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
      saleDate: taxSmartDate(detailField(html, 'Auction Date')),
      status: detailField(html, 'Status'),
      surplus: money(detailField(html, 'Surplus')),
      openingBid: money(detailField(html, 'Opening Bid') ?? detailField(html, 'Base Bid')),
      highBid: money(detailField(html, 'High Bid')),
      owners: parseOwners(detailField(html, 'Property Owners')),
      propertyAddress: addr.street,
      propertyCity: addr.city,
      propertyState: addr.state,
      propertyZip: addr.zip,
      legalDescription: detailField(html, 'Legal Description'),
      applicantNames: detailField(html, 'Applicant Names'),
      assessedAs: detailField(html, 'Assessed As'),
      documents: this.absoluteDocuments(
        this.unlinkedDocsAreFolders ? parseDocuments(html).filter((d) => d.docId) : parseDocuments(html),
      ),
      sourceUrl: `${this.baseUrl}${path}`,
    };
  }

  /**
   * Document links, absolute against the ORIGIN.
   *
   * Citrus and Hernando serve the app under a path prefix and their anchors
   * already carry it (`/TaxSmartWeb/Home/Image/145437`), so joining the stored
   * path onto a base URL that also carries the prefix produced
   * `.../TaxSmart/TaxSmart/Home/Image/70088`. That 404s, and the notice reader
   * treats a fetch failure as "no notice", so the first Hernando pull created
   * seven leads with no mailing address and nothing in the log to say why.
   */
  private absoluteDocuments(docs: SurplusCaseDocument[]): SurplusCaseDocument[] {
    const origin = new URL(this.baseUrl).origin;
    return docs.map((d) => (d.url && !d.url.startsWith('http') ? { ...d, url: `${origin}${d.url}` } : d));
  }

  /** Whether a list row is worth opening the detail page for. */
  isLive(summary: SurplusCaseSummary): boolean {
    return LIVE_STATUS.test(summary.status || '');
  }
}

/**
 * Duval. Weekly since 2026-09-22, with every other county, at Geoff's call:
 * it ran daily from launch because the county serves no robots.txt and the
 * docket is a few hundred JSON rows, but a claim is only worked from day 110
 * so a day's delay costs nothing. Its docket names claimants in the title, so
 * it needs neither spec flag.
 */
@Injectable()
export class DuvalTaxDeedAdapter extends PioneerTaxSmartAdapter {
  constructor(config: ConfigService) {
    super(config, {
      key: 'duval_taxdeed',
      county: 'Duval',
      defaultBaseUrl: 'https://taxdeed.duvalclerk.com',
      baseUrlEnv: 'DUVAL_TAXDEED_BASE_URL',
      cadence: 'weekly',
    });
  }
}

/**
 * Citrus (discovery 2026-09-18). 147 live cases over the floor, $1.97M. The
 * richest list of the three and the blindest docket: no claim document exists,
 * and three titles are empty folders filed on every case.
 */
@Injectable()
export class CitrusTaxSmartAdapter extends PioneerTaxSmartAdapter {
  constructor(config: ConfigService) {
    super(config, {
      key: 'citrus_taxsmart',
      county: 'Citrus',
      defaultBaseUrl: 'https://search.citrusclerk.org/TaxSmartWeb',
      categoryFolders: ['Returned Mail', 'Additional Taxes', 'APPLICATION'],
      claimsNotPublished: true,
    });
  }
}

/**
 * Hernando (discovery 2026-09-18). 43 live cases over the floor, of which 22
 * already carry a "Claims Filed" document. Smaller than Citrus and far better
 * evidenced.
 */
@Injectable()
export class HernandoTaxSmartAdapter extends PioneerTaxSmartAdapter {
  constructor(config: ConfigService) {
    super(config, {
      key: 'hernando_taxsmart',
      county: 'Hernando',
      defaultBaseUrl: 'https://or.hernandoclerk.com/TaxSmart',
      unlinkedDocsAreFolders: true,
    });
  }
}

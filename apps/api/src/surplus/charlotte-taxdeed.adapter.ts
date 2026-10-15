/**
 * Charlotte County tax deed surplus, `taxdeeds.charlotteclerk.com`.
 *
 * ── Shape of the source ─────────────────────────────────────────────────────
 *
 * The clerk's own ASP.NET Core app, sharing nothing with RealTDM or Pioneer
 * TaxSmart. The Surplus page is an empty Kendo grid; the data comes from three
 * form-encoded POSTs, each needing the antiforgery cookie AND the token from
 * the page's hidden input (a POST without them is a 400):
 *
 *   /TaxDeed/GetTaxDeedViewBySurplus   every case, as Kendo JSON {Data, Total}
 *   /TaxDeed/GetTaxDeedDetail/         one case: owners, legal, auction date
 *   /TaxDeed/GetTaxDeedDocumentView    the docket, titles and document ids
 *
 * Discovery 2026-10-15: 614 cases listed, 289 sold within the year, 204 of
 * those at or over the floor holding $2.71M.
 *
 * ── What the docket is worth ────────────────────────────────────────────────
 *
 * Titles, no dates, no claimant names. Every case carries the same sale-day
 * paperwork, all classed as nothing: a "RECEIPT" (the purchaser's, filed at the
 * sale, so receipts imply nothing here), "COMPTROLLER: DISBURSEMENT REGISTER"
 * and "CHECK REQUEST" (paying the certificate holder, filed BEFORE the notice),
 * and "MAIL - RETURN RECEIPTS" from the application notice. The notice is
 * "LETTERS: NOTICE OF SURPLUS" and a claim is "EXCESS MONEY CLAIM", each with a
 * hidden "TAX FORM FOR COMPTROLLER" (the W-9) beside it.
 *
 * Payouts are NOT published: the checks and anything marked "CAN'T GO ON THE
 * WEB" are hidden. Nor is the list status a reliable claim flag. 26724 reads
 * plain SOLD with an EXCESS MONEY CLAIM on its docket, so "PENDING EXCESS MONEY
 * CLAIM" is treated as live like SOLD, and the docket decides.
 *
 * ── Where the owner's address is ────────────────────────────────────────────
 *
 * Nowhere in the data. The detail's Address field reads "ADDRESS 1 NOT
 * AVAILABLE|..." on every case checked, and there are no parties. The notice
 * carries it: a multi-page Group 4 TIFF behind an Atalasoft viewer, one notice
 * page per addressee each followed by a blank Proof of Claim form. 25-0952
 * noticed one owner at two Ontario addresses. The viewer hands the TIFF out
 * per session, so fetchDocument walks the viewer page to it and the notice
 * reader turns its pages into images.
 */

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance } from 'axios';
import { cleanOwnerLine } from './realtdm.adapter';
import {
  SurplusSourceAdapter,
  SurplusCaseSummary,
  SurplusCaseDetail,
  SurplusCaseDocument,
  SurplusDocumentFile,
  SurplusPollCadence,
} from './surplus-source.types';

const DEFAULT_BASE_URL = 'https://taxdeeds.charlotteclerk.com';
const VIEWER_BASE_URL = 'https://viewer.charlotteclerk.com';
const SURPLUS_PAGE = '/TaxDeed/Surplus';
const PAGE_SIZE = 500;
/** Two requests per case against a county server. */
const DETAIL_DELAY_MS = 800;
/** Antiforgery sessions are reused for a run, never for longer than this. */
const SESSION_MAX_AGE_MS = 20 * 60 * 1000;
/** 25-0952's notice is 4 pages and 26-0405's is 14; a scan past this is not a notice. */
const MAX_DOCUMENT_BYTES = 8 * 1024 * 1024;

const USER_AGENT = 'DealcoreSurplusBot/1.0 (+https://mydealcore.com; contact deals@quickcashhomebuyers.com)';

/** SOLD, or SOLD with a claim the clerk has flagged. Both may still hold money. */
const LIVE_STATUS = /^SOLD(?:\s*-\s*PENDING\s+EXCESS\s+MONEY\s+CLAIM)?$/i;
/** Unclaimed and handed to the state: a Chapter 717 matter, not a lead. */
const SENT_TO_STATE = /\bEXCESS\s+FUNDS\s+SENT\s+TO\s+STATE\b/i;

function money(v: unknown): number | null {
  if (v == null || v === '') return null;
  const n = Number(String(v).replace(/[^0-9.-]/g, ''));
  return Number.isFinite(n) ? n : null;
}

/**
 * The list ships "2026-01-27T09:00:00", the detail "01/27/2026". Both to an
 * ISO date, or null rather than an epoch.
 */
export function charlotteDate(v?: string | null): string | null {
  const s = String(v || '').trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(s);
  if (us) return `${us[3]}-${us[1].padStart(2, '0')}-${us[2].padStart(2, '0')}`;
  return null;
}

/**
 * One owner line with Charlotte's deed wording taken off before the shared
 * cleaner sees it. 26-0405 lists
 *
 *     HAMMER, ALICE M. AS TO AN UNDIVIDED 1/2 INTEREST
 *     COCHRUN, BEATRICE R AS TRUSTESS UNDER THE WILL OF CHARLES J HAMMER, DECEASED, AS TO ...
 *
 * The share is not part of a name, and the trustee's capacity has to go
 * BEFORE cleanOwnerLine runs: it misses the clerk's "TRUSTESS", then finds the
 * dead testator's DECEASED and files the living trustee as an estate. The
 * share comes in a dozen wordings across the 614 rows of the 2026-10-15 list
 * (", 1/12 INTEREST", ", EACH WITH AN UNDIVIDED 1/5TH INTEREST", " AN
 * UNDIVIDED 50% INTEREST"), and a life estate is a holding, not a dead owner.
 * Entity owners repeat their charter ("SONO HOMES, LLC, A FLORIDA LIMITED
 * LIABILITY COMPANY" beside "SONO HOMES LLC"), which is dropped so the two
 * collapse, and "THE ESTATE OF" loses its article so it is not doubled.
 */
export function preCleanOwner(raw: string): string {
  return (
    String(raw || '')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/,?\s+D\/?B\/?A\s+.*$/i, '')
      .replace(
        /[,;]?\s+(?:EACH\s+)?(?:(?:AS\s+)?(?:TO|WITH)\s+)?(?:AN?\s+)?(?:UNDIVIDED\s+)?\d+(?:\/\d+)?(?:ST|ND|RD|TH)?\s*%?\s+(?:UNDIVIDED\s+)?INTEREST\b.*$/i,
        '',
      )
      .replace(/,?\s+AS\s+TO\s+A\s+LIFE\s+ESTATE\b.*$/i, '')
      .replace(/,?\s+(?:AS\s+)?(?:SUCCESSOR\s+)?(?:CO-?\s*)?TRUST(?:EE|ESS)S?\b.*$/i, '')
      .replace(
        /,?\s+AN?\s+(?:[A-Z]+\s+)*?(?:LIMITED\s+L\s*IABI\w*\s+COMPANY|LIMITED\s+PARTNERSHIP|(?:NOT-FOR-PROFIT\s+|NON-?PROFIT\s+)?CORPORATION)\s*$/i,
        '',
      )
      .replace(/^THE\s+(ESTATE\s+OF\b)/i, '$1')
      .trim()
  );
}

/** A key that treats "SONO HOMES, LLC" and "SONO HOMES LLC" as one owner. */
function ownerKey(name: string): string {
  return name.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/**
 * Owners, one per line on the detail and joined the same way on the list.
 *
 * Each line is ONE owner, written surname first. The RealTDM compound
 * splitter is deliberately not used: it reads "MILLER JR, GEORGE G." and
 * "DE PARADIS, DOLORES APONTE" as two people each.
 */
export function parseCharlotteOwners(raw?: string | null): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const line of String(raw || '').split(/[\r\n]+/)) {
    const pre = preCleanOwner(line);
    // A numbered company ("1720763 ONTARIO, LTD") is its number. The shared
    // cleaner strips long digit runs as custodial account numbers.
    const name = /^\d{5,}\s+[A-Z]/i.test(pre) ? pre : cleanOwnerLine(pre);
    if (!name) continue;
    const key = ownerKey(name);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out;
}

/**
 * "ADDRESS 1|ADDRESS 2|CITY|ST|ZIP", where every part the county does not hold
 * says so in words ("CITY NOT AVAILABLE"). Those are dropped, not stored.
 */
export function parseCharlotteAddress(raw?: string | null): {
  street: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
} {
  const parts = String(raw || '')
    .split('|')
    .map((p) => p.trim())
    .map((p) => (/NOT\s+AVAILABLE/i.test(p) ? '' : p));
  const [a1 = '', a2 = '', city = '', state = '', zip = ''] = parts;
  const street = [a1, a2].filter(Boolean).join(' ') || null;
  return {
    street,
    city: city || null,
    state: state ? state.toUpperCase() : 'FL',
    zip: /^\d{5}/.test(zip) ? zip.slice(0, 5) : null,
  };
}

/**
 * The viewer link the clerk's own page opens: base64 of the JavaScript
 * escape() of the query. The query is letters, digits, "=" and "&" only, so
 * escape() is exactly those two replacements. Durable: it names the document,
 * not a session.
 */
export function viewerUrl(docId: string | number): string {
  const query = `app=TAXDEEDWEB&imagenumber=${docId}&startpage=0&totalpages=0`
    .replace(/=/g, '%3D')
    .replace(/&/g, '%26');
  return `${VIEWER_BASE_URL}/Viewer.aspx?${Buffer.from(query).toString('base64')}`;
}

/** The session-scoped TIFF path the viewer page loads its thumbnails from. */
export function viewerImagePath(html: string): string | null {
  const m = /id="WebThumbnailViewer1_uri"\s+value="([^"]+)"/.exec(String(html || ''));
  return m ? m[1] : null;
}

/** One docket row into the shared shape. Hidden rows keep their title and lose the link. */
export function toDocument(row: any): SurplusCaseDocument | null {
  const id = row?.DocumentId;
  const title = String(row?.Description || row?.DocumentType || '').trim();
  if (id == null || !title) return null;
  return {
    title,
    docId: String(id),
    url: row?.HideFromWeb ? null : viewerUrl(id),
    docType: String(row?.DocumentType || '').trim() || null,
  };
}

/** The list row into a summary, or null for anything without a case id. */
export function rowToSummary(row: any): SurplusCaseSummary | null {
  if (row?.CaseId == null || !row?.CaseNumber) return null;
  return {
    sourceCaseId: String(row.CaseId),
    caseNumber: String(row.CaseNumber).trim(),
    certificateNumber: String(row.CertificateNumber || '').trim() || null,
    parcelId: String(row.ParcelId || '').trim() || null,
    saleDate: charlotteDate(row.SaleDate),
    status: String(row.Status || '').trim() || null,
    surplus: money(row.Surplus),
    openingBid: money(row.BaseBid),
    highBid: money(row.HighBid),
    owners: parseCharlotteOwners(row.Owners),
  };
}

interface Session {
  http: AxiosInstance;
  token: string;
  at: number;
}

/** An axios client with its own cookie jar. */
function sessionClient(baseURL: string): AxiosInstance {
  const jar = new Map<string, string>();
  const http = axios.create({
    baseURL,
    timeout: 60000,
    maxRedirects: 3,
    headers: { 'User-Agent': USER_AGENT, Accept: 'text/html,application/json' },
    validateStatus: (s) => s < 400,
  });
  http.interceptors.response.use((res) => {
    const set = res.headers['set-cookie'];
    if (Array.isArray(set)) {
      for (const c of set) {
        const pair = c.split(';')[0];
        jar.set(pair.split('=')[0], pair);
      }
    }
    return res;
  });
  http.interceptors.request.use((cfg) => {
    if (jar.size) cfg.headers.Cookie = [...jar.values()].join('; ');
    return cfg;
  });
  return http;
}

@Injectable()
export class CharlotteTaxDeedAdapter implements SurplusSourceAdapter {
  readonly key = 'charlotte_taxdeed';
  readonly county = 'Charlotte';
  readonly cadence: SurplusPollCadence = 'weekly';
  readonly detailDelayMs = DETAIL_DELAY_MS;
  /** Documents are sorted by id, which rises with filing. See classifyCase. */
  readonly docketInFilingOrder = true;
  readonly baseUrl: string;

  private readonly logger = new Logger(CharlotteTaxDeedAdapter.name);
  private session: Promise<Session> | null = null;

  constructor(private config: ConfigService) {
    const override = this.config.get<string>('CHARLOTTE_TAXDEED_BASE_URL');
    this.baseUrl = (override || DEFAULT_BASE_URL).replace(/\/+$/, '');
  }

  /** The antiforgery cookie and token, from one GET of the Surplus page. */
  private async openSession(): Promise<Session> {
    const http = sessionClient(this.baseUrl);
    const res = await http.get(SURPLUS_PAGE);
    const m = /name="__RequestVerificationToken"[^>]*value="([^"]+)"/.exec(String(res.data || ''));
    if (!m) throw new Error('Charlotte surplus page carried no antiforgery token');
    return { http, token: m[1], at: Date.now() };
  }

  private async getSession(fresh = false): Promise<Session> {
    if (!fresh && this.session) {
      const s = await this.session.catch(() => null);
      if (s && Date.now() - s.at < SESSION_MAX_AGE_MS) return s;
    }
    this.session = this.openSession();
    return this.session;
  }

  /** One form POST, retried once on a fresh session if the token has gone stale. */
  private async post(path: string, fields: Record<string, string>): Promise<any> {
    const send = async (s: Session) => {
      const form = new URLSearchParams({ __RequestVerificationToken: s.token, ...fields });
      const res = await s.http.post(path, form.toString(), {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Requested-With': 'XMLHttpRequest' },
      });
      return res.data;
    };
    try {
      return await send(await this.getSession());
    } catch (e: any) {
      this.logger.warn(`Charlotte ${path} failed (${e.message}), retrying on a fresh session`);
      await new Promise((r) => setTimeout(r, 3000));
      return send(await this.getSession(true));
    }
  }

  async listSurplusCases(): Promise<SurplusCaseSummary[]> {
    const out: SurplusCaseSummary[] = [];
    let page = 1;
    let total = Infinity;
    while (out.length < total) {
      const data = await this.post('/TaxDeed/GetTaxDeedViewBySurplus', {
        sort: '',
        page: String(page),
        pageSize: String(PAGE_SIZE),
        group: '',
        filter: '',
      });
      if (!data || !Array.isArray(data.Data)) {
        throw new Error('Charlotte surplus list came back without a Data array');
      }
      total = Number(data.Total) || 0;
      const rows = data.Data.map(rowToSummary).filter(Boolean) as SurplusCaseSummary[];
      out.push(...rows);
      // A short page means the server ignored the paging; stop rather than loop.
      if (data.Data.length < PAGE_SIZE) break;
      page += 1;
    }
    return out;
  }

  isLive(summary: SurplusCaseSummary): boolean {
    return LIVE_STATUS.test(summary.status || '');
  }

  isPaidOut(summary: SurplusCaseSummary): boolean {
    return SENT_TO_STATE.test(summary.status || '');
  }

  private async documents(sourceCaseId: string): Promise<SurplusCaseDocument[]> {
    const data = await this.post('/TaxDeed/GetTaxDeedDocumentView', {
      inCaseId: sourceCaseId,
      sort: '',
      page: '1',
      pageSize: '500',
      group: '',
      filter: '',
    });
    const rows: any[] = Array.isArray(data?.Data) ? data.Data : [];
    // Document ids rise with filing, which is the only order the docket has.
    return rows
      .map(toDocument)
      .filter((d): d is SurplusCaseDocument => !!d)
      .sort((a, b) => Number(a.docId) - Number(b.docId));
  }

  async fetchCase(sourceCaseId: string): Promise<SurplusCaseDetail | null> {
    const d = await this.post('/TaxDeed/GetTaxDeedDetail/', { inCaseId: sourceCaseId });
    if (!d || !d.CaseNumber) return null;
    const addr = parseCharlotteAddress(d.Address);
    return {
      sourceCaseId: String(sourceCaseId),
      caseNumber: String(d.CaseNumber).trim(),
      certificateNumber: String(d.CertificateNumber || '').trim() || null,
      parcelId: String(d.ParcelId || '').trim() || null,
      saleDate: charlotteDate(d.AuctionDate),
      status: String(d.Description || '').trim() || null,
      surplus: money(d.Surplus),
      openingBid: money(d.BaseBid),
      highBid: money(d.HighBid),
      owners: parseCharlotteOwners(d.PropertyOwners),
      propertyAddress: addr.street,
      propertyCity: addr.city,
      propertyState: addr.state,
      propertyZip: addr.zip,
      legalDescription: String(d.FullLegal || '').trim() || null,
      applicantNames: String(d.Applicants || '').trim() || null,
      assessedAs: String(d.AssessedAs || '').trim() || null,
      documents: await this.documents(sourceCaseId),
      sourceUrl: `${this.baseUrl}${SURPLUS_PAGE}`,
    };
  }

  ownerName(raw: string): string | null {
    return parseCharlotteOwners(raw)[0] || null;
  }

  /** The newest document id, from the docket call alone. */
  async probeDocket(sourceCaseId: string): Promise<string | null> {
    const docs = await this.documents(sourceCaseId);
    return docs.length ? docs[docs.length - 1].docId || null : null;
  }

  /**
   * The document's image. The viewer page names a TIFF that only its own
   * session can fetch, so both requests share one cookie jar.
   */
  async fetchDocument(doc: Pick<SurplusCaseDocument, 'docId' | 'url'>): Promise<SurplusDocumentFile | null> {
    if (!doc.docId) return null;
    try {
      const http = sessionClient(VIEWER_BASE_URL);
      const page = await http.get(viewerUrl(doc.docId));
      const path = viewerImagePath(String(page.data || ''));
      if (!path) {
        this.logger.warn(`Charlotte viewer named no image for document ${doc.docId}`);
        return null;
      }
      // The image server answers 406 to the client's default html/json Accept.
      const img = await http.get(path, {
        responseType: 'arraybuffer',
        maxContentLength: MAX_DOCUMENT_BYTES,
        headers: { Accept: 'image/tiff,image/*,*/*' },
      });
      const data = Buffer.from(img.data);
      if (!data.length) return null;
      return { data, contentType: String(img.headers['content-type'] || 'image/tiff') };
    } catch (e: any) {
      this.logger.warn(`Charlotte document ${doc.docId} could not be fetched: ${e.message}`);
      return null;
    }
  }
}

import { Injectable, Logger } from '@nestjs/common';
import * as XLSX from 'xlsx';
import { ForeclosureSourceKind } from '@fast-homes/shared';
import { ForeclosuresService } from './foreclosures.service';
import { ForeclosureLeadInput } from './foreclosure.types';
import { parseNum, normalizePhoneDigits, phoneTypeOf } from './foreclosure-scoring.util';

/**
 * Normalize a header cell to a lookup key: lowercase, alphanumerics only.
 * Mirrors the offline tracker's normH so the same sheet imports identically.
 */
function normH(h: any): string {
  return String(h || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Normalized header -> ForeclosureLeadInput field.
 *
 * Covers both the offline tracker's own headers and the spellings used by the
 * purchased NC foreclosure lists (Property City, Date Of Auctions,
 * primary_phone, ...), so a vendor sheet imports without being reshaped first.
 * Where a sheet carries two columns for one field, the leftmost wins.
 */
const HEADER_MAP: Record<string, keyof ForeclosureLeadInput> = {
  dateadded: 'dateAdded',
  priority: 'priority',
  noticetype: 'noticeType',
  listtype: 'noticeType',
  propertyaddress: 'address',
  address: 'address',
  city: 'city',
  propertycity: 'city',
  state: 'state',
  propertystate: 'state',
  zip: 'zip',
  zipcode: 'zip',
  propertyzip: 'zip',
  propertyzipcode: 'zip',
  county: 'county',
  countyname: 'county',
  ownernames: 'ownerNames',
  owner: 'ownerNames',
  ownerfullname: 'ownerNames',
  ownerfirstname: 'ownerFirstName',
  ownerlastname: 'ownerLastName',
  casenumber: 'caseNumber',
  case: 'caseNumber',
  saledate: 'saleDate',
  dateofauction: 'saleDate',
  dateofauctions: 'saleDate',
  auctiondate: 'saleDate',
  hearingdate: 'hearingDate',
  loandate: 'loanDate',
  loanamount: 'loanAmount',
  noticeurl: 'noticeUrl',
  mailingaddress: 'mailingAddress',
  notes: 'notes',
  skipstatus: 'skipStatus',
  ownercountyrecord: 'countyOwner',
  mailcity: 'mailCity',
  mailingcity: 'mailCity',
  mailstate: 'mailState',
  mailingstate: 'mailState',
  mailzip: 'mailZip',
  mailingzip: 'mailZip',
  mailingzipcode: 'mailZip',
  assessedvalue: 'assessedValue',
  totalassessment: 'assessedValue',
  potentialequity: 'equityPct',
  owneroccupied: 'ownerOccupied',
  propertytype: 'propertyType',
  bedrooms: 'bedrooms',
  beds: 'bedrooms',
  bathrooms: 'bathrooms',
  baths: 'bathrooms',
  squarefootage: 'sqft',
  sqft: 'sqft',
  yearbuilt: 'yearBuilt',
  phone1: 'phone1',
  primaryphone: 'phone1',
  phone1type: 'phone1Type',
  primaryphonetype: 'phone1Type',
  phone2: 'phone2',
  phone2type: 'phone2Type',
  phone3: 'phone3',
  phone3type: 'phone3Type',
  phone4: 'phone4',
  phone4type: 'phone4Type',
  email: 'email',
};

// Contact columns that repeat per row rather than having one fixed name:
// Mobile-1..5, Landline-1..3, Email-1..5. Collected in column order and
// folded into the four phone and two email slots the schema actually holds.
const MOBILE_RE = /^mobile(\d*)$/;
const LANDLINE_RE = /^landline(\d*)$/;
const EMAIL_N_RE = /^email(\d+)$/;

interface RepeatIndex {
  mobiles: number[];
  landlines: number[];
  emails: number[];
}

function repeatIndexes(headers: string[]): RepeatIndex {
  const pick = (re: RegExp) =>
    headers
      .map((h, i) => ({ i, m: re.exec(normH(h)) }))
      .filter((x): x is { i: number; m: RegExpExecArray } => x.m !== null)
      .sort((a, b) => Number(a.m[1] || 0) - Number(b.m[1] || 0))
      .map((x) => x.i);
  return {
    mobiles: pick(MOBILE_RE),
    landlines: pick(LANDLINE_RE),
    emails: pick(EMAIL_N_RE),
  };
}

/** Whether a header is understood, either as a fixed field or a repeat column. */
function isRecognized(h: string): boolean {
  const n = normH(h);
  return !!HEADER_MAP[n] || MOBILE_RE.test(n) || LANDLINE_RE.test(n) || EMAIL_N_RE.test(n);
}

@Injectable()
export class ForeclosureImportService {
  private readonly logger = new Logger(ForeclosureImportService.name);

  constructor(private foreclosures: ForeclosuresService) {}

  /** Parse the uploaded sheet into headers + sample rows (for a preview UI). */
  parseUpload(buffer: Buffer): {
    headers: string[];
    sampleRows: any[][];
    totalRows: number;
    recognized: string[];
  } {
    const { headers, rows } = this.readSheet(buffer);
    const recognized = headers.filter(isRecognized);
    return { headers, sampleRows: rows.slice(0, 5), totalRows: rows.length, recognized };
  }

  /** Import every row of the tracker sheet as FORECLOSURE leads. */
  async executeImport(
    buffer: Buffer,
    opts: { organizationId?: string | null },
  ): Promise<{ created: number; skipped: number; errors: { row: number; reason: string }[] }> {
    const { headers, rows } = this.readSheet(buffer);

    // Column index for each recognized field.
    const fieldIndex: Partial<Record<keyof ForeclosureLeadInput, number>> = {};
    headers.forEach((h, i) => {
      const field = HEADER_MAP[normH(h)];
      if (field && fieldIndex[field] === undefined) fieldIndex[field] = i;
    });
    const repeats = repeatIndexes(headers);

    let created = 0;
    let skipped = 0;
    const errors: { row: number; reason: string }[] = [];

    for (let i = 0; i < rows.length; i++) {
      try {
        const input = this.rowToInput(rows[i], fieldIndex, repeats);
        const res = await this.foreclosures.createForeclosureLead(input, {
          organizationId: opts.organizationId,
        });
        if (res.created) created++;
        else skipped++;
      } catch (err: any) {
        this.logger.warn(`Foreclosure import row ${i + 2} failed: ${err.message}`);
        errors.push({ row: i + 2, reason: err.message });
      }
    }

    return { created, skipped, errors };
  }

  private readSheet(buffer: Buffer): { headers: string[]; rows: any[][] } {
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const data: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: false });
    if (data.length < 2) throw new Error('File must contain a header row and at least one data row');
    const headers = (data[0] as any[]).map((h) => String(h).trim());
    const rows = data.slice(1).filter((r) => r.some((c: any) => c !== '' && c != null));
    return { headers, rows };
  }

  private rowToInput(
    row: any[],
    idx: Partial<Record<keyof ForeclosureLeadInput, number>>,
    repeats: RepeatIndex,
  ): ForeclosureLeadInput {
    const cell = (i: number | undefined): string => {
      if (i === undefined) return '';
      const v = row[i];
      return v == null ? '' : String(v).trim();
    };
    const g = (field: keyof ForeclosureLeadInput): string => cell(idx[field]);

    // Potential Equity is only a percentage when the cell carries a % sign.
    const equityRaw = g('equityPct');
    const equityPct = equityRaw.indexOf('%') >= 0 ? parseNum(equityRaw) : null;

    // Owner Occupied -> single Y/N char.
    const occ = g('ownerOccupied').toUpperCase().slice(0, 1);

    const [p1, p2, p3, p4] = this.collectPhones(cell, idx, repeats);
    const [e1, e2] = this.collectEmails(cell, idx, repeats);

    return {
      sourceKind: ForeclosureSourceKind.IMPORT,
      dateAdded: g('dateAdded'),
      priority: g('priority'),
      noticeType: this.normalizeNoticeType(g('noticeType')),
      address: g('address'),
      city: g('city'),
      state: g('state'),
      zip: g('zip'),
      county: g('county'),
      propertyType: g('propertyType'),
      bedrooms: parseNum(g('bedrooms')),
      bathrooms: parseNum(g('bathrooms')),
      sqft: parseNum(g('sqft')),
      yearBuilt: parseNum(g('yearBuilt')),
      ownerNames: g('ownerNames'),
      ownerFirstName: g('ownerFirstName'),
      ownerLastName: g('ownerLastName'),
      caseNumber: g('caseNumber'),
      saleDate: g('saleDate'),
      hearingDate: g('hearingDate'),
      loanDate: g('loanDate'),
      loanAmount: parseNum(g('loanAmount')),
      noticeUrl: g('noticeUrl'),
      mailingAddress: g('mailingAddress'),
      notes: g('notes'),
      skipStatus: g('skipStatus'),
      countyOwner: g('countyOwner').replace(/[;\s]+$/, ''),
      mailCity: g('mailCity'),
      mailState: g('mailState'),
      mailZip: g('mailZip'),
      assessedValue: parseNum(g('assessedValue')),
      equityPct,
      ownerOccupied: occ === 'Y' || occ === 'N' ? occ : undefined,
      phone1: p1?.num,
      phone1Type: p1?.type ?? undefined,
      phone2: p2?.num,
      phone2Type: p2?.type ?? undefined,
      phone3: p3?.num,
      phone3Type: p3?.type ?? undefined,
      phone4: p4?.num,
      phone4Type: p4?.type ?? undefined,
      email: e1,
      email2: e2,
    };
  }

  /**
   * Fold every phone column in the row into the four slots the schema holds,
   * in call priority: the sheet's own primary first, then mobiles (the only
   * ones we can text), then any further fixed Phone2-4, then landlines.
   * Deduped on the 10-digit form because these lists repeat a number across
   * columns (a primary that is also Landline-2, for example).
   */
  private collectPhones(
    cell: (i: number | undefined) => string,
    idx: Partial<Record<keyof ForeclosureLeadInput, number>>,
    repeats: RepeatIndex,
  ): { num: string; type: string | null }[] {
    const candidates: { raw: string; type: string | null }[] = [
      { raw: cell(idx.phone1), type: cell(idx.phone1Type) },
      ...repeats.mobiles.map((i) => ({ raw: cell(i), type: 'Mobile' })),
      { raw: cell(idx.phone2), type: cell(idx.phone2Type) },
      { raw: cell(idx.phone3), type: cell(idx.phone3Type) },
      { raw: cell(idx.phone4), type: cell(idx.phone4Type) },
      ...repeats.landlines.map((i) => ({ raw: cell(i), type: 'Landline' })),
    ];

    const seen = new Set<string>();
    const out: { num: string; type: string | null }[] = [];
    for (const c of candidates) {
      const num = normalizePhoneDigits(c.raw);
      if (!num || seen.has(num)) continue;
      seen.add(num);
      // A type column wins; otherwise fall back to a type written into the
      // number cell itself, e.g. "7045551234 (Mobile)".
      out.push({ num, type: phoneTypeOf(c.type) || phoneTypeOf(c.raw) });
      if (out.length === 4) break;
    }
    return out;
  }

  /** Same idea for emails, which the schema holds two of. */
  private collectEmails(
    cell: (i: number | undefined) => string,
    idx: Partial<Record<keyof ForeclosureLeadInput, number>>,
    repeats: RepeatIndex,
  ): string[] {
    const candidates = [cell(idx.email), ...repeats.emails.map((i) => cell(i))];
    const seen = new Set<string>();
    const out: string[] = [];
    for (const raw of candidates) {
      if (!raw || raw.indexOf('@') < 0) continue;
      const key = raw.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(raw);
      if (out.length === 2) break;
    }
    return out;
  }

  /** Map free-text notice type into the canonical snake_case token. */
  private normalizeNoticeType(raw: string): string {
    const t = raw.toLowerCase().replace(/\s+/g, '_');
    if (!t) return '';
    if (t.includes('auction')) return 'auction_com_foreclosure';
    if (t.includes('hoa') || t.includes('lien')) return 'hoa_lien';
    if (t.includes('tax')) return 'tax_foreclosure';
    if (t.includes('sheriff')) return 'sheriff_sale';
    if (t.includes('hearing')) return 'pre_foreclosure_hearing';
    if (t.includes('mortgage') || t.includes('foreclosure')) return 'mortgage_foreclosure';
    return t;
  }
}

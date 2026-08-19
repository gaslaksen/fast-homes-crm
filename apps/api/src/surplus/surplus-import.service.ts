import { Injectable, Logger } from '@nestjs/common';
import * as XLSX from 'xlsx';
import { SurplusService } from './surplus.service';
import { SurplusLeadInput } from './surplus.types';
import { SurplusLien } from './surplus.util';
import { SURPLUS_FLOOR } from './surplus-compliance';
import { cellText, parseNum, normalizePhoneDigits, phoneTypeOf, parseListDate } from '../probate/probate.util';

function normH(h: any): string {
  return String(h || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Normalized header -> SurplusLeadInput field.
 *
 * Florida clerks publish unclaimed-surplus lists in wildly different shapes,
 * county by county, so this covers the spellings seen so far plus the column
 * names the board's own CSV export uses, which means a file exported from
 * Dealcore imports straight back in.
 */
const HEADER_MAP: Record<string, keyof SurplusLeadInput> = {
  county: 'county',
  case: 'caseNumber',
  caseno: 'caseNumber',
  casenumber: 'caseNumber',
  courtcase: 'caseNumber',
  taxdeednumber: 'caseNumber',

  address: 'address',
  propertyaddress: 'address',
  propertystreet: 'address',
  city: 'city',
  propertycity: 'city',
  state: 'state',
  zip: 'zip',
  zipcode: 'zip',
  parcel: 'parcelId',
  parcelid: 'parcelId',
  parcelnumber: 'parcelId',

  claimant: 'claimant',
  claimantname: 'claimant',
  owner: 'claimant',
  ownername: 'claimant',
  formerowner: 'claimant',
  previousowner: 'claimant',
  claimanttype: 'claimantType',

  deceased: 'deceased',
  isdeceased: 'deceased',
  heirsrequired: 'heirsRequired',
  competinglien: 'competingLien',
  competinglienfiled: 'competingLien',

  surplustype: 'surplusType',
  saletype: 'surplusType',
  fundlocation: 'fundLocation',
  fundsheldby: 'fundLocation',

  saledate: 'saleDate',
  dateofsale: 'saleDate',
  saleprice: 'salePrice',
  soldfor: 'salePrice',
  noticedate: 'noticeDate',
  noticeofsurplus: 'noticeDate',
  noticeconfirmed: 'noticeConfirmed',
  certofdisbursements: 'certOfDisbursements',
  certificateofdisbursements: 'certOfDisbursements',

  grosssurplus: 'grossSurplus',
  surplus: 'grossSurplus',
  surplusamount: 'grossSurplus',
  unclaimedamount: 'grossSurplus',
  overage: 'grossSurplus',

  arrangement: 'arrangement',
  totalconsideration: 'totalConsideration',
  licensedrepid: 'licensedRepId',

  stage: 'stage',
  status: 'stage',
  notes: 'notes',
};

const PHONE_HEADERS = [
  ['phone', 'phone1', 'bestphone', 'primaryphone'],
  ['phone2', 'secondphone', 'altphone'],
  ['phone3'],
  ['phone4'],
];
const PHONE_TYPE_HEADERS = [['phone1type', 'phonetype'], ['phone2type'], ['phone3type'], ['phone4type']];
const EMAIL_HEADERS = [['email', 'email1', 'bestemail'], ['email2', 'secondemail']];

/** Up to four lien columns, read as triples. */
const LIEN_HEADERS = [
  { type: ['lien1type', 'lientype'], holder: ['lien1holder', 'lienholder'], amount: ['lien1amount', 'lienamount'], gov: ['lien1governmental'] },
  { type: ['lien2type'], holder: ['lien2holder'], amount: ['lien2amount'], gov: ['lien2governmental'] },
  { type: ['lien3type'], holder: ['lien3holder'], amount: ['lien3amount'], gov: ['lien3governmental'] },
  { type: ['lien4type'], holder: ['lien4holder'], amount: ['lien4amount'], gov: ['lien4governmental'] },
];

/** Without these two there is no claim and no dedupe key. */
const ANCHOR_FIELDS: (keyof SurplusLeadInput)[] = ['claimant', 'grossSurplus'];

export interface SurplusImportResult {
  created: number;
  duplicates: number;
  /** Rows dropped for sitting under the surplus floor, counted rather than errored. */
  belowFloor: number;
  errors: { row: number; reason: string }[];
}

@Injectable()
export class SurplusImportService {
  private readonly logger = new Logger(SurplusImportService.name);

  constructor(private surplus: SurplusService) {}

  async parseUpload(buffer: Buffer) {
    const { sheetName, headers, rows } = this.readSheet(buffer);
    const idx = this.fieldIndex(headers);
    const parsed = rows.map((r) => this.rowToInput(r, headers, idx));
    return {
      sheetName,
      headers,
      totalRows: rows.length,
      matchedColumns: Object.keys(idx).length,
      unmatchedHeaders: headers.filter((h) => !HEADER_MAP[normH(h)] && !this.isExtraHeader(h)),
      belowFloor: parsed.filter((p) => (p.grossSurplus || 0) < SURPLUS_FLOOR).length,
      surplusFloor: SURPLUS_FLOOR,
      sample: parsed.slice(0, 5),
    };
  }

  async executeImport(
    buffer: Buffer,
    opts: { organizationId?: string | null; importBatch?: string; dryRun?: boolean },
  ): Promise<SurplusImportResult> {
    const { headers, rows } = this.readSheet(buffer);
    const idx = this.fieldIndex(headers);

    const missing = ANCHOR_FIELDS.filter((f) => idx[f] === undefined);
    if (missing.length > 0) {
      throw new Error(
        `Sheet is missing required columns for: ${missing.join(', ')}. ` +
          `Found headers: ${headers.join(', ')}`,
      );
    }

    const result: SurplusImportResult = { created: 0, duplicates: 0, belowFloor: 0, errors: [] };

    for (let i = 0; i < rows.length; i++) {
      const rowNo = i + 2;
      try {
        const input = this.rowToInput(rows[i], headers, idx);
        input.importBatch = opts.importBatch;

        if ((input.grossSurplus || 0) < SURPLUS_FLOOR) {
          result.belowFloor++;
          continue;
        }
        if (!cellText(input.claimant)) {
          result.errors.push({ row: rowNo, reason: 'missing claimant name' });
          continue;
        }
        if (opts.dryRun) {
          result.created++;
          continue;
        }

        const res = await this.surplus.createSurplusLead(input, {
          organizationId: opts.organizationId,
        });
        if (!res.created) {
          if (res.reason === 'duplicate') result.duplicates++;
          else if (res.reason === 'below the surplus floor') result.belowFloor++;
          else result.errors.push({ row: rowNo, reason: res.reason || 'not created' });
          continue;
        }
        result.created++;
      } catch (err: any) {
        this.logger.warn(`Surplus import row ${rowNo} failed: ${err.message}`);
        result.errors.push({ row: rowNo, reason: err.message });
      }
    }

    return result;
  }

  private readSheet(buffer: Buffer): { sheetName: string; headers: string[]; rows: any[][] } {
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    let best: { sheetName: string; headers: string[]; rows: any[][]; score: number } | null = null;

    for (const name of workbook.SheetNames) {
      const data: any[][] = XLSX.utils.sheet_to_json(workbook.Sheets[name], {
        header: 1,
        defval: '',
        raw: false,
      });
      if (data.length < 2) continue;
      const headers = (data[0] as any[]).map((h) => String(h).trim());
      const score = headers.filter((h) => !!HEADER_MAP[normH(h)] || this.isExtraHeader(h)).length;
      if (!best || score > best.score) {
        const rows = data.slice(1).filter((r) => r.some((c: any) => c !== '' && c != null));
        best = { sheetName: name, headers, rows, score };
      }
    }

    if (!best || best.score === 0) {
      throw new Error('No sheet in this file has recognizable surplus columns');
    }
    return { sheetName: best.sheetName, headers: best.headers, rows: best.rows };
  }

  private isExtraHeader(h: string): boolean {
    const n = normH(h);
    const lien = LIEN_HEADERS.flatMap((l) => [...l.type, ...l.holder, ...l.amount, ...l.gov]);
    return [
      ...PHONE_HEADERS.flat(),
      ...PHONE_TYPE_HEADERS.flat(),
      ...EMAIL_HEADERS.flat(),
      ...lien,
    ].includes(n);
  }

  private fieldIndex(headers: string[]): Partial<Record<keyof SurplusLeadInput, number>> {
    const idx: Partial<Record<keyof SurplusLeadInput, number>> = {};
    headers.forEach((h, i) => {
      const field = HEADER_MAP[normH(h)];
      if (field && idx[field] === undefined) idx[field] = i;
    });
    return idx;
  }

  private colFor(headers: string[], names: string[]): number | undefined {
    for (let i = 0; i < headers.length; i++) {
      if (names.includes(normH(headers[i]))) return i;
    }
    return undefined;
  }

  private rowToInput(
    row: any[],
    headers: string[],
    idx: Partial<Record<keyof SurplusLeadInput, number>>,
  ): SurplusLeadInput {
    const g = (field: keyof SurplusLeadInput): string => {
      const i = idx[field];
      return i === undefined ? '' : cellText(row[i]);
    };
    const truthy = (v: string) => /^(y|yes|true|1|x)$/i.test(v.trim());

    const phones: SurplusLeadInput['phones'] = [];
    for (let i = 0; i < PHONE_HEADERS.length; i++) {
      const col = this.colFor(headers, PHONE_HEADERS[i]);
      const num = col === undefined ? null : normalizePhoneDigits(row[col]);
      if (!num) continue;
      const typeCol = this.colFor(headers, PHONE_TYPE_HEADERS[i]);
      phones.push({ number: num, type: typeCol === undefined ? null : phoneTypeOf(row[typeCol]) });
    }

    const emails: string[] = [];
    for (const names of EMAIL_HEADERS) {
      const col = this.colFor(headers, names);
      const v = col === undefined ? '' : cellText(row[col]);
      if (v) emails.push(v);
    }

    const liens: SurplusLien[] = [];
    LIEN_HEADERS.forEach((spec, i) => {
      const amountCol = this.colFor(headers, spec.amount);
      const amount = amountCol === undefined ? null : parseNum(row[amountCol]);
      if (!amount) return;
      const typeCol = this.colFor(headers, spec.type);
      const holderCol = this.colFor(headers, spec.holder);
      const govCol = this.colFor(headers, spec.gov);
      const holder = holderCol === undefined ? '' : cellText(row[holderCol]);
      const type = typeCol === undefined ? '' : cellText(row[typeCol]);
      liens.push({
        type: type || 'Lien',
        holder,
        amount,
        priority: i + 1,
        // A sheet that flags it wins. Failing that, the holder's own name is
        // the only signal available, and getting this wrong only reorders the
        // waterfall display, never the total.
        governmental:
          govCol !== undefined
            ? truthy(cellText(row[govCol]))
            : /county|city|state|municipal|clerk|utilit|code enforce/i.test(`${holder} ${type}`),
      });
    });

    return {
      address: g('address'),
      city: g('city'),
      state: g('state') || 'FL',
      zip: g('zip'),
      county: g('county'),
      parcelId: g('parcelId'),
      caseNumber: g('caseNumber'),

      claimant: g('claimant'),
      claimantType: g('claimantType'),
      deceased: truthy(g('deceased')),
      heirsRequired: truthy(g('heirsRequired')),
      competingLien: truthy(g('competingLien')),

      surplusType: /mortgage|45\.033|foreclos/i.test(g('surplusType'))
        ? 'mortgage_foreclosure'
        : 'tax_deed',
      fundLocation: /escheat|state|dfs|717/i.test(g('fundLocation')) ? 'state_escheated' : 'clerk',

      saleDate: this.toIso(g('saleDate')),
      salePrice: parseNum(g('salePrice')),
      noticeDate: this.toIso(g('noticeDate')),
      noticeConfirmed: truthy(g('noticeConfirmed')),
      certOfDisbursements: this.toIso(g('certOfDisbursements')),

      grossSurplus: parseNum(g('grossSurplus')),
      liens,

      arrangement: /poa|attorney/i.test(g('arrangement')) ? 'limited_poa' : 'assignment',
      totalConsideration: parseNum(g('totalConsideration')),
      licensedRepId: g('licensedRepId') || null,

      stage: g('stage'),
      notes: g('notes'),

      phones,
      emails,
    };
  }

  /** "2026-04-01", "4/1/2026" and "Apr 1, 2026" all land on the same ISO date. */
  private toIso(raw: string): string | null {
    if (!raw) return null;
    const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw);
    if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
    const named = parseListDate(raw);
    if (named) return named;
    const slash = /^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/.exec(raw.trim());
    if (slash) {
      const year = slash[3].length === 2 ? `20${slash[3]}` : slash[3];
      return `${year}-${slash[1].padStart(2, '0')}-${slash[2].padStart(2, '0')}`;
    }
    return null;
  }
}

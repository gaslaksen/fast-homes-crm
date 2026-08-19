import { Injectable, Logger } from '@nestjs/common';
import * as XLSX from 'xlsx';
import { TaxSalesService } from './tax-sales.service';
import { TaxSaleLeadInput } from './tax-sales.types';
import { parseDelinquentYears } from './tax-sale.util';
import { cellText, parseNum, normalizePhoneDigits, phoneTypeOf, parseListDate } from '../probate/probate.util';

/** Header cell to lookup key: lowercase, alphanumerics only. */
function normH(h: any): string {
  return String(h || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Normalized header -> TaxSaleLeadInput field.
 *
 * Counties publish these lists in whatever their tax software exports, so this
 * covers the spellings seen across Mecklenburg and Union plus the column names
 * the board's own CSV export uses, which means a file exported from Dealcore
 * imports straight back in. Where a sheet carries two columns for one field,
 * the leftmost wins.
 */
const HEADER_MAP: Record<string, keyof TaxSaleLeadInput> = {
  address: 'address',
  propertyaddress: 'address',
  propertystreet: 'address',
  situsaddress: 'address',
  streetaddress: 'address',
  city: 'city',
  propertycity: 'city',
  state: 'state',
  propertystate: 'state',
  zip: 'zip',
  zipcode: 'zip',
  propertyzip: 'zip',
  county: 'county',

  parcel: 'parcelId',
  parcelid: 'parcelId',
  parcelnumber: 'parcelId',
  pid: 'parcelId',
  apn: 'parcelId',

  fileno: 'fileNumber',
  filenumber: 'fileNumber',
  casenumber: 'fileNumber',
  caseno: 'fileNumber',
  docket: 'fileNumber',

  method: 'method',
  track: 'method',
  foreclosuremethod: 'method',
  saletype: 'method',
  statute: 'statute',
  ncgs: 'statute',
  deed: 'deedType',
  deedonsale: 'deedType',
  deedtype: 'deedType',
  filedby: 'filedBy',
  handledby: 'filedBy',
  plaintiff: 'filedBy',
  attorney: 'filedBy',
  firm: 'filedBy',

  owner: 'owner',
  ownername: 'owner',
  ownernames: 'owner',
  taxpayer: 'owner',
  propertytype: 'propertyType',
  acreage: 'acreage',
  acres: 'acreage',
  ownedsince: 'ownedSince',
  occupancy: 'occupancy',
  owneroccupied: 'occupancy',

  saledate: 'saleDate',
  dateofsale: 'saleDate',
  upsetdeadline: 'upsetDeadline',
  upsetbiddeadline: 'upsetDeadline',

  assessed: 'assessedValue',
  assessedvalue: 'assessedValue',
  taxvalue: 'assessedValue',
  taxesowed: 'taxesOwed',
  delinquenttaxes: 'taxesOwed',
  taxdue: 'taxesOwed',
  redemption: 'redemptionAmount',
  redemptionamount: 'redemptionAmount',
  redemptionpayoff: 'redemptionAmount',
  payoff: 'redemptionAmount',
  totaldue: 'redemptionAmount',
  openingbid: 'openingBid',
  minimumbid: 'openingBid',
  minbid: 'openingBid',
  currentbid: 'currentBid',
  standingbid: 'currentBid',
  depositpct: 'depositPct',
  depositatsale: 'depositPct',

  delinquentyears: 'delinquentYears',
  taxyears: 'delinquentYears',
  yearsdelinquent: 'delinquentYears',
  yearsbehind: 'delinquentYears',

  citytaxes: 'cityTaxes',
  mortgage: 'hasMortgage',
  hasmortgage: 'hasMortgage',
  mortgageontitle: 'hasMortgage',
  irslien: 'hasIrsLien',
  hasirslien: 'hasIrsLien',

  stage: 'stage',
  status: 'workStatus',
  workstatus: 'workStatus',
  tags: 'tags',
  notes: 'notes',
  callnotes: 'notes',

  dncscrub: 'dncScrubbedAt',
  dncscrubbedat: 'dncScrubbedAt',
  scrubbedat: 'dncScrubbedAt',
};

/** Phone and email columns, read positionally rather than through the map. */
const PHONE_HEADERS = [
  ['phone', 'phone1', 'bestphone', 'primaryphone'],
  ['phone2', 'secondphone', 'altphone'],
  ['phone3'],
  ['phone4'],
];
const PHONE_TYPE_HEADERS = [
  ['phone1type', 'phonetype', 'bestphonetype'],
  ['phone2type'],
  ['phone3type'],
  ['phone4type'],
];
const PHONE_DNC_HEADERS = [
  ['phone1dnc', 'dnc', 'dncstatus'],
  ['phone2dnc'],
  ['phone3dnc'],
  ['phone4dnc'],
];
const EMAIL_HEADERS = [
  ['email', 'email1', 'bestemail'],
  ['email2', 'secondemail'],
];

/** Without an address there is nothing to dedupe on and nothing to look up. */
const ANCHOR_FIELDS: (keyof TaxSaleLeadInput)[] = ['address'];

export interface TaxSaleImportResult {
  created: number;
  duplicates: number;
  errors: { row: number; reason: string }[];
}

@Injectable()
export class TaxSaleImportService {
  private readonly logger = new Logger(TaxSaleImportService.name);

  constructor(private taxSales: TaxSalesService) {}

  /** Headers and a few sample rows, without writing anything. */
  async parseUpload(buffer: Buffer) {
    const { sheetName, headers, rows } = this.readSheet(buffer);
    const idx = this.fieldIndex(headers);
    const matched = Object.keys(idx).length;
    return {
      sheetName,
      headers,
      totalRows: rows.length,
      matchedColumns: matched,
      unmatchedHeaders: headers.filter((h) => !HEADER_MAP[normH(h)] && !this.isContactHeader(h)),
      sample: rows.slice(0, 5).map((r) => this.rowToInput(r, headers, idx)),
    };
  }

  async executeImport(
    buffer: Buffer,
    opts: { organizationId?: string | null; importBatch?: string; dryRun?: boolean },
  ): Promise<TaxSaleImportResult> {
    const { headers, rows } = this.readSheet(buffer);
    const idx = this.fieldIndex(headers);

    const missing = ANCHOR_FIELDS.filter((f) => idx[f] === undefined);
    if (missing.length > 0) {
      throw new Error(
        `Sheet is missing required columns for: ${missing.join(', ')}. ` +
          `Found headers: ${headers.join(', ')}`,
      );
    }

    const result: TaxSaleImportResult = { created: 0, duplicates: 0, errors: [] };

    for (let i = 0; i < rows.length; i++) {
      // +2 so the reported row number matches what the user sees in the sheet:
      // one for the header row, one for 1-based numbering.
      const rowNo = i + 2;
      try {
        const input = this.rowToInput(rows[i], headers, idx);
        input.importBatch = opts.importBatch;

        if (!cellText(input.address)) {
          result.errors.push({ row: rowNo, reason: 'missing property address' });
          continue;
        }
        if (opts.dryRun) {
          result.created++;
          continue;
        }

        const res = await this.taxSales.createTaxSaleLead(input, {
          organizationId: opts.organizationId,
        });
        if (!res.created) {
          if (res.reason === 'duplicate') result.duplicates++;
          else result.errors.push({ row: rowNo, reason: res.reason || 'not created' });
          continue;
        }
        result.created++;
      } catch (err: any) {
        this.logger.warn(`Tax sale import row ${rowNo} failed: ${err.message}`);
        result.errors.push({ row: rowNo, reason: err.message });
      }
    }

    return result;
  }

  /**
   * Pick the sheet that actually holds the list. County exports routinely ship
   * a cover or summary tab first, so SheetNames[0] is the wrong default: score
   * every sheet by how many tax sale columns its header row has, take the best.
   */
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
      const score = headers.filter(
        (h) => !!HEADER_MAP[normH(h)] || this.isContactHeader(h),
      ).length;
      if (!best || score > best.score) {
        const rows = data.slice(1).filter((r) => r.some((c: any) => c !== '' && c != null));
        best = { sheetName: name, headers, rows, score };
      }
    }

    if (!best || best.score === 0) {
      throw new Error('No sheet in this file has recognizable tax sale columns');
    }
    return { sheetName: best.sheetName, headers: best.headers, rows: best.rows };
  }

  private isContactHeader(h: string): boolean {
    const n = normH(h);
    return [
      ...PHONE_HEADERS.flat(),
      ...PHONE_TYPE_HEADERS.flat(),
      ...PHONE_DNC_HEADERS.flat(),
      ...EMAIL_HEADERS.flat(),
    ].includes(n);
  }

  private fieldIndex(headers: string[]): Partial<Record<keyof TaxSaleLeadInput, number>> {
    const idx: Partial<Record<keyof TaxSaleLeadInput, number>> = {};
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
    idx: Partial<Record<keyof TaxSaleLeadInput, number>>,
  ): TaxSaleLeadInput {
    const g = (field: keyof TaxSaleLeadInput): string => {
      const i = idx[field];
      return i === undefined ? '' : cellText(row[i]);
    };
    const truthy = (v: string) => /^(y|yes|true|1|x)$/i.test(v.trim());

    const phones: TaxSaleLeadInput['phones'] = [];
    for (let i = 0; i < PHONE_HEADERS.length; i++) {
      const col = this.colFor(headers, PHONE_HEADERS[i]);
      const num = col === undefined ? null : normalizePhoneDigits(row[col]);
      if (!num) continue;
      const typeCol = this.colFor(headers, PHONE_TYPE_HEADERS[i]);
      const dncCol = this.colFor(headers, PHONE_DNC_HEADERS[i]);
      const dncRaw = dncCol === undefined ? '' : cellText(row[dncCol]).toLowerCase();
      phones.push({
        number: num,
        type: typeCol === undefined ? null : phoneTypeOf(row[typeCol]),
        // A registry name if the sheet gives one, otherwise a plain yes marks
        // it federal, which is the conservative reading of an unlabelled flag.
        dnc: /litig/.test(dncRaw)
          ? 'litigator'
          : /state/.test(dncRaw)
            ? 'state'
            : /fed|dnc|y|yes|true|1/.test(dncRaw) && dncRaw !== ''
              ? 'federal'
              : null,
      });
    }

    const emails: string[] = [];
    for (const names of EMAIL_HEADERS) {
      const col = this.colFor(headers, names);
      const v = col === undefined ? '' : cellText(row[col]);
      if (v) emails.push(v);
    }

    const rawSale = g('saleDate');
    const rawUpset = g('upsetDeadline');
    const rawScrub = g('dncScrubbedAt');

    const tagsRaw = g('tags');

    return {
      address: g('address'),
      city: g('city'),
      state: g('state'),
      zip: g('zip'),
      county: g('county'),
      parcelId: g('parcelId'),

      fileNumber: g('fileNumber'),
      method: g('method') || g('statute') || g('filedBy'),
      statute: g('statute'),
      deedType: g('deedType'),
      filedBy: g('filedBy'),

      owner: g('owner'),
      propertyType: g('propertyType'),
      acreage: parseNum(g('acreage')),
      ownedSince: g('ownedSince'),
      occupancy: g('occupancy'),

      saleDate: this.toIso(rawSale),
      upsetDeadline: this.toIso(rawUpset),

      assessedValue: parseNum(g('assessedValue')),
      taxesOwed: parseNum(g('taxesOwed')),
      redemptionAmount: parseNum(g('redemptionAmount')),
      openingBid: parseNum(g('openingBid')),
      currentBid: parseNum(g('currentBid')),
      depositPct: parseNum(g('depositPct')),
      delinquentYears: parseDelinquentYears(g('delinquentYears')),

      cityTaxes: truthy(g('cityTaxes')),
      hasMortgage: truthy(g('hasMortgage')),
      hasIrsLien: truthy(g('hasIrsLien')),

      stage: g('stage'),
      workStatus: g('workStatus'),
      tags: tagsRaw ? tagsRaw.split(/[,;|]/).map((t) => t.trim()).filter(Boolean) : [],
      notes: g('notes'),

      phones,
      emails,
      dncScrubbedAt: this.toIso(rawScrub),
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

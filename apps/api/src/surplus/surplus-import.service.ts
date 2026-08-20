import { Injectable, Logger } from '@nestjs/common';
import * as XLSX from 'xlsx';
import { SurplusService } from './surplus.service';
import { SurplusLeadInput, SurplusPhoneInput } from './surplus.types';
import { SurplusLien, nameMatchesClaimant } from './surplus.util';
import { SURPLUS_FLOOR } from './surplus-compliance';
import { cellText, parseNum, normalizePhoneDigits, phoneTypeOf, parseListDate } from '../probate/probate.util';

function normH(h: any): string {
  return String(h || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

const truthy = (v: any) => /^(y|yes|true|1|x)$/i.test(String(v ?? '').trim());

/**
 * Normalized header -> SurplusLeadInput field.
 *
 * Florida clerks publish unclaimed-surplus lists in wildly different shapes,
 * and the lists are then run through a skip-trace vendor before anyone works
 * them, so what actually lands here is a clerk export with a wide block of
 * `Skiptrace:*` columns bolted on the right. This covers both halves, plus the
 * column names the board's own CSV export uses, so a file exported from
 * Dealcore imports straight back in.
 *
 * The claimant name, the phones and the emails are NOT in this map: they are
 * spread across several columns each and are read positionally below.
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
  propertystate: 'state',
  zip: 'zip',
  zipcode: 'zip',
  propertyzip: 'zip',
  parcel: 'parcelId',
  parcelid: 'parcelId',
  parcelnumber: 'parcelId',

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

/** The claimant's name, in the several shapes these files carry it. */
const NAME_HEADERS = {
  first: ['firstname', 'claimantfirstname', 'ownerfirstname', 'inputdatafirstname'],
  last: ['lastname', 'claimantlastname', 'ownerlastname', 'inputdatalastname'],
  /** A single column holding the whole name, which wins when there is one. */
  full: ['claimant', 'claimantname', 'owner', 'ownername', 'formerowner', 'previousowner'],
  /** The tax roll's spelling, e.g. "HILL TAMMIE LEE". Last resort. */
  roll: ['ownernameroll'],
};

/** A plain clerk export's own contact columns. */
const PHONE_HEADERS = [
  ['phone', 'phone1', 'bestphone', 'primaryphone'],
  ['phone2', 'secondphone', 'altphone'],
  ['phone3'],
  ['phone4'],
];
const PHONE_TYPE_HEADERS = [['phone1type', 'phonetype'], ['phone2type'], ['phone3type'], ['phone4type']];
const PHONE_DNC_HEADERS = [['phone1dnc', 'dnc', 'dncstatus'], ['phone2dnc'], ['phone3dnc'], ['phone4dnc']];
const EMAIL_HEADERS = [['email', 'email1', 'bestemail'], ['email2', 'secondemail']];

/**
 * The skip-trace vendor's block. Indexed from 0 and up to five numbers wide,
 * which is more than the four a lead holds, so the surplus these lists carry
 * gets filtered rather than truncated arbitrarily.
 */
const SKIP = {
  phone: (n: number) => [`skiptracephonenumbers${n}number`],
  phoneType: (n: number) => [`skiptracephonenumbers${n}type`],
  phoneDnc: (n: number) => [`skiptracephonenumbers${n}dnc`],
  phoneScore: (n: number) => [`skiptracephonenumbers${n}score`],
  email: (n: number) => [`skiptraceemails${n}email`],
  first: ['skiptracenamefirst'],
  last: ['skiptracenamelast'],
  litigator: ['skiptracelitigator'],
  deceased: ['skiptracedeathdeceased'],
  tcpa: ['skiptracednctcpa'],
  county: ['skiptracepropertyaddresscounty'],
};
const SKIP_PHONE_SLOTS = 5;
const SKIP_EMAIL_SLOTS = 3;

/** Up to four lien columns, read as groups. */
const LIEN_HEADERS = [
  { type: ['lien1type', 'lientype'], holder: ['lien1holder', 'lienholder'], amount: ['lien1amount', 'lienamount'], gov: ['lien1governmental'] },
  { type: ['lien2type'], holder: ['lien2holder'], amount: ['lien2amount'], gov: ['lien2governmental'] },
  { type: ['lien3type'], holder: ['lien3holder'], amount: ['lien3amount'], gov: ['lien3governmental'] },
  { type: ['lien4type'], holder: ['lien4holder'], amount: ['lien4amount'], gov: ['lien4governmental'] },
];

/** The list's own banding, e.g. "A - Estate / heirs". Carried into the notes. */
const SEGMENT_HEADERS = ['segment', 'band', 'tier'];

export interface SurplusImportResult {
  created: number;
  duplicates: number;
  /** Rows dropped for sitting under the surplus floor, counted rather than errored. */
  belowFloor: number;
  /**
   * Rows imported with NO contacts because the skip trace came back with
   * somebody else's name. The lead is kept; the wrong contacts are discarded.
   */
  contactMismatches: { row: number; claimant: string; returned: string }[];
  /** Rows whose county was taken from the rest of the file. */
  countyInferred: number;
  errors: { row: number; reason: string }[];
}

@Injectable()
export class SurplusImportService {
  private readonly logger = new Logger(SurplusImportService.name);

  constructor(private surplus: SurplusService) {}

  async parseUpload(buffer: Buffer) {
    const { sheetName, headers, rows } = this.readSheet(buffer);
    const idx = this.fieldIndex(headers);
    const fallbackCounty = this.dominantCounty(rows, headers, idx);
    const parsed = rows.map((r) => this.rowToInput(r, headers, idx, fallbackCounty));
    return {
      sheetName,
      headers,
      totalRows: rows.length,
      matchedColumns: Object.keys(idx).length,
      unmatchedHeaders: headers.filter((h) => !HEADER_MAP[normH(h)] && !this.isExtraHeader(h)),
      belowFloor: parsed.filter((p) => (p.grossSurplus || 0) < SURPLUS_FLOOR).length,
      contactMismatches: parsed.filter((p) => p.contactMismatch).length,
      surplusFloor: SURPLUS_FLOOR,
      inferredCounty: fallbackCounty || null,
      sample: parsed.slice(0, 5),
    };
  }

  async executeImport(
    buffer: Buffer,
    opts: { organizationId?: string | null; importBatch?: string; dryRun?: boolean; county?: string },
  ): Promise<SurplusImportResult> {
    const { headers, rows } = this.readSheet(buffer);
    const idx = this.fieldIndex(headers);

    if (!this.canReadClaimant(headers, idx)) {
      throw new Error(
        'Sheet has no claimant name. Expected a "Claimant" or "Owner Name" column, ' +
          'or a "First Name" and "Last Name" pair. ' +
          `Found headers: ${headers.join(', ')}`,
      );
    }
    if (idx.grossSurplus === undefined) {
      throw new Error(
        'Sheet has no surplus amount. Expected a "Surplus Amount", "Gross Surplus" or "Overage" column. ' +
          `Found headers: ${headers.join(', ')}`,
      );
    }

    // A clerk export covers one county. When only some rows carry it (it often
    // arrives on the skip-trace side, which can come back empty), the rest of
    // the file is the best available source rather than leaving the lead with
    // no county at all, which would hide it behind every county filter.
    const fallbackCounty = cellText(opts.county) || this.dominantCounty(rows, headers, idx);

    const result: SurplusImportResult = {
      created: 0,
      duplicates: 0,
      belowFloor: 0,
      contactMismatches: [],
      countyInferred: 0,
      errors: [],
    };

    for (let i = 0; i < rows.length; i++) {
      const rowNo = i + 2;
      try {
        const input = this.rowToInput(rows[i], headers, idx, fallbackCounty);
        input.importBatch = opts.importBatch;

        if ((input.grossSurplus || 0) < SURPLUS_FLOOR) {
          result.belowFloor++;
          continue;
        }
        if (!cellText(input.claimant)) {
          result.errors.push({ row: rowNo, reason: 'missing claimant name' });
          continue;
        }
        if (input.contactMismatch) {
          result.contactMismatches.push({
            row: rowNo,
            claimant: input.claimant,
            returned: input.mismatchedName || 'a different name',
          });
        }
        if (this.countyWasInferred(rows[i], headers, idx)) result.countyInferred++;

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

    if (result.contactMismatches.length) {
      this.logger.warn(
        `Surplus import: ${result.contactMismatches.length} row(s) had a skip trace for ` +
          'a different person; their contacts were discarded.',
      );
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

  /** Headers read positionally rather than through HEADER_MAP. */
  private isExtraHeader(h: string): boolean {
    const n = normH(h);
    const lien = LIEN_HEADERS.flatMap((l) => [...l.type, ...l.holder, ...l.amount, ...l.gov]);
    const skip: string[] = [
      ...SKIP.first, ...SKIP.last, ...SKIP.litigator, ...SKIP.deceased, ...SKIP.tcpa, ...SKIP.county,
    ];
    for (let i = 0; i < SKIP_PHONE_SLOTS; i++) {
      skip.push(...SKIP.phone(i), ...SKIP.phoneType(i), ...SKIP.phoneDnc(i), ...SKIP.phoneScore(i));
    }
    for (let i = 0; i < SKIP_EMAIL_SLOTS; i++) skip.push(...SKIP.email(i));
    return [
      ...NAME_HEADERS.first, ...NAME_HEADERS.last, ...NAME_HEADERS.full, ...NAME_HEADERS.roll,
      ...PHONE_HEADERS.flat(), ...PHONE_TYPE_HEADERS.flat(), ...PHONE_DNC_HEADERS.flat(),
      ...EMAIL_HEADERS.flat(), ...lien, ...skip, ...SEGMENT_HEADERS,
    ].includes(n);
  }

  private canReadClaimant(headers: string[], _idx: any): boolean {
    const has = (names: string[]) => this.colFor(headers, names) !== undefined;
    return has(NAME_HEADERS.full) || has(NAME_HEADERS.roll) || has(NAME_HEADERS.last);
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

  private cellAt(row: any[], headers: string[], names: string[]): string {
    const col = this.colFor(headers, names);
    return col === undefined ? '' : cellText(row[col]);
  }

  /** The county most rows in the file agree on. '' when the file names none. */
  private dominantCounty(
    rows: any[][],
    headers: string[],
    idx: Partial<Record<keyof SurplusLeadInput, number>>,
  ): string {
    const counts = new Map<string, number>();
    for (const row of rows) {
      const own = idx.county === undefined ? '' : cellText(row[idx.county]);
      const traced = this.cellAt(row, headers, SKIP.county);
      const c = own || traced;
      if (c) counts.set(c, (counts.get(c) || 0) + 1);
    }
    let best = '';
    let bestN = 0;
    counts.forEach((n, c) => {
      if (n > bestN) {
        best = c;
        bestN = n;
      }
    });
    return best;
  }

  private countyWasInferred(
    row: any[],
    headers: string[],
    idx: Partial<Record<keyof SurplusLeadInput, number>>,
  ): boolean {
    const own = idx.county === undefined ? '' : cellText(row[idx.county]);
    return !own && !this.cellAt(row, headers, SKIP.county);
  }

  private claimantOf(row: any[], headers: string[]): { name: string; last: string } {
    const full = this.cellAt(row, headers, NAME_HEADERS.full);
    const first = this.cellAt(row, headers, NAME_HEADERS.first);
    const last = this.cellAt(row, headers, NAME_HEADERS.last);
    const roll = this.cellAt(row, headers, NAME_HEADERS.roll);

    if (full) {
      const parts = full.split(/\s+/).filter(Boolean);
      return { name: full, last: parts.length > 1 ? parts[parts.length - 1] : full };
    }
    if (first || last) return { name: `${first} ${last}`.trim(), last: last || first };
    if (roll) {
      // Tax roll spelling puts the surname first: "HILL TAMMIE LEE".
      const parts = roll.split(/\s+/).filter(Boolean);
      return { name: roll, last: parts[0] || '' };
    }
    return { name: '', last: '' };
  }

  /**
   * Contacts out of the skip-trace block, GATED on the returned name actually
   * belonging to the claimant. A vendor that reports `matched: true` is saying
   * it found a record, not that it found the right person, so the surname is
   * checked here and a mismatch discards the whole block.
   */
  private skiptraceContacts(
    row: any[],
    headers: string[],
    claimantLast: string,
  ): {
    phones: SurplusPhoneInput[];
    emails: string[];
    deceased: boolean;
    mismatch: boolean;
    returnedName: string;
  } {
    const tracedFirst = this.cellAt(row, headers, SKIP.first);
    const tracedLast = this.cellAt(row, headers, SKIP.last);
    const litigator = truthy(this.cellAt(row, headers, SKIP.litigator));
    const tcpa = truthy(this.cellAt(row, headers, SKIP.tcpa));
    const deceased = truthy(this.cellAt(row, headers, SKIP.deceased));

    const phones: (SurplusPhoneInput & { score: number })[] = [];
    for (let i = 0; i < SKIP_PHONE_SLOTS; i++) {
      const num = normalizePhoneDigits(this.cellAt(row, headers, SKIP.phone(i)));
      if (!num) continue;
      const flagged = truthy(this.cellAt(row, headers, SKIP.phoneDnc(i)));
      phones.push({
        number: num,
        type: phoneTypeOf(this.cellAt(row, headers, SKIP.phoneType(i))),
        // A litigator flag is on the person, so it taints every number they
        // hold; the per-number flag is a plain registry hit. Either way the
        // number must not be dialed, and both are recorded as such.
        dnc: litigator ? 'litigator' : flagged || tcpa ? 'federal' : null,
        score: parseNum(this.cellAt(row, headers, SKIP.phoneScore(i))) ?? 0,
      });
    }
    // The vendor's own confidence score decides which survive the four-slot
    // limit, after clean numbers are preferred over registered ones.
    phones.sort((a, b) => (a.dnc ? 1 : 0) - (b.dnc ? 1 : 0) || b.score - a.score);

    const emails: string[] = [];
    for (let i = 0; i < SKIP_EMAIL_SLOTS; i++) {
      const e = this.cellAt(row, headers, SKIP.email(i));
      if (e) emails.push(e);
    }

    const returnedName = `${tracedFirst} ${tracedLast}`.trim();
    const gotSomething = phones.length > 0 || emails.length > 0;
    const belongs = nameMatchesClaimant(claimantLast, tracedLast);

    if (gotSomething && !belongs) {
      // Deceased is a fact about the traced person, so it is dropped with the
      // rest of the block rather than applied to a claimant it may not describe.
      return { phones: [], emails: [], deceased: false, mismatch: true, returnedName };
    }

    return {
      phones: phones.map(({ score, ...p }) => p),
      emails,
      deceased,
      mismatch: false,
      returnedName,
    };
  }

  private rowToInput(
    row: any[],
    headers: string[],
    idx: Partial<Record<keyof SurplusLeadInput, number>>,
    fallbackCounty: string,
  ): SurplusLeadInput {
    const g = (field: keyof SurplusLeadInput): string => {
      const i = idx[field];
      return i === undefined ? '' : cellText(row[i]);
    };

    const claimant = this.claimantOf(row, headers);
    const traced = this.skiptraceContacts(row, headers, claimant.last);

    // A clerk export's own contact columns, when it has any. Anything the skip
    // trace supplied wins, because it is the newer of the two.
    const plainPhones: SurplusLeadInput['phones'] = [];
    for (let i = 0; i < PHONE_HEADERS.length; i++) {
      const num = normalizePhoneDigits(this.cellAt(row, headers, PHONE_HEADERS[i]));
      if (!num) continue;
      const dncRaw = this.cellAt(row, headers, PHONE_DNC_HEADERS[i]).toLowerCase();
      plainPhones.push({
        number: num,
        type: phoneTypeOf(this.cellAt(row, headers, PHONE_TYPE_HEADERS[i])),
        dnc: /litig/.test(dncRaw)
          ? 'litigator'
          : /state/.test(dncRaw)
            ? 'state'
            : dncRaw !== '' && /fed|dnc|y|yes|true|1/.test(dncRaw)
              ? 'federal'
              : null,
      });
    }
    const plainEmails: string[] = [];
    for (const names of EMAIL_HEADERS) {
      const v = this.cellAt(row, headers, names);
      if (v) plainEmails.push(v);
    }

    const phones = traced.phones.length ? traced.phones : plainPhones;
    const emails = traced.emails.length ? traced.emails : plainEmails;

    const liens: SurplusLien[] = [];
    LIEN_HEADERS.forEach((spec, i) => {
      const amount = parseNum(this.cellAt(row, headers, spec.amount));
      if (!amount) return;
      const holder = this.cellAt(row, headers, spec.holder);
      const type = this.cellAt(row, headers, spec.type);
      const govCol = this.colFor(headers, spec.gov);
      liens.push({
        type: type || 'Lien',
        holder,
        amount,
        priority: i + 1,
        // A sheet that flags it wins. Failing that the holder's own name is the
        // only signal, and getting it wrong only reorders the waterfall display,
        // never the total.
        governmental:
          govCol !== undefined
            ? truthy(row[govCol])
            : /county|city|state|municipal|clerk|utilit|code enforce/i.test(`${holder} ${type}`),
      });
    });

    const segment = this.cellAt(row, headers, SEGMENT_HEADERS);
    const notes = [g('notes'), segment ? `Segment: ${segment}` : ''].filter(Boolean).join(' · ');

    const deceased = truthy(g('deceased')) || traced.deceased || /estate|heir|deceas/i.test(segment);

    return {
      address: g('address'),
      city: g('city'),
      state: g('state') || 'FL',
      zip: g('zip'),
      county: g('county') || this.cellAt(row, headers, SKIP.county) || fallbackCounty,
      parcelId: g('parcelId'),
      caseNumber: g('caseNumber'),

      claimant: claimant.name,
      claimantType: g('claimantType'),
      deceased,
      heirsRequired: truthy(g('heirsRequired')) || /estate|heir/i.test(segment),
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
      notes,

      phones,
      emails,
      // The vendor checked the registries as part of the trace, but the export
      // does not say when, so no scrub date is claimed rather than one invented.
      dncScrubbedAt: null,
      contactMismatch: traced.mismatch,
      mismatchedName: traced.mismatch ? traced.returnedName : null,
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

import { Injectable, Logger } from '@nestjs/common';
import * as XLSX from 'xlsx';
import { ForeclosureSourceKind } from '@fast-homes/shared';
import { ForeclosuresService } from './foreclosures.service';
import { ForeclosureLeadInput } from './foreclosure.types';
import { parseNum } from './foreclosure-scoring.util';

/**
 * Normalize a header cell to a lookup key: lowercase, alphanumerics only.
 * Mirrors the offline tracker's normH so the same sheet imports identically.
 */
function normH(h: any): string {
  return String(h || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

// Normalized tracker header -> ForeclosureLeadInput field.
const HEADER_MAP: Record<string, keyof ForeclosureLeadInput> = {
  dateadded: 'dateAdded',
  priority: 'priority',
  noticetype: 'noticeType',
  propertyaddress: 'address',
  address: 'address',
  city: 'city',
  zip: 'zip',
  zipcode: 'zip',
  ownernames: 'ownerNames',
  owner: 'ownerNames',
  casenumber: 'caseNumber',
  case: 'caseNumber',
  saledate: 'saleDate',
  hearingdate: 'hearingDate',
  loandate: 'loanDate',
  loanamount: 'loanAmount',
  noticeurl: 'noticeUrl',
  mailingaddress: 'mailingAddress',
  notes: 'notes',
  skipstatus: 'skipStatus',
  ownercountyrecord: 'countyOwner',
  mailcity: 'mailCity',
  mailstate: 'mailState',
  mailzip: 'mailZip',
  assessedvalue: 'assessedValue',
  potentialequity: 'equityPct',
  owneroccupied: 'ownerOccupied',
  phone1: 'phone1',
  phone2: 'phone2',
  email: 'email',
};

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
    const recognized = headers.filter((h) => HEADER_MAP[normH(h)]);
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

    let created = 0;
    let skipped = 0;
    const errors: { row: number; reason: string }[] = [];

    for (let i = 0; i < rows.length; i++) {
      try {
        const input = this.rowToInput(rows[i], fieldIndex);
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
  ): ForeclosureLeadInput {
    const g = (field: keyof ForeclosureLeadInput): string => {
      const i = idx[field];
      if (i === undefined) return '';
      const v = row[i];
      return v == null ? '' : String(v).trim();
    };

    // Potential Equity is only a percentage when the cell carries a % sign.
    const equityRaw = g('equityPct');
    const equityPct = equityRaw.indexOf('%') >= 0 ? parseNum(equityRaw) : null;

    // Owner Occupied -> single Y/N char.
    const occ = g('ownerOccupied').toUpperCase().slice(0, 1);

    return {
      sourceKind: ForeclosureSourceKind.IMPORT,
      dateAdded: g('dateAdded'),
      priority: g('priority'),
      noticeType: this.normalizeNoticeType(g('noticeType')),
      address: g('address'),
      city: g('city'),
      zip: g('zip'),
      ownerNames: g('ownerNames'),
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
      phone1: g('phone1'),
      phone2: g('phone2'),
      email: g('email'),
    };
  }

  /** Map free-text notice type into the canonical snake_case token. */
  private normalizeNoticeType(raw: string): string {
    const t = raw.toLowerCase().replace(/\s+/g, '_');
    if (!t) return '';
    if (t.includes('hoa') || t.includes('lien')) return 'hoa_lien';
    if (t.includes('tax')) return 'tax_foreclosure';
    if (t.includes('sheriff')) return 'sheriff_sale';
    if (t.includes('hearing')) return 'pre_foreclosure_hearing';
    if (t.includes('mortgage') || t.includes('foreclosure')) return 'mortgage_foreclosure';
    return t;
  }
}

import { Injectable, Logger } from '@nestjs/common';
import * as XLSX from 'xlsx';
import { PrismaService } from '../prisma/prisma.service';
import { LeadSource } from '@fast-homes/shared';
import { ProbateService } from './probate.service';
import { ProbateLeadInput, ProbateImportResult } from './probate.types';
import {
  parseNum,
  parseWhyThisLead,
  parseDeceasedName,
  tierNumberOf,
  normalizePhoneDigits,
  cellText,
} from './probate.util';

/** Header cell to lookup key: lowercase, alphanumerics only. */
function normH(h: any): string {
  return String(h || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Normalized header -> ProbateLeadInput field.
 *
 * Covers the reconciled probate workbook's own column names plus the spellings
 * the raw probate pulls use, so a list imports without being reshaped first.
 * Where a sheet carries two columns for one field, the leftmost wins.
 */
const HEADER_MAP: Record<string, keyof ProbateLeadInput> = {
  rank: 'consensusRank',
  consensusrank: 'consensusRank',
  consensusscore: 'consensusScore',
  consensustier: 'consensusTier',
  tier: 'consensusTier',
  agreement: 'agreement',

  firstname: 'heirFirstName',
  heirfirstname: 'heirFirstName',
  lastname: 'heirLastName',
  heirlastname: 'heirLastName',
  heircity: 'heirCity',
  absenteeheir: 'absenteeHeir',

  propertystreet: 'address',
  propertyaddress: 'address',
  address: 'address',
  streetaddress: 'address',
  propertycity: 'city',
  city: 'city',
  propertystate: 'state',
  state: 'state',
  propertyzip: 'zip',
  zip: 'zip',
  zipcode: 'zip',
  county: 'county',

  bestphone: 'phone1',
  phone1: 'phone1',
  primaryphone: 'phone1',
  bestphonetype: 'phone1Type',
  phone1type: 'phone1Type',
  altphone: 'phone2',
  phone2: 'phone2',
  altphonetype: 'phone2Type',
  phone2type: 'phone2Type',
  email: 'email',
  email1: 'email',
  altemail: 'email2',
  email2: 'email2',
  moreonfile: 'moreOnFile',

  casenumber: 'caseNumber',
  case: 'caseNumber',
  probatecase: 'caseNumber',
  casefileddate: 'caseFiledDate',
  fileddate: 'caseFiledDate',
  datefiled: 'caseFiledDate',
  deceasedcontext: 'deceasedName',
  deceasedname: 'deceasedName',
  deceasedowner: 'deceasedName',
  monthssincedeath: 'monthsSinceDeath',

  estvalue: 'estValue',
  estimatedvalue: 'estValue',
  eslpriority: 'eslPriority',
  esltier: 'eslTier',
  motivationscore: 'motivationScore',
  motivationtier: 'motivationTier',
  whythislead: 'whyThisLead',
};

/** Fields without which a sheet is not a probate list at all. */
const ANCHOR_FIELDS: (keyof ProbateLeadInput)[] = ['address', 'phone1', 'heirFirstName'];

@Injectable()
export class ProbateImportService {
  private readonly logger = new Logger(ProbateImportService.name);

  constructor(
    private probate: ProbateService,
    private prisma: PrismaService,
  ) {}

  /** Parse the upload into headers + sample rows and a per-tier row count. */
  parseUpload(buffer: Buffer): {
    sheetName: string;
    headers: string[];
    recognized: string[];
    unrecognized: string[];
    sampleRows: any[][];
    totalRows: number;
    tierCounts: Record<string, number>;
  } {
    const { sheetName, headers, rows } = this.readSheet(buffer);
    const idx = this.fieldIndex(headers);
    const tierCol = idx.consensusTier;

    const tierCounts: Record<string, number> = {};
    for (const row of rows) {
      const label = tierCol === undefined ? 'Unknown' : cellText(row[tierCol]) || 'Unknown';
      tierCounts[label] = (tierCounts[label] || 0) + 1;
    }

    return {
      sheetName,
      headers,
      recognized: headers.filter((h) => !!HEADER_MAP[normH(h)]),
      unrecognized: headers.filter((h) => !HEADER_MAP[normH(h)]),
      sampleRows: rows.slice(0, 5),
      totalRows: rows.length,
      tierCounts,
    };
  }

  /**
   * Import the rows of a probate list as PROBATE leads.
   *
   * `tier` restricts the import to one consensus tier (1 for "Attack First").
   * Omit it to take the whole sheet. `dryRun` walks the same path and reports
   * what would happen without writing, which is how you check a new list's
   * columns landed in the right fields before it hits the database.
   */
  async executeImport(
    buffer: Buffer,
    opts: {
      organizationId?: string | null;
      tier?: number | null;
      importBatch?: string;
      dryRun?: boolean;
    },
  ): Promise<ProbateImportResult> {
    const { headers, rows } = this.readSheet(buffer);
    const idx = this.fieldIndex(headers);

    const missingAnchors = ANCHOR_FIELDS.filter((f) => idx[f] === undefined);
    if (missingAnchors.length > 0) {
      throw new Error(
        `Sheet is missing required columns for: ${missingAnchors.join(', ')}. ` +
          `Found headers: ${headers.join(', ')}`,
      );
    }

    const result: ProbateImportResult = {
      created: 0,
      duplicates: 0,
      filteredOut: 0,
      errors: [],
      primaryContacts: 0,
      phoneConflicts: [],
    };

    for (let i = 0; i < rows.length; i++) {
      try {
        const input = this.rowToInput(rows[i], idx, opts.importBatch);

        if (opts.tier != null && tierNumberOf(input.consensusTier) !== opts.tier) {
          result.filteredOut++;
          continue;
        }

        if (opts.dryRun) {
          if (!cellText(input.address) || !normalizePhoneDigits(input.phone1)) {
            result.errors.push({ row: i + 2, reason: 'missing address or usable phone' });
          } else {
            result.created++;
          }
          continue;
        }

        const res = await this.probate.createProbateLead(input, {
          organizationId: opts.organizationId,
        });

        if (!res.created) {
          if (res.reason === 'duplicate') result.duplicates++;
          else result.errors.push({ row: i + 2, reason: res.reason || 'not created' });
          continue;
        }

        result.created++;
        if (res.primaryContact) result.primaryContacts++;

        const conflict = await this.phoneConflict(
          res.leadId!,
          input.phone1!,
          opts.organizationId ?? null,
        );
        if (conflict) result.phoneConflicts.push(conflict);
      } catch (err: any) {
        this.logger.warn(`Probate import row ${i + 2} failed: ${err.message}`);
        result.errors.push({ row: i + 2, reason: err.message });
      }
    }

    return result;
  }

  /**
   * Pick the sheet that actually holds the list. These workbooks ship a prose
   * summary tab first, so SheetNames[0] is the wrong default: score every
   * sheet by how many probate columns its header row has and take the best.
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
      const score = headers.filter((h) => !!HEADER_MAP[normH(h)]).length;
      if (!best || score > best.score) {
        const rows = data.slice(1).filter((r) => r.some((c: any) => c !== '' && c != null));
        best = { sheetName: name, headers, rows, score };
      }
    }

    if (!best || best.score === 0) {
      throw new Error('No sheet in this file has recognizable probate columns');
    }
    return { sheetName: best.sheetName, headers: best.headers, rows: best.rows };
  }

  private fieldIndex(headers: string[]): Partial<Record<keyof ProbateLeadInput, number>> {
    const idx: Partial<Record<keyof ProbateLeadInput, number>> = {};
    headers.forEach((h, i) => {
      const field = HEADER_MAP[normH(h)];
      if (field && idx[field] === undefined) idx[field] = i;
    });
    return idx;
  }

  private rowToInput(
    row: any[],
    idx: Partial<Record<keyof ProbateLeadInput, number>>,
    importBatch?: string,
  ): ProbateLeadInput {
    const g = (field: keyof ProbateLeadInput): string => {
      const i = idx[field];
      return i === undefined ? '' : cellText(row[i]);
    };

    // The case number, the filing date and the heir's city live inside the
    // `why_this_lead` sentence on these lists rather than in columns of their
    // own. A dedicated column, when a list has one, wins.
    const why = g('whyThisLead');
    const parsed = parseWhyThisLead(why);

    return {
      address: g('address'),
      city: g('city'),
      state: g('state'),
      zip: g('zip'),
      county: g('county'),

      heirFirstName: g('heirFirstName'),
      heirLastName: g('heirLastName'),
      heirCity: g('heirCity') || parsed.heirCity,
      // Blank stays null so the service can tell "this list has no absentee
      // column" from "this list says no".
      absenteeHeir: g('absenteeHeir') ? /^(y|yes|true|1)$/i.test(g('absenteeHeir')) : null,

      phone1: g('phone1'),
      phone1Type: g('phone1Type'),
      phone2: g('phone2'),
      phone2Type: g('phone2Type'),
      email: g('email'),
      email2: g('email2'),
      moreOnFile: g('moreOnFile'),

      caseNumber: g('caseNumber') || parsed.caseNumber,
      caseFiledDate: g('caseFiledDate') || parsed.filedDate,
      deceasedName: parseDeceasedName(g('deceasedName')),
      monthsSinceDeath: parseNum(g('monthsSinceDeath')),

      consensusRank: parseNum(g('consensusRank')),
      consensusScore: parseNum(g('consensusScore')),
      consensusTier: g('consensusTier'),
      agreement: g('agreement'),
      eslPriority: parseNum(g('eslPriority')),
      eslTier: g('eslTier'),
      motivationScore: parseNum(g('motivationScore')),
      motivationTier: g('motivationTier'),
      whyThisLead: why,
      estValue: parseNum(g('estValue')),

      importBatch,
    };
  }

  /**
   * Whether this heir's phone already belonged to a lead from another source.
   * Reported rather than blocked: it means two lists point at one person, and
   * the user needs to know before both start messaging them.
   */
  private async phoneConflict(
    leadId: string,
    rawPhone: string,
    organizationId: string | null,
  ): Promise<{ leadId: string; phone: string; otherSources: string[] } | null> {
    const digits = normalizePhoneDigits(rawPhone);
    if (!digits) return null;

    const others = await this.prisma.lead.findMany({
      where: {
        organizationId,
        id: { not: leadId },
        sellerPhone: { endsWith: digits },
        source: { not: LeadSource.PROBATE },
      },
      select: { source: true },
      take: 10,
    });
    if (others.length === 0) return null;

    return {
      leadId,
      phone: digits,
      otherSources: Array.from(new Set(others.map((o) => o.source))),
    };
  }
}

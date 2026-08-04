import * as XLSX from 'xlsx';
import { ProbateImportService } from './probate-import.service';
import { ProbateService } from './probate.service';
import { PrismaService } from '../prisma/prisma.service';
import { ProbateLeadInput } from './probate.types';

function workbookBuffer(sheets: { name: string; rows: any[][] }[]): Buffer {
  const wb = XLSX.utils.book_new();
  for (const s of sheets) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(s.rows), s.name);
  }
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

function sheetBuffer(rows: any[][]): Buffer {
  return workbookBuffer([{ name: 'Prioritized Probate (Load)', rows }]);
}

/** No lead ever collides with an existing one, in these tests. */
const noConflictPrisma = {
  lead: { findMany: jest.fn(async () => []) },
} as unknown as PrismaService;

/** Import the sheet and hand back the normalized inputs the service produced. */
async function importRows(
  buffer: Buffer,
  opts: { tier?: number | null } = {},
): Promise<{ captured: ProbateLeadInput[]; result: any }> {
  const captured: ProbateLeadInput[] = [];
  const probate = {
    createProbateLead: jest.fn(async (input: ProbateLeadInput) => {
      captured.push(input);
      return { leadId: `lead-${captured.length}`, created: true, primaryContact: true };
    }),
  } as unknown as ProbateService;

  const service = new ProbateImportService(probate, noConflictPrisma);
  const result = await service.executeImport(buffer, {
    organizationId: 'org-1',
    tier: opts.tier ?? null,
    importBatch: 'test.xlsx',
  });
  return { captured, result };
}

// Headers exactly as the reconciled probate workbook ships them.
const HEADERS = [
  'Rank', 'Consensus Score', 'Consensus Tier', 'Agreement', 'first_name', 'last_name',
  'property_street', 'property_city', 'property_zip', 'best_phone', 'best_phone_type',
  'alt_phone', 'email', 'alt_email', 'more_on_file', 'absentee_heir', 'est_value',
  'months_since_death', 'esl_priority', 'esl_tier', 'motivation_score', 'motivation_tier',
  'why_this_lead', 'deceased_context',
];

const TIER1_ROW = [
  1, 87.8, 'Tier 1 - Attack First', 'Top by motivation/timing (mine)', 'Cindy',
  'Starnes Hildreth', '7316 S Providence Rd', 'Waxhaw', 28173, '(704) 651-4821', 'Mobile',
  '(919) 758-2440', 'childbirth58@gmail.com', 'clhildreth@windstream.net', '+3 phone, +1 email',
  'Yes', 477600, 4.5, 79.7, 'Tier 2 - Strong Leads', 104, 'Tier 1',
  'Probate case 26E000342-890 filed Mar 24, 2026 — heir/petitioner lives in Monroe, not at the property',
  'Deceased owner: Albert Joseph Starnes',
];

const TIER3_ROW = [
  600, 41.2, 'Tier 3 - Worth Working', '', 'Dana', 'Reid', '12 Elm St', 'Monroe', 28110,
  '(704) 555-0100', 'Landline', '—', '—', '—', '—', 'No', 180000, '', 40.1,
  'Tier 3 - Worth Working', 30, 'Tier 3',
  'Probate case 25E009999-590 filed Feb 02, 2025', 'Deceased owner: Ray Reid',
];

describe('ProbateImportService - reconciled workbook format', () => {
  it('maps the workbook headers onto the probate fields', async () => {
    const { captured } = await importRows(sheetBuffer([HEADERS, TIER1_ROW]));
    const [input] = captured;

    expect(input.address).toBe('7316 S Providence Rd');
    expect(input.city).toBe('Waxhaw');
    expect(input.zip).toBe('28173');
    expect(input.heirFirstName).toBe('Cindy');
    expect(input.heirLastName).toBe('Starnes Hildreth');
    expect(input.phone1).toBe('(704) 651-4821');
    expect(input.phone1Type).toBe('Mobile');
    expect(input.phone2).toBe('(919) 758-2440');
    expect(input.email).toBe('childbirth58@gmail.com');
    expect(input.email2).toBe('clhildreth@windstream.net');
    expect(input.moreOnFile).toBe('+3 phone, +1 email');
    expect(input.absenteeHeir).toBe(true);
    expect(input.state).toBe('');
    expect(input.estValue).toBe(477600);
    expect(input.monthsSinceDeath).toBe(4.5);
    expect(input.consensusRank).toBe(1);
    expect(input.consensusScore).toBe(87.8);
    expect(input.consensusTier).toBe('Tier 1 - Attack First');
    expect(input.eslPriority).toBe(79.7);
    expect(input.motivationScore).toBe(104);
    expect(input.importBatch).toBe('test.xlsx');
  });

  it('recovers the estate facts the workbook only writes into why_this_lead', async () => {
    const { captured } = await importRows(sheetBuffer([HEADERS, TIER1_ROW]));
    const [input] = captured;

    expect(input.caseNumber).toBe('26E000342-890');
    expect(input.caseFiledDate).toBe('2026-03-24');
    expect(input.heirCity).toBe('Monroe');
    expect(input.deceasedName).toBe('Albert Joseph Starnes');
  });

  it('folds the sheet\'s em-dash placeholders to empty', async () => {
    const { captured } = await importRows(sheetBuffer([HEADERS, TIER3_ROW]));
    const [input] = captured;

    expect(input.phone2).toBe('');
    expect(input.email).toBe('');
    expect(input.email2).toBe('');
    expect(input.moreOnFile).toBe('');
    expect(input.monthsSinceDeath).toBeNull();
    expect(input.absenteeHeir).toBe(false);
  });

  it('leaves absenteeHeir null when the list ships no absentee column', async () => {
    const headers = HEADERS.filter((h) => h !== 'absentee_heir');
    const row = TIER1_ROW.filter((_, i) => i !== HEADERS.indexOf('absentee_heir'));
    const { captured } = await importRows(sheetBuffer([headers, row]));
    expect(captured[0].absenteeHeir).toBeNull();
  });

  it('imports only the requested tier and counts what it skipped', async () => {
    const { captured, result } = await importRows(
      sheetBuffer([HEADERS, TIER1_ROW, TIER3_ROW]),
      { tier: 1 },
    );

    expect(captured).toHaveLength(1);
    expect(captured[0].consensusTier).toBe('Tier 1 - Attack First');
    expect(result.created).toBe(1);
    expect(result.filteredOut).toBe(1);
  });

  it('takes every row when no tier is given', async () => {
    const { result } = await importRows(sheetBuffer([HEADERS, TIER1_ROW, TIER3_ROW]));
    expect(result.created).toBe(2);
    expect(result.filteredOut).toBe(0);
  });

  it('picks the data sheet past the workbook\'s prose summary tab', async () => {
    const buffer = workbookBuffer([
      { name: 'Comparison Summary', rows: [['Probate Lead Prioritization'], ['Bottom line'], ['...']] },
      { name: 'Prioritized Probate (Load)', rows: [HEADERS, TIER1_ROW] },
    ]);
    const { captured } = await importRows(buffer);
    expect(captured).toHaveLength(1);
    expect(captured[0].address).toBe('7316 S Providence Rd');
  });

  it('reports the sheet, the tier breakdown and the unmapped columns on parse', () => {
    const service = new ProbateImportService(
      {} as unknown as ProbateService,
      noConflictPrisma,
    );
    const parsed = service.parseUpload(
      workbookBuffer([
        { name: 'Comparison Summary', rows: [['Probate Lead Prioritization'], ['Bottom line']] },
        { name: 'Prioritized Probate (Load)', rows: [HEADERS, TIER1_ROW, TIER3_ROW] },
      ]),
    );

    expect(parsed.sheetName).toBe('Prioritized Probate (Load)');
    expect(parsed.totalRows).toBe(2);
    expect(parsed.tierCounts).toEqual({
      'Tier 1 - Attack First': 1,
      'Tier 3 - Worth Working': 1,
    });
    expect(parsed.unrecognized).toEqual([]);
  });

  it('refuses a sheet that is missing the columns a probate lead needs', async () => {
    await expect(
      importRows(sheetBuffer([['Rank', 'Consensus Tier'], [1, 'Tier 1 - Attack First']])),
    ).rejects.toThrow(/missing required columns/i);
  });

  it('rejects a file with no probate-shaped sheet at all', async () => {
    await expect(
      importRows(workbookBuffer([{ name: 'Notes', rows: [['a', 'b'], ['1', '2']] }])),
    ).rejects.toThrow(/no sheet/i);
  });

  it('dry run reports without ever calling the writer', async () => {
    const probate = { createProbateLead: jest.fn() } as unknown as ProbateService;
    const service = new ProbateImportService(probate, noConflictPrisma);

    const result = await service.executeImport(sheetBuffer([HEADERS, TIER1_ROW, TIER3_ROW]), {
      organizationId: 'org-1',
      tier: 1,
      dryRun: true,
    });

    expect(result.created).toBe(1);
    expect(result.filteredOut).toBe(1);
    expect(probate.createProbateLead).not.toHaveBeenCalled();
  });

  it('counts a duplicate row as a duplicate, not an error', async () => {
    const probate = {
      createProbateLead: jest.fn(async () => ({
        leadId: 'lead-1',
        created: false,
        primaryContact: true,
        reason: 'duplicate',
      })),
    } as unknown as ProbateService;

    const service = new ProbateImportService(probate, noConflictPrisma);
    const result = await service.executeImport(sheetBuffer([HEADERS, TIER1_ROW]), {
      organizationId: 'org-1',
    });

    expect(result.created).toBe(0);
    expect(result.duplicates).toBe(1);
    expect(result.errors).toEqual([]);
  });

  it('counts only primary contacts, so a drip knows how many people it reaches', async () => {
    let n = 0;
    const probate = {
      createProbateLead: jest.fn(async () => {
        n++;
        return { leadId: `lead-${n}`, created: true, primaryContact: n === 1 };
      }),
    } as unknown as ProbateService;

    const service = new ProbateImportService(probate, noConflictPrisma);
    // Same heir, same phone, two properties on the estate.
    const second = [...TIER1_ROW];
    second[6] = '7320 S Providence Rd';
    const result = await service.executeImport(sheetBuffer([HEADERS, TIER1_ROW, second]), {
      organizationId: 'org-1',
    });

    expect(result.created).toBe(2);
    expect(result.primaryContacts).toBe(1);
  });

  it('reports a phone that already belongs to a lead from another source', async () => {
    const probate = {
      createProbateLead: jest.fn(async () => ({
        leadId: 'lead-1',
        created: true,
        primaryContact: true,
      })),
    } as unknown as ProbateService;
    const prisma = {
      lead: { findMany: jest.fn(async () => [{ source: 'FORECLOSURE' }, { source: 'FORECLOSURE' }]) },
    } as unknown as PrismaService;

    const service = new ProbateImportService(probate, prisma);
    const result = await service.executeImport(sheetBuffer([HEADERS, TIER1_ROW]), {
      organizationId: 'org-1',
    });

    expect(result.created).toBe(1);
    expect(result.phoneConflicts).toEqual([
      { leadId: 'lead-1', phone: '7046514821', otherSources: ['FORECLOSURE'] },
    ]);
  });
});

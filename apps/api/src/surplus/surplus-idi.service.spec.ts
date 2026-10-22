import { SurplusIdiService } from './surplus-idi.service';
import { IDI_RESULTS_CSV } from './surplus-idi.fixtures';

/**
 * Applying an IDI results file to the board. Prisma is an in-memory stand-in
 * that keeps every write, so each test reads back what landed where.
 */
function setup(leadsIn: any[], heirsIn: any[] = []) {
  const leads = leadsIn.map((l) => ({ ...l, surplusDetail: { ...l.surplusDetail } }));
  const heirs = heirsIn.map((h) => ({ ...h }));
  const attempts: any[] = [];
  const detailOf = (id: string) => leads.find((l) => l.surplusDetail.id === id)!.surplusDetail;
  const matchesWhere = (l: any, where: any) => {
    if (where.id && typeof where.id === 'string' && l.id !== where.id) return false;
    if (where.id?.in && !where.id.in.includes(l.id)) return false;
    if (where.OR) {
      const s = where.OR[0].sellerLastName.contains.toLowerCase();
      if (!`${l.sellerLastName} ${l.sellerFirstName}`.toLowerCase().includes(s)) return false;
    }
    return true;
  };
  const prisma: any = {
    lead: {
      findMany: jest.fn(async ({ where }: any) => leads.filter((l) => matchesWhere(l, where))),
      findFirst: jest.fn(async ({ where }: any) => leads.find((l) => matchesWhere(l, where)) || null),
      update: jest.fn(async ({ where, data }: any) => Object.assign(leads.find((l) => l.id === where.id)!, data)),
    },
    surplusDetail: {
      findUnique: jest.fn(async ({ where }: any) => detailOf(where.id)),
      update: jest.fn(async ({ where, data }: any) => Object.assign(detailOf(where.id), data)),
    },
    surplusHeir: {
      findMany: jest.fn(async ({ where }: any) => heirs.filter((h) => h.surplusDetailId === where.surplusDetailId)),
      create: jest.fn(async ({ data }: any) => {
        const h = { id: `h${heirs.length + 1}`, ...data };
        heirs.push(h);
        return h;
      }),
      update: jest.fn(async ({ where, data }: any) => Object.assign(heirs.find((h) => h.id === where.id)!, data)),
    },
    surplusTraceAttempt: { create: jest.fn(async ({ data }: any) => attempts.push(data)) },
  };
  const config: any = { get: () => undefined };
  return { service: new SurplusIdiService(prisma, config), leads, heirs, attempts };
}

const lead = (id: string, first: string, last: string, street: string, over: any = {}) => ({
  id,
  source: 'surplus',
  organizationId: 'org1',
  sellerFirstName: first,
  sellerLastName: last,
  sellerPhone: '',
  sellerEmail: null,
  propertyAddress: street,
  propertyCity: 'Palm Bay',
  propertyState: 'FL',
  propertyZip: '32909',
  ...over,
  surplusDetail: {
    id: `d${id}`,
    organizationId: 'org1',
    county: 'Brevard',
    caseNumber: `case-${id}`,
    grossSurplus: 30000,
    deceased: false,
    heirsRequired: false,
    callNotes: null,
    ...(over.surplusDetail || {}),
  },
});

const file = Buffer.from(IDI_RESULTS_CSV);

describe('SurplusIdiService.previewImport', () => {
  it('matches each row and writes nothing', async () => {
    const { service, leads } = setup([
      lead('1', 'JANE Q', 'SAMPLE', '100 Example Rd SE'),
      lead('2', 'PAUL G', 'EXAMPLE', '7500 E Sample Ct'),
    ]);
    const { rows } = await service.previewImport(file, { organizationId: 'org1', fileName: 'x_out.csv' });
    expect(rows.map((r) => [r.leadId, r.confidence])).toEqual([
      ['1', 'name_and_address'],
      [null, 'none'],
      ['2', 'name_and_address'],
    ]);
    expect(rows[0]).toMatchObject({ found: true, phones: 3, emails: 2, relatives: 2 });
    expect(leads[0].sellerPhone).toBe('');
  });
});

describe('SurplusIdiService.applyImport', () => {
  it('merges phones newest first and keeps the DNC flag on a held number', async () => {
    const { service, leads } = setup([
      lead('1', 'JANE Q', 'SAMPLE', '100 Example Rd SE', {
        sellerPhone: '+19045550001',
        surplusDetail: { phone1Type: 'Mobile', phone1Dnc: 'federal', dncScrubbedAt: new Date('2026-01-01') },
      }),
    ]);
    const r = await service.applyImport(file, { organizationId: 'org1' });
    expect(r.applied).toBe(1);
    expect(r.withContact).toBe(1);
    const l = leads[0];
    // 9/11/2026 and 9/2/2026 are fresh; what we held comes next; the 2019 number last.
    expect(l.sellerPhone).toBe('+12625550101');
    expect(l.surplusDetail).toMatchObject({
      phone2: '2625550103',
      phone3: '9045550001',
      phone3Dnc: 'federal',
      phone4: '2625550102',
      dncScrubbedAt: null,
      traceOutcome: 'matched',
    });
    expect(l.sellerEmail).toBe('jsample@example.net');
    expect(l.surplusDetail.email2).toBe('old@example.com');
    expect(l.surplusDetail.callNotes).toMatch(/^IDI batch matched JANE Q SAMPLE\. Phones: \(262\) 555-0101 mobile, last seen 9\/11\/2026/);
  });

  it('files relatives as relatives with their own contacts', async () => {
    const { service, heirs } = setup([lead('1', 'JANE Q', 'SAMPLE', '100 Example Rd SE')]);
    const r = await service.applyImport(file, { organizationId: 'org1' });
    expect(r.relativesFiled).toBe(2);
    expect(heirs[0]).toMatchObject({
      name: 'JOHN P SAMPLE JR',
      relationship: 'Spouse',
      role: 'relative',
      sourceKind: 'idi',
      city: 'SPRINGFIELD',
      phone1: '2625550201',
      email1: 'john@example.net',
    });
    expect(heirs[0].callNotes).toMatch(/A route to the claimant\./);
  });

  it('never overwrites a relative somebody already filed', async () => {
    const { service, heirs } = setup(
      [lead('1', 'JANE Q', 'SAMPLE', '100 Example Rd SE')],
      [{ id: 'h0', surplusDetailId: 'd1', name: 'SAMPLE, JOHN P JR', relationship: 'Husband', phone1: '9045559999' }],
    );
    await service.applyImport(file, { organizationId: 'org1' });
    const john = heirs.find((h) => h.id === 'h0');
    expect(john).toMatchObject({ relationship: 'Husband', phone1: '9045559999', city: 'SPRINGFIELD' });
    expect(heirs.filter((h) => /JOHN/.test(h.name))).toHaveLength(1);
  });

  it('marks a claimant IDI lists as deceased and moves them to the heir search', async () => {
    const { service, leads, heirs } = setup([lead('2', 'PAUL G', 'EXAMPLE', '7500 E Sample Ct')]);
    const r = await service.applyImport(file, { organizationId: 'org1' });
    expect(r.deceased).toBe(1);
    expect(leads[0].surplusDetail).toMatchObject({
      deceased: true,
      heirsRequired: true,
      claimantType: 'heir_estate',
      deathSource: 'idi',
      tier: 'C',
    });
    expect(leads[0].surplusDetail.callNotes).toMatch(/Death record \(IDI\): PAUL G EXAMPLE is recorded as deceased/);
    expect(heirs.map((h) => h.relationship)).toEqual(['Spouse (widowed)', 'Child']);
    expect(heirs[1].callNotes).toMatch(/A route to the heirs/);
  });

  it('does not mark a lead naming two people dead on one of their records', async () => {
    const { service, leads } = setup([lead('2', 'PAUL G & EMMA M', 'EXAMPLE', '7500 E Sample Ct')]);
    await service.applyImport(file, { organizationId: 'org1' });
    expect(leads[0].surplusDetail.deceased).toBe(false);
    expect(leads[0].surplusDetail.callNotes).toMatch(/names more than one person/);
  });

  it('records a no match as no person found, when the row is assigned', async () => {
    const { service, leads, attempts } = setup([lead('3', 'GLEN A', 'NOBODY', '1 Vacant Lot Rd')]);
    const r = await service.applyImport(file, { organizationId: 'org1' });
    expect(r.noMatch).toBe(1);
    expect(leads[0].surplusDetail).toMatchObject({ traceOutcome: 'no_person' });
    expect(attempts[0]).toMatchObject({ channel: 'paid_db', source: 'IDI', result: 'nothing' });
  });

  it('skips a row left out in the preview and one nobody fits', async () => {
    const { service, leads } = setup([lead('1', 'JANE Q', 'SAMPLE', '100 Example Rd SE')]);
    const r = await service.applyImport(file, { organizationId: 'org1', assignments: { '0': null } });
    expect(r.applied).toBe(0);
    expect(r.skipped.map((s) => s.reason)).toEqual([
      'Left out in the preview.',
      'No claimant on the board has this name.',
      'No claimant on the board has this name.',
    ]);
    expect(leads[0].sellerPhone).toBe('');
  });

  it('logs every applied row as a paid database search', async () => {
    const { service, attempts } = setup([lead('1', 'JANE Q', 'SAMPLE', '100 Example Rd SE')]);
    await service.applyImport(file, { organizationId: 'org1', userId: 'u1' });
    expect(attempts).toHaveLength(1);
    expect(attempts[0]).toMatchObject({ surplusDetailId: 'd1', channel: 'paid_db', source: 'IDI', result: 'found', byUserId: 'u1' });
  });
});

describe('SurplusIdiService.exportBatch', () => {
  it('writes the notice address when there is one and names what it left out', async () => {
    const { service } = setup([
      lead('1', 'MARY THERESE', 'SAMPLE', '2296 Starlite Ln', {
        surplusDetail: { ownerMailingStreet: '48 Village Ct', ownerMailingCity: 'Nashotah', ownerMailingState: 'WI', ownerMailingZip: '53058' },
      }),
      lead('2', 'ACME HOLDINGS', 'LLC', '1 Main St'),
    ]);
    const r = await service.exportBatch({ organizationId: 'org1', leadIds: ['1', '2'] });
    expect(r.included).toBe(1);
    expect(r.csv.split('\r\n')[1]).toBe('MARY T,SAMPLE,48 Village Ct,Nashotah,WI,53058');
    expect(r.skipped).toEqual([{ leadId: '2', claimant: 'ACME HOLDINGS LLC', reason: 'An entity, not a person. Sunbiz is the route.' }]);
    expect(r.fileName).toMatch(/^\d{4}-\d{2}-\d{2}_IDI_Batch_Surplus\.csv$/);
  });
});

import { SurplusIdiService } from './surplus-idi.service';
import { IDI_RESULTS_CSV } from './surplus-idi.fixtures';
import { surplusAddressKey } from './surplus-address.util';

/**
 * Applying an IDI results file to the board. Prisma is an in-memory stand-in
 * that keeps every write, so each test reads back what landed where.
 */
function setup(leadsIn: any[], heirsIn: any[] = []) {
  const leads = leadsIn.map((l) => ({ ...l, surplusDetail: { ...l.surplusDetail } }));
  const heirs = heirsIn.map((h) => ({ ...h }));
  // The address list, one shared store behind every detail's `addresses`.
  const addresses: any[] = leads.flatMap((l) =>
    (l.surplusDetail.addresses || []).map((a: any, i: number) => ({
      id: `a${l.id}-${i + 1}`,
      surplusDetailId: l.surplusDetail.id,
      status: 'untried',
      ...a,
      addressKey: a.addressKey || surplusAddressKey(a.street, a.zip),
    })),
  );
  for (const l of leads) {
    Object.defineProperty(l.surplusDetail, 'addresses', {
      get: () => addresses.filter((a) => a.surplusDetailId === l.surplusDetail.id),
      enumerable: true,
      configurable: true,
    });
  }
  const addressWhere = (a: any, where: any) =>
    (!where.surplusDetailId || a.surplusDetailId === where.surplusDetailId) &&
    (!where.addressKey || a.addressKey === where.addressKey) &&
    (!where.status?.not || a.status !== where.status.not);
  const attempts: any[] = [];
  const batches: any[] = [];
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
    surplusAddress: {
      findMany: jest.fn(async ({ where }: any) => addresses.filter((a) => addressWhere(a, where))),
      update: jest.fn(async ({ where, data }: any) => Object.assign(addresses.find((a) => a.id === where.id)!, data)),
      findUnique: jest.fn(async ({ where }: any) => {
        const k = where.surplusDetailId_addressKey;
        return addresses.find((a) => a.surplusDetailId === k.surplusDetailId && a.addressKey === k.addressKey) || null;
      }),
      create: jest.fn(async ({ data }: any) => {
        const made = { id: `a${addresses.length + 1}`, ...data };
        addresses.push(made);
        return made;
      }),
      updateMany: jest.fn(async ({ where, data }: any) => {
        const hit = addresses.filter((a) => addressWhere(a, where));
        hit.forEach((a) => Object.assign(a, data));
        return { count: hit.length };
      }),
      upsert: jest.fn(async ({ where, create, update }: any) => {
        const k = where.surplusDetailId_addressKey;
        const had = addresses.find((a) => a.surplusDetailId === k.surplusDetailId && a.addressKey === k.addressKey);
        if (had) return Object.assign(had, update);
        const made = { id: `a${addresses.length + 1}`, status: 'untried', ...create };
        addresses.push(made);
        return made;
      }),
    },
    surplusDetail: {
      findMany: jest.fn(async ({ where }: any) =>
        leads
          .filter((l) => l.surplusDetail.id !== where.id?.not && l.surplusDetail.caseNumber === where.caseNumber && l.surplusDetail.county === where.county)
          .map((l) => ({ id: l.surplusDetail.id, organizationId: l.surplusDetail.organizationId, lead: l })),
      ),
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
    surplusBatch: {
      findFirst: jest.fn(async ({ where }: any) => {
        if (where.id) {
          const b = batches.find((x) => x.id === where.id && (!where.organizationId || x.organizationId === where.organizationId));
          if (!b) return null;
          const withCase = (m: any) => {
            const l = leads.find((x) => x.surplusDetail.id === m.surplusDetailId)!;
            const own = heirs.filter((h) => h.surplusDetailId === m.surplusDetailId && h.sourceKind === 'idi');
            return { ...m, surplusDetail: { ...l.surplusDetail, lead: l, heirs: own } };
          };
          return { ...b, members: [...b.members].sort((x: any, y: any) => x.rowNumber - y.rowNumber).map(withCase) };
        }
        return [...batches].filter((b) => b.organizationId === where.organizationId).sort((a, b) => b.number - a.number)[0] || null;
      }),
      create: jest.fn(async ({ data }: any) => {
        const id = `b${batches.length + 1}`;
        const members = data.members.create.map((m: any, i: number) => ({ id: `${id}m${i + 1}`, batchId: id, result: null, ...m }));
        const b = { ...data, id, members, createdAt: new Date(Date.now() + batches.length) };
        batches.push(b);
        return { id };
      }),
      findMany: jest.fn(async () =>
        [...batches]
          .sort((a, b) => b.createdAt - a.createdAt)
          .map((b) => ({
            ...b,
            members: b.members.map((m: any) => {
              const l = leads.find((x) => x.surplusDetail.id === m.surplusDetailId)!;
              return { ...m, surplusDetail: { ...l.surplusDetail, lead: l } };
            }),
          })),
      ),
      findUnique: jest.fn(async ({ where }: any) => {
        const b = batches.find((x) => x.id === where.id);
        if (!b) return null;
        const withLead = (m: any) => {
          const l = leads.find((x) => x.surplusDetail.id === m.surplusDetailId)!;
          return { ...m, surplusDetail: { ...l.surplusDetail, leadId: l.id, lead: l } };
        };
        return { ...b, members: b.members.map(withLead) };
      }),
      update: jest.fn(async ({ where, data }: any) => Object.assign(batches.find((b) => b.id === where.id)!, data)),
    },
    user: { findMany: jest.fn(async () => [{ id: 'u1', firstName: 'Ian', lastName: 'Test' }]) },
    surplusBatchMember: {
      update: jest.fn(async ({ where, data }: any) => {
        const m = batches.flatMap((b) => b.members).find((x: any) => x.id === where.id);
        return Object.assign(m, data);
      }),
    },
  };
  const config: any = { get: () => undefined };
  return { service: new SurplusIdiService(prisma, config), leads, heirs, attempts, batches, addresses };
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
    expect(r.fileName).toMatch(/^\d{4}-\d{2}-\d{2}_IDI_Batch_Surplus_B001\.csv$/);
    expect(r.batch).toMatchObject({ number: 1, code: 'B001' });
  });

  it('saves every row exactly as sent, and numbers batches in order', async () => {
    const { service, batches } = setup([
      lead('1', 'JANE Q', 'SAMPLE', '100 Example Rd SE', {
        surplusDetail: { addresses: [{ street: '9 Second Pl', city: 'Akron', state: 'OH', zip: '44301', source: 'case_parties' }] },
      }),
    ]);
    await service.exportBatch({ organizationId: 'org1', leadIds: ['1'], userId: 'u1' });
    const second = await service.exportBatch({ organizationId: 'org1', leadIds: ['1'], userId: 'u1' });

    expect(second.batch?.code).toBe('B002');
    expect(batches[0]).toMatchObject({ organizationId: 'org1', rowCount: 1, skippedCount: 0, createdByUserId: 'u1' });
    expect(batches[0].members[0]).toMatchObject({
      surplusDetailId: 'd1',
      rowNumber: 1,
      sentFirst: 'JANE Q',
      sentLast: 'SAMPLE',
      sentStreet: '9 Second Pl',
      sentState: 'OH',
    });
    expect(batches[1].members[0]).toMatchObject({ sentStreet: '100 Example Rd SE', sentState: 'FL' });
  });

  it('sends the notice address even when the letter came back, and the surname alone', async () => {
    // 2026-11-02: the property got 2 hits in 43, the notice address 7 in 33.
    // A place the claimant once lived is what IDI matches on.
    const { service } = setup([
      lead('1', 'Elgene', 'B Brown', '4808 4th St W', {
        propertyCity: 'Lehigh Acres',
        propertyZip: '33971',
        surplusDetail: {
          ownerMailingStreet: '576 Eastern Pkwy #3G',
          ownerMailingCity: 'Brooklyn',
          ownerMailingState: 'NY',
          ownerMailingZip: '11225',
          mailVerdict: 'undeliverable',
        },
      }),
    ]);
    const r = await service.exportBatch({ organizationId: 'org1', leadIds: ['1'] });
    expect(r.csv.split('\r\n')[1]).toBe('Elgene B,Brown,576 Eastern Pkwy #3G,Brooklyn,NY,11225');
  });

  it('sends one address per person per batch, best first, until none is left', async () => {
    const { service, addresses } = setup([
      lead('1', 'JANE Q', 'SAMPLE', '100 Example Rd SE', {
        surplusDetail: {
          ownerMailingStreet: '48 Village Ct',
          ownerMailingCity: 'Nashotah',
          ownerMailingState: 'WI',
          ownerMailingZip: '53058',
          ownerAddressSource: 'surplus_letter_notifications',
          addresses: [
            { street: 'PO Box 12', city: 'Nashotah', state: 'WI', zip: '53058', source: 'surplus_letter_notifications' },
            { street: '48 Village Ct', city: 'Nashotah', state: 'WI', zip: '53058', source: 'surplus_letter_notifications' },
            { street: '7 Lake St', city: 'Akron', state: 'OH', zip: '44301', source: 'case_parties' },
            { street: 'RT 1 Box 15', city: 'Pullman', state: 'WV', zip: '26421', source: 'surplus_letter_notifications' },
            { street: '1 Rue de Paris', city: 'Paris', state: null, zip: '75001', country: 'FRANCE', source: 'surplus_letter_notifications' },
          ],
        },
      }),
    ]);
    const sent: string[] = [];
    for (let round = 0; round < 5; round += 1) {
      const r = await service.exportBatch({ organizationId: 'org1', leadIds: ['1'] });
      sent.push(r.csv.split('\r\n')[1].split(',')[2]);
    }
    // The card first, then the clerk's other letter, then any street, then the box, then the house that sold.
    expect(sent).toEqual(['48 Village Ct', 'RT 1 Box 15', '7 Lake St', 'PO Box 12', '100 Example Rd SE']);
    expect(addresses.filter((a) => a.status === 'sent')).toHaveLength(5);

    const done = await service.exportBatch({ organizationId: 'org1', leadIds: ['1'] });
    expect(done.batch).toBeNull();
    expect(done.skipped[0].reason).toBe('Every address on file has been sent to IDI. Research by name.');
  });

  it('sends a US address on the list ahead of a foreign card address', async () => {
    // Lee 2025001309: the card kept Canada and dropped Key West, so the claimant was never sent.
    const { service } = setup([
      lead('1', 'JANE Q', 'SAMPLE', '0 Lot Rd', {
        surplusDetail: {
          ownerMailingStreet: '12 King St',
          ownerMailingCity: 'Toronto',
          ownerMailingState: 'ON',
          ownerMailingCountry: 'CANADA',
          addresses: [{ street: '3 Duval St', city: 'Key West', state: 'FL', zip: '33040', source: 'surplus_letter_notifications' }],
        },
      }),
    ]);
    const r = await service.exportBatch({ organizationId: 'org1', leadIds: ['1'] });
    expect(r.csv.split('\r\n')[1]).toBe('JANE Q,SAMPLE,3 Duval St,Key West,FL,33040');
  });

  it('falls back to the property only when it is a real house, and records it as sent', async () => {
    const { service, addresses } = setup([
      lead('1', 'JANE Q', 'SAMPLE', '100 Example Rd SE'),
      lead('2', 'PAUL G', 'EXAMPLE', '0 Sample Ct'),
    ]);
    const r = await service.exportBatch({ organizationId: 'org1', leadIds: ['1', '2'] });
    expect(r.included).toBe(1);
    expect(r.skipped).toEqual([
      { leadId: '2', claimant: 'PAUL G EXAMPLE', reason: 'Only the property is known, and it has no house number. Research by name.' },
    ]);
    expect(addresses).toEqual([expect.objectContaining({ surplusDetailId: 'd1', street: '100 Example Rd SE', source: 'property', status: 'sent' })]);

    const again = await service.exportBatch({ organizationId: 'org1', leadIds: ['1'] });
    expect(again.skipped[0].reason).toBe('Every address on file has been sent to IDI. Research by name.');
  });

  it('saves no batch when nobody can be sent', async () => {
    const { service, batches } = setup([lead('2', 'ACME HOLDINGS', 'LLC', '1 Main St')]);
    const r = await service.exportBatch({ organizationId: 'org1', leadIds: ['2'] });
    expect(r.batch).toBeNull();
    expect(batches).toHaveLength(0);
  });
});

describe('SurplusIdiService batches on import', () => {
  // Two cases for the same owner at the same address: by name and address
  // they are a tie, and only the batch knows which row was sent for which.
  const twins = () => [
    lead('1', 'JANE Q', 'SAMPLE', '100 Example Rd SE', { surplusDetail: { caseNumber: 'case-A' } }),
    lead('3', 'JANE Q', 'SAMPLE', '100 Example Rd SE', { surplusDetail: { caseNumber: 'case-B' } }),
    lead('2', 'PAUL G', 'EXAMPLE', '7500 E Sample Ct'),
  ];

  it('without a saved batch the twins are ambiguous', async () => {
    const { service } = setup(twins());
    const { rows, batch } = await service.previewImport(file, { organizationId: 'org1', fileName: 'x_out.csv' });
    expect(batch).toBeNull();
    expect(rows[0].confidence).toBe('ambiguous');
  });

  it('pairs each returned row with the row it echoes in the batch', async () => {
    const { service } = setup(twins());
    await service.exportBatch({ organizationId: 'org1', leadIds: ['3', '2'] });
    const { rows, batch } = await service.previewImport(file, { organizationId: 'org1', fileName: 'x_out.csv' });

    expect(batch).toMatchObject({ code: 'B001', paired: 2, rowCount: 2 });
    expect(rows.map((r) => [r.leadId, r.confidence, r.batchRow])).toEqual([
      ['3', 'batch', 1],
      [null, 'none', null],
      ['2', 'batch', 2],
    ]);
    // The other twin is still offered, in case a person knows better.
    expect(rows[0].options.map((o) => o.leadId)).toEqual(['3', '1']);
  });

  it('records what came back on the batch rows and stamps the batch', async () => {
    const { service, batches } = setup(twins());
    await service.exportBatch({ organizationId: 'org1', leadIds: ['3', '2'] });
    const res = await service.applyImport(file, { organizationId: 'org1', fileName: 'x_out.csv', userId: 'u1' });

    expect(res.batch).toEqual({ id: 'b1', code: 'B001' });
    const [jane, paul] = batches[0].members;
    expect(jane).toMatchObject({ result: 'matched', deceased: false, phonesReturned: 3, emailsReturned: 2, relativesFiled: 2 });
    expect(paul).toMatchObject({ result: 'matched', deceased: true });
    expect(batches[0]).toMatchObject({ resultsFileName: 'x_out.csv', resultsAppliedById: 'u1' });
    expect(batches[0].resultsAppliedAt).toBeInstanceOf(Date);
  });

  it('marks an empty row on the batch without writing to the claimant', async () => {
    const nobody = lead('4', 'GLEN A', 'NOBODY', '1 Vacant Lot Rd');
    const { service, batches, leads } = setup([nobody]);
    await service.exportBatch({ organizationId: 'org1', leadIds: ['4'] });
    const res = await service.applyImport(file, { organizationId: 'org1', fileName: 'x_out.csv', assignments: { '1': null } });

    expect(res.applied).toBe(0);
    expect(batches[0].members[0]).toMatchObject({ result: 'no_person' });
    expect(batches[0].resultsFileName).toBe('x_out.csv');
    expect(leads[0].surplusDetail.tracedAt).toBeUndefined();
  });

  it('marks the address that hit and the one that missed, and says what is left', async () => {
    const { service, addresses, leads } = setup([
      lead('1', 'JANE Q', 'SAMPLE', '100 Example Rd SE'),
      lead('4', 'GLEN A', 'NOBODY', '0 Lot Rd', {
        surplusDetail: {
          addresses: [
            { street: '1 Vacant Lot Rd', city: 'Palm Bay', state: 'FL', zip: '32909', source: 'case_parties', firstSeenAt: new Date('2026-01-01') },
            { street: '22 Next St', city: 'Ocala', state: 'FL', zip: '34470', source: 'case_parties', firstSeenAt: new Date('2026-02-01') },
          ],
        },
      }),
    ]);
    await service.exportBatch({ organizationId: 'org1', leadIds: ['1', '4'] });
    await service.applyImport(file, { organizationId: 'org1', fileName: 'x_out.csv' });

    const status = (detail: string) => addresses.filter((a) => a.surplusDetailId === detail).map((a) => [a.street, a.status]);
    expect(status('d1')).toEqual([['100 Example Rd SE', 'hit']]);
    expect(status('d4')).toEqual([
      ['1 Vacant Lot Rd', 'miss'],
      ['22 Next St', 'untried'],
    ]);
    expect(leads[1].surplusDetail.traceOutcome).toBe('no_person');
    expect(leads[1].surplusDetail.traceDetail).toContain('1 more address on file, so the next batch tries the next one.');

    // Round two sends Glen at the next address.
    const round2 = await service.exportBatch({ organizationId: 'org1', leadIds: ['4'] });
    expect(round2.csv.split('\r\n')[1]).toBe('GLEN A,NOBODY,22 Next St,Ocala,FL,34470');
  });

  it('marks the list from a results file no saved batch sent, so the next round moves on', async () => {
    // The 2026-11-02 files were built outside DealCore and match no saved batch.
    const { service, addresses } = setup([
      lead('4', 'GLEN A', 'NOBODY', '0 Lot Rd', {
        surplusDetail: { addresses: [{ street: '1 Vacant Lot Rd', city: 'Palm Bay', state: 'FL', zip: '32909', source: 'case_parties' }] },
      }),
      lead('1', 'JANE Q', 'SAMPLE', '0 Lot Rd'),
    ]);
    await service.applyImport(file, { organizationId: 'org1', assignments: { '1': '4' } });
    expect(addresses.map((a) => [a.surplusDetailId, a.street, a.source, a.status])).toEqual([
      ['d4', '1 Vacant Lot Rd', 'case_parties', 'miss'],
      ['d1', '100 Example Rd SE', 'idi_sent', 'hit'],
    ]);
  });

  it('never lets a miss undo a person already found', async () => {
    const found = lead('4', 'GLEN A', 'NOBODY', '1 Vacant Lot Rd', {
      surplusDetail: { traceOutcome: 'matched', traceDetail: 'IDI matched GLEN A NOBODY at 9 Old Rd', tracedAt: new Date('2026-10-01'), callNotes: 'IDI batch matched Glen.' },
    });
    const { service, leads, attempts } = setup([found]);
    await service.applyImport(file, { organizationId: 'org1', assignments: { '1': '4' } });
    expect(leads[0].surplusDetail).toMatchObject({
      traceOutcome: 'matched',
      traceDetail: 'IDI matched GLEN A NOBODY at 9 Old Rd',
      callNotes: 'IDI batch matched Glen.',
    });
    expect(attempts[0]).toMatchObject({ source: 'IDI', result: 'nothing' });
  });

  it('puts a co-owner IDI lists as a relative on that co-owner\'s address list', async () => {
    // Jane's row lists John P Sample Jr at 48 Village Ct Apt 2; John is on the same case.
    const { service, addresses } = setup([
      lead('1', 'JANE Q', 'SAMPLE', '100 Example Rd SE', { surplusDetail: { caseNumber: 'case-S' } }),
      lead('5', 'JOHN P', 'SAMPLE', '100 Example Rd SE', { surplusDetail: { caseNumber: 'case-S' } }),
    ]);
    await service.applyImport(file, { organizationId: 'org1', assignments: { '0': '1' } });
    expect(addresses.filter((a) => a.surplusDetailId === 'd5')).toEqual([
      expect.objectContaining({ street: '48 VILLAGE CT APT 2', city: 'SPRINGFIELD', state: 'WI', source: 'idi_relative', status: 'untried', nameOnRecord: 'JOHN P SAMPLE JR' }),
    ]);
    // Jane's own list holds only where she was found: a relative's address is not hers.
    expect(addresses.filter((a) => a.surplusDetailId === 'd1').map((a) => [a.street, a.status])).toEqual([['100 Example Rd SE', 'hit']]);
  });

  it('sends one owner on two cases once, and gives both cases the result', async () => {
    // Douglas Garcia went out twice in B001 and IDI charged for both hits.
    const { service, batches, leads, addresses } = setup([
      lead('1', 'JANE Q', 'SAMPLE', '100 Example Rd SE', { surplusDetail: { caseNumber: 'case-A' } }),
      lead('3', 'JANE Q', 'SAMPLE', '100 Example Rd SE', { surplusDetail: { caseNumber: 'case-B' } }),
    ]);
    const out = await service.exportBatch({ organizationId: 'org1', leadIds: ['1', '3'] });
    expect(out.included).toBe(1);
    expect(out.csv.split('\r\n').filter(Boolean)).toHaveLength(2);
    expect(out.skipped).toEqual([
      { leadId: '3', claimant: 'JANE Q SAMPLE', reason: 'Same person at the same address as row 1, for another case. Sent once; the result goes to both.' },
    ]);
    expect(batches[0]).toMatchObject({ rowCount: 1 });
    expect(batches[0].members.map((m: any) => [m.rowNumber, m.surplusDetailId])).toEqual([
      [1, 'd1'],
      [2, 'd3'],
    ]);

    const res = await service.applyImport(file, { organizationId: 'org1', fileName: 'x_out.csv' });
    expect(res.applied).toBe(2);
    expect(leads.map((l) => l.sellerPhone)).toEqual(['+12625550101', '+12625550101']);
    expect(batches[0].members.map((m: any) => m.result)).toEqual(['matched', 'matched']);
    expect(addresses.map((a) => [a.surplusDetailId, a.status])).toEqual([
      ['d1', 'hit'],
      ['d3', 'hit'],
    ]);
  });

  it('leaves a batch row alone when a person re-points the result', async () => {
    const { service, batches } = setup(twins());
    await service.exportBatch({ organizationId: 'org1', leadIds: ['3', '2'] });
    await service.applyImport(file, { organizationId: 'org1', fileName: 'x_out.csv', assignments: { '0': '1' } });
    expect(batches[0].members[0].result).toBeNull();
  });
});

describe('SurplusIdiService batch list and detail', () => {
  const people = () => [
    lead('1', 'JANE Q', 'SAMPLE', '100 Example Rd SE', { lastTouchedAt: null }),
    lead('2', 'PAUL G', 'EXAMPLE', '7500 E Sample Ct', { lastTouchedAt: null }),
  ];

  it('counts what came back and who has been worked since', async () => {
    const { service, leads } = setup(people());
    await service.exportBatch({ organizationId: 'org1', leadIds: ['1', '2'], userId: 'u1' });
    await service.applyImport(file, { organizationId: 'org1', fileName: 'x_out.csv' });
    leads[0].lastTouchedAt = new Date(Date.now() + 60_000);

    const [b] = await service.listBatches('org1');
    expect(b).toMatchObject({
      code: 'B001',
      createdBy: 'Ian Test',
      rowCount: 2,
      matched: 2,
      noPerson: 0,
      waiting: 0,
      deceased: 1,
      relativesFiled: 4,
      touchedSince: 1,
      resultsFileName: 'x_out.csv',
    });
  });

  it('lists each row with its claimant today and the relatives IDI filed', async () => {
    const { service } = setup(people());
    const exp = await service.exportBatch({ organizationId: 'org1', leadIds: ['1', '2'] });
    await service.applyImport(file, { organizationId: 'org1', fileName: 'x_out.csv' });

    const found = await service.getBatch(exp.batch!.id, 'org1');
    expect(found?.members.map((m) => [m.rowNumber, m.claimant, m.result])).toEqual([
      [1, 'JANE Q SAMPLE', 'matched'],
      [2, 'PAUL G EXAMPLE', 'matched'],
    ]);
    const jane = found!.members[0];
    expect(jane.phoneCount).toBe(3);
    expect(jane.relatives.map((r) => r.name)).toEqual(['JOHN P SAMPLE JR', 'ANN SAMPLE']);
    expect(jane.relatives[0].phones).toEqual(['(262) 555-0201', '(262) 555-0202']);
    expect(found!.members[1].claimantDeceased).toBe(true);
  });

  it('does not open another organization\'s batch', async () => {
    const { service } = setup(people());
    const exp = await service.exportBatch({ organizationId: 'org1', leadIds: ['1'] });
    expect(await service.getBatch(exp.batch!.id, 'org2')).toBeNull();
  });
});

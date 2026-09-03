import { SurplusIngestService } from './surplus-ingest.service';

/**
 * The re-read path, which is the only part of ingestion that OVERWRITES an
 * address rather than filling a gap.
 *
 * It exists because the notice extractor used to read only the first page of a
 * Notice of Surplus Funds, and the clerk prints one page per recipient. On a
 * co-owned case that gave every claimant whichever recipient came first, so a
 * skip trace aimed at the co-owner and returned them, which looks exactly like
 * a hit. Correcting that means writing over data already on the row, so the
 * guards around it are worth pinning.
 */

const RECIPIENTS = [
  { name: 'RICHARD MINTON', street: '4027 BESSENT RD', city: 'JACKSONVILLE', state: 'FL', zip: '32206' },
  { name: 'CECELIA W HARRIS', street: '1841 W 14TH ST', city: 'JACKSONVILLE', state: 'FL', zip: '32209' },
];

function harness(existing: any[], recipients = RECIPIENTS) {
  const updates: any[] = [];
  const prisma: any = {
    surplusPollRun: {
      create: jest.fn().mockResolvedValue({ id: 'run1' }),
      update: jest.fn().mockResolvedValue({}),
    },
    surplusSuppression: { findFirst: jest.fn().mockResolvedValue(null) },
    surplusDetail: {
      count: jest.fn().mockResolvedValue(existing.length),
      findFirst: jest.fn(async ({ where }: any) =>
        existing.find((e) => where.dedupeUid === e.dedupeUid) || null,
      ),
      // The tiered refresh reads what is held by county case id. The Duval
      // stub has no probe, so these rows only matter to the tiered tests.
      findMany: jest.fn(async () => existing.filter((e) => e.sourceCaseId)),
      update: jest.fn(async (a: any) => { updates.push(a); return {}; }),
      updateMany: jest.fn(async (a: any) => { updates.push(a); return { count: 1 }; }),
    },
  };

  const adapter: any = {
    key: 'duval_taxdeed',
    county: 'Duval',
    cadence: 'daily',
    detailDelayMs: 0,
    baseUrl: 'https://taxdeed.duvalclerk.com',
    isLive: () => true,
    listSurplusCases: jest.fn().mockResolvedValue([
      { sourceCaseId: '1', status: 'SOLD', surplus: 105670.33 },
    ]),
    fetchCase: jest.fn().mockResolvedValue({
      caseNumber: '2026-0011TD',
      parcelId: '0123456789',
      owners: ['RICHARD MINTON', 'CECELIA W HARRIS'],
      surplus: 105670.33,
      documents: [{ title: 'Notice of Surplus Funds', docId: '103369', url: '/Home/Image/103369' }],
      propertyAddress: '4027 BESSENT RD',
    }),
  };

  const notice: any = {
    // The service refuses to read when the vision key is absent.
    available: true,
    readNotice: jest.fn().mockResolvedValue({
      recipients,
      recipient: recipients[0]?.name ?? null,
      noticeDate: '2026-06-25',
      surplusAtNotice: 105670.33,
    }),
  };

  const svc = new SurplusIngestService(prisma, {} as any, adapter, notice);
  // The real class registers its own adapter list; point it at the stub.
  jest.spyOn(svc, 'adapterFor').mockReturnValue(adapter);
  (svc as any).pause = () => Promise.resolve();
  return { svc, prisma, notice, updates };
}

const row = (over: any) => ({
  id: over.id,
  leadId: `lead-${over.id}`,
  stage: 'New',
  claimStatus: 'open',
  dedupeUid: over.dedupeUid,
  ownerMailingStreet: over.street ?? null,
  ownerAddressSource: over.source ?? null,
});

/** dedupeUid is "COUNTY|CASE|CLAIMANT", uppercased with spaces as underscores. */
const uid = (claimant: string) =>
  `DUVAL|2026-0011TD|${claimant.toUpperCase().replace(/\s+/g, '_')}`;

beforeEach(() => jest.clearAllMocks());

describe('re-reading notices to correct an address', () => {
  it('gives each claimant the page addressed to THEM, replacing a co-owner\'s', async () => {
    // Both rows carry Richard's address, which is what the single-page
    // extractor produced. Cecelia's must be corrected to her own.
    const { svc, updates } = harness([
      row({ id: 'd1', dedupeUid: uid('RICHARD MINTON'), street: '4027 BESSENT RD', source: 'notice_of_surplus_funds' }),
      row({ id: 'd2', dedupeUid: uid('CECELIA W HARRIS'), street: '4027 BESSENT RD', source: 'notice_of_surplus_funds' }),
    ]);

    await svc.ingestCounty('duval_taxdeed', { reread: true });

    const byId = Object.fromEntries(updates.map((u) => [u.where.id, u.data]));
    expect(byId.d1.ownerMailingStreet).toBe('4027 BESSENT RD');
    expect(byId.d2.ownerMailingStreet).toBe('1841 W 14TH ST');
    expect(byId.d2.noticeRecipient).toBe('CECELIA W HARRIS');
  });

  it('leaves an address a person typed in by hand alone', async () => {
    // Somebody went and found the owner. That outranks anything read off a
    // scan, and overwriting it silently would leave the row looking filled in.
    const { svc, updates } = harness([
      row({ id: 'd1', dedupeUid: uid('RICHARD MINTON'), street: '99 HAND ENTERED ST', source: 'manual' }),
      row({ id: 'd2', dedupeUid: uid('CECELIA W HARRIS'), street: '4027 BESSENT RD', source: 'notice_of_surplus_funds' }),
    ]);

    await svc.ingestCounty('duval_taxdeed', { reread: true });

    const byId = Object.fromEntries(updates.map((u) => [u.where.id, u.data]));
    expect(byId.d1.ownerMailingStreet).toBeUndefined();
    expect(byId.d2.ownerMailingStreet).toBe('1841 W 14TH ST');
  });

  it('clears an address when no notice page is addressed to that claimant', async () => {
    // The read succeeded and Cecelia is not on it, so what her row holds came
    // off Richard's page. Blank prompts a name search; wrong gets skip traced.
    const { svc, updates } = harness(
      [
        row({ id: 'd1', dedupeUid: uid('RICHARD MINTON'), street: '4027 BESSENT RD', source: 'notice_of_surplus_funds' }),
        row({ id: 'd2', dedupeUid: uid('CECELIA W HARRIS'), street: '4027 BESSENT RD', source: 'notice_of_surplus_funds' }),
      ],
      [RECIPIENTS[0]],
    );

    await svc.ingestCounty('duval_taxdeed', { reread: true });

    const byId = Object.fromEntries(updates.map((u) => [u.where.id, u.data]));
    expect(byId.d2.ownerMailingStreet).toBeNull();
    expect(byId.d2.ownerAddressSource).toBeNull();
  });

  it('does not read the notice at all on an ordinary poll', async () => {
    // The answer does not change between polls and the read costs a vision
    // call, so a nightly run must not pay for it once an address is on file.
    const { svc, notice, updates } = harness([
      row({ id: 'd1', dedupeUid: uid('RICHARD MINTON'), street: '4027 BESSENT RD', source: 'notice_of_surplus_funds' }),
      row({ id: 'd2', dedupeUid: uid('CECELIA W HARRIS'), street: '4027 BESSENT RD', source: 'notice_of_surplus_funds' }),
    ]);

    await svc.ingestCounty('duval_taxdeed', {});

    expect(notice.readNotice).not.toHaveBeenCalled();
    const byId = Object.fromEntries(updates.map((u) => [u.where.id, u.data]));
    expect(byId.d2.ownerMailingStreet).toBeUndefined();
  });
});

/**
 * What a poll must never undo.
 *
 * The county is authoritative about the CASE (what is filed, what is owed).
 * It knows nothing about the work: the notes somebody typed, the number they
 * found by hand, or their decision that this one is dead. A poll that resets
 * any of those turns a morning of work into nothing, silently, overnight.
 */
describe('a refresh preserves the work', () => {
  it('leaves a lead marked Dead marked Dead', async () => {
    const { svc, updates } = harness([
      row({ id: 'd1', dedupeUid: uid('RICHARD MINTON'), street: '4027 BESSENT RD', source: 'notice_of_surplus_funds' }),
    ]);
    // The row is Dead; the docket still says the claim is open.
    (svc as any).prisma.surplusDetail.findFirst = jest.fn(async () => ({
      id: 'd1',
      leadId: 'lead-d1',
      stage: 'Dead',
      claimStatus: 'open',
      ownerMailingStreet: '4027 BESSENT RD',
      ownerAddressSource: 'notice_of_surplus_funds',
    }));

    await svc.ingestCounty('duval_taxdeed', {});

    const patch = updates.find((u) => u.where.id === 'd1')?.data;
    // Never un-retires: no stage key at all, so Dead survives untouched.
    expect(patch.stage).toBeUndefined();
  });

  it('does not touch notes, phones, emails or the do-not-call flag', async () => {
    const { svc, updates } = harness([
      row({ id: 'd1', dedupeUid: uid('RICHARD MINTON'), street: '4027 BESSENT RD', source: 'notice_of_surplus_funds' }),
    ]);

    await svc.ingestCounty('duval_taxdeed', {});

    const patch = updates.find((u) => u.where.id === 'd1')?.data || {};
    for (const field of [
      'callNotes', 'doNotCall', 'phone2', 'phone3', 'phone4',
      'phone1Type', 'phone1Dnc', 'email2', 'touchDays', 'touchCount',
      'contactMismatch', 'tracedAt', 'traceOutcome',
    ]) {
      expect(patch[field]).toBeUndefined();
    }
  });

  it('will not recreate a case somebody deleted', async () => {
    // No existing row, so this would normally be a create. The tombstone stops
    // it: without this the case comes back every morning with the work gone.
    const { svc, prisma } = harness([]);
    prisma.surplusSuppression.findFirst = jest.fn().mockResolvedValue({ id: 'sup-1' });

    const res = await svc.ingestCounty('duval_taxdeed', {});

    expect(res.created).toBe(0);
    expect(prisma.surplusSuppression.findFirst).toHaveBeenCalled();
  });
});

/**
 * The tiered refresh, on a source that can probe its docket (RealTDM).
 *
 * A weekly refresh of Lee at full price was 2,600 requests. Nearly every held
 * case is unchanged week to week, and one request says so. These pin the
 * three tiers: unchanged (probe only), changed (lite fetch), and paid out
 * (retired from the list row, no fetch at all).
 */
describe('tiered refresh', () => {
  const held = {
    id: 'd1',
    leadId: 'lead-d1',
    stage: 'New',
    claimStatus: 'open',
    dedupeUid: 'LEE|2025000391|BEVERLY_F_KONOPKA',
    sourceCaseId: '82214',
    claimLedger: [
      { title: 'SURPLUS_LETTER', kind: 'notice_surplus', docId: '9825843' },
      { title: 'Recorded Tax Deed', kind: 'other', docId: '9808814' },
    ],
    ownerMailingStreet: '130 WOODIN STREET',
    ownerAddressSource: 'surplus_letter_notifications',
  };

  function lee(status = 'ACTIVE - SOLD BIDDER', newest = '9825843') {
    const { svc, prisma, updates } = harness([held]);
    const adapter: any = {
      key: 'realtdm_lee',
      county: 'Lee',
      cadence: 'weekly',
      detailDelayMs: 0,
      isLive: (s: any) => /^ACTIVE/.test(s.status),
      isPaidOut: (s: any) => /^COMPLETED/.test(s.status),
      probeDocket: jest.fn().mockResolvedValue(newest),
      listSurplusCases: jest.fn().mockResolvedValue([
        { sourceCaseId: '82214', caseNumber: '2025000391', status, surplus: 9000 },
      ]),
      fetchCase: jest.fn().mockResolvedValue({
        sourceCaseId: '82214',
        caseNumber: '2025000391',
        owners: ['BEVERLY F KONOPKA'],
        surplus: 9000,
        documents: [
          { title: 'SURPLUS_LETTER', docId: '9825843', filedAt: '2025-09-17' },
          { title: 'Surplus Claim_Fast Funding LLC', docId: '9999999', filedAt: '2026-01-05', claimant: 'Fast Funding LLC' },
        ],
        noticeRecipients: [
          { name: 'BEVERLY F KONOPKA', street: '130 WOODIN STREET', city: 'HAMDEN', state: 'CT', zip: '06489' },
        ],
        noticeDate: '2025-09-17',
      }),
    };
    jest.spyOn(svc, 'adapterFor').mockReturnValue(adapter);
    return { svc, prisma, updates, adapter };
  }

  it('an unchanged docket is one probe request and no fetch', async () => {
    const { svc, updates, adapter } = lee();

    const res = await svc.ingestCounty('realtdm_lee', {});

    expect(adapter.probeDocket).toHaveBeenCalledWith('82214');
    expect(adapter.fetchCase).not.toHaveBeenCalled();
    expect(res.unchanged).toBe(1);
    expect(res.classified).toBe(0);
    // The posted balance still carries over from the list row.
    const touch = updates.find((u) => u.data?.lastPolledAt && u.data?.grossSurplus === 9000);
    expect(touch).toBeTruthy();
  });

  it('a new filing triggers a lite fetch and reclassifies the case', async () => {
    const { svc, updates, adapter } = lee('ACTIVE - SOLD BIDDER', '9999999');

    const res = await svc.ingestCounty('realtdm_lee', {});

    expect(adapter.fetchCase).toHaveBeenCalledWith('82214', { lite: true });
    expect(res.unchanged).toBe(0);
    expect(res.updated).toBe(1);
    const patch = updates.find((u) => u.where?.id === 'd1')?.data;
    expect(patch.claimStatus).toBe('pending');
  });

  it('a case the list says is paid out is retired without a fetch', async () => {
    const { svc, updates, adapter } = lee('COMPLETED - SOLD BIDDER');

    const res = await svc.ingestCounty('realtdm_lee', {});

    expect(adapter.probeDocket).not.toHaveBeenCalled();
    expect(adapter.fetchCase).not.toHaveBeenCalled();
    expect(res.retiredFromList).toBe(1);
    const patch = updates.find((u) => u.where?.id === 'd1')?.data;
    expect(patch.stage).toBe('Dead');
    expect(patch.claimStatus).toBe('distributed');
  });

  it('full mode fetches every held case regardless of the probe', async () => {
    const { svc, adapter } = lee();

    await svc.ingestCounty('realtdm_lee', { full: true });

    expect(adapter.probeDocket).not.toHaveBeenCalled();
    expect(adapter.fetchCase).toHaveBeenCalledWith('82214', { lite: false });
  });
});

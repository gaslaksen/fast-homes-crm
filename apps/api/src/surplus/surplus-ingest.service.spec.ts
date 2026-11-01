import { SurplusIngestService, tooOldToPull } from './surplus-ingest.service';

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
    surplusSuppression: {
      findFirst: jest.fn().mockResolvedValue(null),
      // Cases the county already resolved, remembered so they are never
      // fetched again. Empty unless a test seeds it.
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn(async (a: any) => { updates.push(a); return {}; }),
    },
    surplusDetail: {
      // Rows on the case holding an address, as the notice gate asks.
      count: jest.fn(async ({ where }: any) =>
        existing.filter(
          (e) =>
            (!where?.dedupeUid?.in || where.dedupeUid.in.includes(e.dedupeUid)) &&
            (!where?.ownerMailingStreet || e.ownerMailingStreet),
        ).length,
      ),
      findFirst: jest.fn(async ({ where }: any) =>
        existing.find((e) => where.dedupeUid === e.dedupeUid) || null,
      ),
      // The tiered refresh reads what is held by county case id. The Duval
      // stub has no probe, so these rows only matter to the tiered tests.
      // The notice gate asks by dedupeUid for the rows of one case.
      findMany: jest.fn(async ({ where }: any) =>
        where?.dedupeUid?.in
          ? existing.filter((e) => where.dedupeUid.in.includes(e.dedupeUid))
          : existing.filter((e) => e.sourceCaseId),
      ),
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
    // The day of the estimated clock the sweep first reads on, and the
    // monthly budget gate. Both live on the notice service.
    readDay: 95,
    canSpend: jest.fn().mockResolvedValue({ ok: true }),
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
  noticeReadDocId: over.noticeReadDocId ?? null,
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
 * A notice read is a paid vision call, and the address it yields is first
 * needed when the case matures into the trace window at day 110. So the pull
 * does not read a case that lands with no address: the clock is estimated from
 * the sale date, noticeConfirmed stays false, and the weekly sweep reads the
 * notice once the estimate reaches day 95 (readMaturedNotices). A case the
 * county pays out before then is never read. Before this (2026-11-01) every
 * workable case was read the week it landed.
 */
describe('deferring the notice read', () => {
  const blank = () => [
    row({ id: 'd1', dedupeUid: uid('RICHARD MINTON') }),
    row({ id: 'd2', dedupeUid: uid('CECELIA W HARRIS') }),
  ];
  const marked = (updates: any[]) => updates.find((u) => u.data?.noticeReadDocId !== undefined);

  it('does not read the notice when a case lands with no address', async () => {
    const { svc, notice, updates } = harness(blank(), []);

    await svc.ingestCounty('duval_taxdeed', {});

    expect(notice.readNotice).not.toHaveBeenCalled();
    expect(marked(updates)).toBeUndefined();
  });

  it('still reads on an explicit re-read, and records the read on every row of the case', async () => {
    const rows = blank().map((r) => ({ ...r, noticeReadDocId: '103369' }));
    const { svc, notice, updates } = harness(rows, []);

    await svc.ingestCounty('duval_taxdeed', { reread: true });

    expect(notice.readNotice).toHaveBeenCalledTimes(1);
    const mark = marked(updates);
    expect(mark.data.noticeReadDocId).toBe('103369');
    expect(mark.where.dedupeUid.in).toEqual([uid('RICHARD MINTON'), uid('CECELIA W HARRIS')]);
  });

  it('does not record a re-read that failed, so the next one tries again', async () => {
    const { svc, notice, updates } = harness(blank(), []);
    notice.readNotice.mockResolvedValue(null);

    await svc.ingestCounty('duval_taxdeed', { reread: true });

    expect(notice.readNotice).toHaveBeenCalledTimes(1);
    expect(marked(updates)).toBeUndefined();
  });
});

/**
 * The sweep that reads what the pull deferred: this county's workable cases
 * with no address and an unread notice on the docket, once their estimated
 * clock has reached the read day. Recipients, the real notice date and the
 * surplus at notice land exactly as a read at creation landed them.
 */
describe('reading matured notices', () => {
  const NOW = new Date('2026-11-02T09:30:00Z');
  const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86400000);
  const LEDGER = [{ title: 'Notice of Surplus Funds', kind: 'notice_surplus', docId: '103369', url: '/Home/Image/103369' }];

  /** A held row of a case with a notice on its docket, no address, sold `age` days ago. */
  const held = (id: string, claimant: string, over: any = {}) => ({
    ...row({ id, dedupeUid: uid(claimant) }),
    caseNumber: '2026-0011TD',
    sourceCaseId: '1',
    sourceSystem: 'duval_taxdeed',
    claimLedger: LEDGER,
    saleDate: daysAgo(over.age ?? 100),
    noticeDate: over.noticeDate ?? daysAgo(over.age ?? 100),
    ...over,
  });
  const patch = (updates: any[], id: string) => updates.find((u) => u.where?.id === id)?.data;

  it('reads the notice once the estimated clock reaches day 95, and applies it to every row', async () => {
    const rows = [held('d1', 'RICHARD MINTON'), held('d2', 'CECELIA W HARRIS')];
    const { svc, notice, updates } = harness(rows);

    const r = await svc.readMaturedNotices('duval_taxdeed', { now: NOW });

    expect(notice.readNotice).toHaveBeenCalledTimes(1);
    expect(notice.readNotice).toHaveBeenCalledWith('https://taxdeed.duvalclerk.com/Home/Image/103369');
    expect(r).toMatchObject({ candidates: 1, read: 1, addressed: 2, tooYoung: 0, errors: 0 });
    // Each claimant takes THEIR page, as at ingest.
    expect(patch(updates, 'd1')).toMatchObject({
      noticeRecipient: 'RICHARD MINTON',
      ownerMailingStreet: '4027 BESSENT RD',
      ownerMailingCity: 'JACKSONVILLE',
      ownerAddressSource: 'notice_of_surplus_funds',
      noticeConfirmed: true,
      surplusAtNotice: 105670.33,
      noticeReadDocId: '103369',
    });
    expect(patch(updates, 'd2')).toMatchObject({
      noticeRecipient: 'CECELIA W HARRIS',
      ownerMailingStreet: '1841 W 14TH ST',
      noticeConfirmed: true,
      noticeReadDocId: '103369',
    });
    // The real date replaces the estimate off the sale date.
    expect(patch(updates, 'd1').noticeDate).toEqual(new Date('2026-06-25T00:00:00'));
  });

  it('leaves a case under day 95 alone and counts it as too young', async () => {
    const { svc, notice, updates } = harness([held('d1', 'RICHARD MINTON', { age: 60 }), held('d2', 'CECELIA W HARRIS', { age: 60 })]);

    const r = await svc.readMaturedNotices('duval_taxdeed', { now: NOW });

    expect(notice.readNotice).not.toHaveBeenCalled();
    expect(r).toMatchObject({ candidates: 1, read: 0, tooYoung: 1 });
    expect(updates).toHaveLength(0);
  });

  it('honours SURPLUS_NOTICE_READ_DAY', async () => {
    const { svc, notice } = harness([held('d1', 'RICHARD MINTON', { age: 60 })]);
    notice.readDay = 50;

    const r = await svc.readMaturedNotices('duval_taxdeed', { now: NOW });

    expect(notice.readNotice).toHaveBeenCalledTimes(1);
    expect(r.read).toBe(1);
  });

  it('never reads a case where any claimant already has an address', async () => {
    const { svc, notice } = harness([
      held('d1', 'RICHARD MINTON', { street: '4027 BESSENT RD', ownerMailingStreet: '4027 BESSENT RD' }),
      held('d2', 'CECELIA W HARRIS'),
    ]);

    const r = await svc.readMaturedNotices('duval_taxdeed', { now: NOW });

    expect(notice.readNotice).not.toHaveBeenCalled();
    expect(r.candidates).toBe(0);
  });

  it('does not buy the same notice again when it named nobody on the case', async () => {
    const { svc, notice } = harness([
      held('d1', 'RICHARD MINTON', { noticeReadDocId: '103369' }),
      held('d2', 'CECELIA W HARRIS', { noticeReadDocId: '103369' }),
    ]);

    const r = await svc.readMaturedNotices('duval_taxdeed', { now: NOW });

    expect(notice.readNotice).not.toHaveBeenCalled();
    expect(r.candidates).toBe(0);
  });

  it('reads a new notice when the case is re-noticed', async () => {
    const { svc, notice } = harness([held('d1', 'RICHARD MINTON', { noticeReadDocId: '99999' })]);

    await svc.readMaturedNotices('duval_taxdeed', { now: NOW });

    expect(notice.readNotice).toHaveBeenCalledTimes(1);
  });

  it('hands a co-owner nothing when no page is addressed to them, but still confirms the date', async () => {
    const { svc, updates } = harness(
      [held('d1', 'RICHARD MINTON'), held('d2', 'CECELIA W HARRIS')],
      [RECIPIENTS[0]],
    );

    const r = await svc.readMaturedNotices('duval_taxdeed', { now: NOW });

    expect(r.addressed).toBe(1);
    expect(patch(updates, 'd1').ownerMailingStreet).toBe('4027 BESSENT RD');
    const d2 = patch(updates, 'd2');
    expect(d2.ownerMailingStreet).toBeUndefined();
    expect(d2).toMatchObject({ noticeConfirmed: true, noticeReadDocId: '103369' });
  });

  it('does not stamp a read that failed, so next week tries again', async () => {
    const { svc, notice, updates } = harness([held('d1', 'RICHARD MINTON')]);
    notice.readNotice.mockResolvedValue(null);

    const r = await svc.readMaturedNotices('duval_taxdeed', { now: NOW });

    expect(r).toMatchObject({ read: 0, errors: 1 });
    expect(updates).toHaveLength(0);
  });

  it('stops when the month cannot cover another read, and says so', async () => {
    const { svc, notice } = harness([held('d1', 'RICHARD MINTON')]);
    notice.canSpend.mockResolvedValue({ ok: false, reason: 'notice reads paused, $19.9 of the $20 SURPLUS_NOTICE_MONTHLY_BUDGET spent in 2026-11' });

    const r = await svc.readMaturedNotices('duval_taxdeed', { now: NOW });

    expect(notice.readNotice).not.toHaveBeenCalled();
    expect(r.read).toBe(0);
    expect(r.paused).toMatch(/paused/);
  });

  it('skips a case the county has paid out or the team has marked Dead', async () => {
    // The query excludes them; the harness returns everything, so pin the
    // filter the service sends.
    const { svc, prisma } = harness([]);

    await svc.readMaturedNotices('duval_taxdeed', { now: NOW });

    const where = prisma.surplusDetail.findMany.mock.calls[0][0].where;
    expect(where.sourceSystem).toBe('duval_taxdeed');
    expect(where.claimStatus.notIn).toEqual(['distributed', 'assigned']);
    expect(where.OR).toEqual([{ stage: null }, { stage: { not: 'Dead' } }]);
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

  it('records why and when the docket retired an unsigned case', async () => {
    const { svc, updates, prisma } = harness([
      row({ id: 'd1', dedupeUid: uid('RICHARD MINTON'), street: '4027 BESSENT RD', source: 'notice_of_surplus_funds' }),
    ]);
    // The docket now carries a competing claim that the clerk has paid.
    (svc as any).adapterFor().fetchCase.mockResolvedValue({
      caseNumber: '2026-0011TD',
      parcelId: '0123456789',
      owners: ['RICHARD MINTON', 'CECELIA W HARRIS'],
      surplus: 105670.33,
      documents: [
        { title: 'Notice of Surplus Funds', docId: '103369', url: '/Home/Image/103369' },
        { title: 'Surplus Distribution', docId: '103400', url: '/Home/Image/103400', filedAt: '2026-10-01' },
      ],
      propertyAddress: '4027 BESSENT RD',
    });
    const progress = { countyRetired: jest.fn().mockResolvedValue(undefined) };
    (svc as any).progress = progress;

    await svc.ingestCounty('duval_taxdeed', {});

    const patch = updates.find((u) => u.where?.id === 'd1')?.data;
    expect(patch.stage).toBe('Dead');
    expect(patch.deadReason).toBe('paid_out');
    expect(patch.deadAt).toBeInstanceOf(Date);
    expect(patch.deadNote).toContain('County docket');
    expect(progress.countyRetired).toHaveBeenCalledWith('lead-d1', 'distributed', 'New');
    expect(prisma.surplusDetail.update).toHaveBeenCalled();
  });

  it('never retires a case a client has signed, whatever the docket says', async () => {
    const { svc, updates } = harness([
      row({ id: 'd1', dedupeUid: uid('RICHARD MINTON'), street: '4027 BESSENT RD', source: 'notice_of_surplus_funds' }),
    ]);
    (svc as any).prisma.surplusDetail.findFirst = jest.fn(async () => ({
      id: 'd1',
      leadId: 'lead-d1',
      stage: 'Claim Filed',
      claimStatus: 'open',
      ownerMailingStreet: '4027 BESSENT RD',
      ownerAddressSource: 'notice_of_surplus_funds',
    }));
    // Our own filing, which the classifier reads as "assigned".
    (svc as any).adapterFor().fetchCase.mockResolvedValue({
      caseNumber: '2026-0011TD',
      parcelId: '0123456789',
      owners: ['RICHARD MINTON', 'CECELIA W HARRIS'],
      surplus: 105670.33,
      documents: [
        { title: 'Notice of Surplus Funds', docId: '103369', url: '/Home/Image/103369' },
        { title: 'Surplus Distribution', docId: '103400', url: '/Home/Image/103400', filedAt: '2026-10-01' },
      ],
      propertyAddress: '4027 BESSENT RD',
    });
    const progress = { countyRetired: jest.fn().mockResolvedValue(undefined) };
    (svc as any).progress = progress;

    await svc.ingestCounty('duval_taxdeed', {});

    const patch = updates.find((u) => u.where?.id === 'd1')?.data;
    expect(patch.stage).toBeUndefined();
    expect(patch.deadReason).toBeUndefined();
    // The docket changed under a filed claim, so the timeline gets a note.
    expect(progress.countyRetired).toHaveBeenCalledWith('lead-d1', 'distributed', 'Claim Filed');
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
    expect(patch.deadReason).toBe('paid_out');
    expect(patch.deadAt).toBeInstanceOf(Date);
  });

  it('the list saying paid out does not retire a signed case', async () => {
    const { svc, updates, prisma } = lee('COMPLETED - SOLD BIDDER');
    prisma.surplusDetail.findMany = jest.fn().mockResolvedValue([{ ...held, stage: 'Agreement Signed' }]);

    const res = await svc.ingestCounty('realtdm_lee', {});

    expect(res.retiredFromList).toBe(1);
    const patch = updates.find((u) => u.where?.id === 'd1')?.data;
    expect(patch.claimStatus).toBe('distributed');
    expect(patch.stage).toBeUndefined();
  });

  it('a case the county already resolved is remembered and never fetched again', async () => {
    // No held rows for this case and the docket says the owner already
    // claimed. The first pass fetches it once and writes a retired marker;
    // the second pass sees the marker and skips it without a request. On the
    // first Lee refresh 63 such cases cost 440 requests to re-learn.
    const { svc, prisma, adapter } = lee();
    prisma.surplusDetail.findFirst = jest.fn().mockResolvedValue(null);
    prisma.surplusDetail.findMany = jest.fn().mockResolvedValue([]);
    adapter.fetchCase.mockResolvedValue({
      sourceCaseId: '82214',
      caseNumber: '2025000391',
      owners: ['BEVERLY F KONOPKA'],
      surplus: 9000,
      documents: [
        { title: 'SURPLUS_LETTER', docId: '9825843' },
        { title: 'Surplus Claim_Beverly Konopka', docId: '9999999', claimant: 'Beverly Konopka' },
      ],
    });

    const first = await svc.ingestCounty('realtdm_lee', {});
    expect(first.dead).toBe(1);
    expect(first.created).toBe(0);
    expect(prisma.surplusSuppression.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ caseNumber: '2025000391', reason: 'retired_by_county' }) }),
    );

    prisma.surplusSuppression.findMany = jest.fn().mockResolvedValue([{ caseNumber: '2025000391' }]);
    adapter.fetchCase.mockClear();
    adapter.probeDocket.mockClear();

    const second = await svc.ingestCounty('realtdm_lee', {});
    expect(adapter.fetchCase).not.toHaveBeenCalled();
    expect(adapter.probeDocket).not.toHaveBeenCalled();
    expect(second.unchanged).toBe(1);
  });

  it('full mode fetches every held case regardless of the probe', async () => {
    const { svc, adapter } = lee();

    await svc.ingestCounty('realtdm_lee', { full: true });

    expect(adapter.probeDocket).not.toHaveBeenCalled();
    expect(adapter.fetchCase).toHaveBeenCalledWith('82214', { lite: false });
  });
});

describe('what a run created', () => {
  it('returns the id of every lead it created, and nothing for the ones it already had', async () => {
    // The cron poll hands exactly these to the skip trace. A lead the run
    // found already on the board must not be in the list, or Monday's refresh
    // re-buys every miss from the week before.
    const { svc, prisma } = harness([]);
    prisma.surplusDetail.count = jest.fn().mockResolvedValue(0);
    const created = [true, false];
    const surplus: any = {
      createSurplusLead: jest.fn(async () => {
        const made = created.shift();
        return made
          ? { leadId: `lead-${created.length}`, created: true }
          : { leadId: 'lead-old', created: false, reason: 'already on the board' };
      }),
    };
    (svc as any).surplus = surplus;

    const res = await svc.ingestCounty('duval_taxdeed', {});

    expect(surplus.createSurplusLead).toHaveBeenCalledTimes(2);
    expect(res.created).toBe(1);
    expect(res.createdLeadIds).toHaveLength(1);
    expect(res.createdLeadIds[0]).toMatch(/^lead-/);
    expect(res.createdLeadIds).not.toContain('lead-old');
  });
});

describe('the pull window', () => {
  const now = new Date('2026-09-17T12:00:00Z');

  it('leaves a sale over a year old on the county list', () => {
    expect(tooOldToPull({ saleDate: '2025-06-01' }, now)).toBe(true);
  });

  it('brings in a sale inside the year', () => {
    expect(tooOldToPull({ saleDate: '2025-09-20' }, now)).toBe(false);
    expect(tooOldToPull({ saleDate: '2026-08-01' }, now)).toBe(false);
  });

  it('treats an unknown or unreadable sale date as not too old', () => {
    expect(tooOldToPull({ saleDate: null }, now)).toBe(false);
    expect(tooOldToPull({}, now)).toBe(false);
    expect(tooOldToPull({ saleDate: 'no sale' }, now)).toBe(false);
  });
});

describe('foreign owners, and the repair run', () => {
  it('writes the country of a Canadian page, and none on a US one', async () => {
    const canada = [
      { name: 'RICHARD MINTON', street: '3431 DORCAS STREET', city: 'MISSISSAUGA', state: 'ONTARIO', zip: 'L4T 1M9', country: 'CANADA' },
      RECIPIENTS[1],
    ];
    const { svc, updates } = harness(
      [
        row({ id: 'd1', dedupeUid: uid('RICHARD MINTON'), street: '4027 BESSENT RD', source: 'notice_of_surplus_funds' }),
        row({ id: 'd2', dedupeUid: uid('CECELIA W HARRIS'), street: '4027 BESSENT RD', source: 'notice_of_surplus_funds' }),
      ],
      canada as any,
    );

    await svc.ingestCounty('duval_taxdeed', { reread: true });

    const d1 = updates.find((u) => u.where?.id === 'd1')?.data;
    const d2 = updates.find((u) => u.where?.id === 'd2')?.data;
    expect(d1).toMatchObject({ ownerMailingZip: 'L4T 1M9', ownerMailingCountry: 'CANADA' });
    expect(d2).toMatchObject({ ownerMailingStreet: '1841 W 14TH ST', ownerMailingCountry: null });
  });

  it('fetches only the case numbers asked for', async () => {
    const { svc } = harness([]);
    const adapter: any = svc.adapterFor('duval_taxdeed');
    adapter.listSurplusCases.mockResolvedValue([
      { sourceCaseId: '1', caseNumber: '25-0517', status: 'SOLD', surplus: 9000 },
      { sourceCaseId: '2', caseNumber: '25-0518', status: 'SOLD', surplus: 9000 },
    ]);

    await svc.ingestCounty('duval_taxdeed', { cases: ['25-0518'] });

    expect(adapter.fetchCase).toHaveBeenCalledTimes(1);
    expect(adapter.fetchCase.mock.calls[0][0]).toBe('2');
  });

  it('says on the run row which cases failed and why', async () => {
    const { svc, prisma } = harness([]);
    const adapter: any = svc.adapterFor('duval_taxdeed');
    adapter.listSurplusCases.mockResolvedValue([{ sourceCaseId: '1', caseNumber: '25-1087', status: 'SOLD', surplus: 9000 }]);
    adapter.fetchCase.mockRejectedValue(new Error('boom'));

    const r = await svc.ingestCounty('duval_taxdeed', {});

    expect(r.errors).toBe(1);
    const message = prisma.surplusPollRun.update.mock.calls[0][0].data.message;
    expect(message).toContain('Failed: 25-1087: boom');
  });

  it('refuses a second pull of a county already running', async () => {
    const { svc } = harness([]);
    const adapter: any = svc.adapterFor('duval_taxdeed');
    let release: (v: any[]) => void = () => undefined;
    adapter.listSurplusCases.mockReturnValue(new Promise((r) => (release = r)));

    const first = svc.ingestCounty('duval_taxdeed', {});
    await new Promise((r) => setImmediate(r));
    expect(svc.isRunning('duval_taxdeed')).toBe(true);
    await expect(svc.ingestCounty('duval_taxdeed', {})).rejects.toThrow('already running');

    release([]);
    await first;
    expect(svc.isRunning('duval_taxdeed')).toBe(false);
  });
});

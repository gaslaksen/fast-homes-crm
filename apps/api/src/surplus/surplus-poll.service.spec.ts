import { SurplusPollService, describeNoticeSweep, describeTrace } from './surplus-poll.service';

/**
 * The cron poll's one job after the pull: run the BatchData trace on the
 * leads the pull just created, and only those. EnformionGo never runs here. Pinned because the manual
 * trace without leadIds works the whole board, and a Monday refresh that did
 * that would re-buy every miss on it.
 */

/**
 * The BatchData rung is off by default since 2026-10-31 (the vendor was
 * dropped; IDI batches are the trace). These tests pin the rung itself, so
 * they switch it on; the two at the end pin the default.
 */
function harness(env: Record<string, string> = {}) {
  const vars: Record<string, string> = { SURPLUS_AUTO_TRACE: 'true', ...env };
  const config: any = { get: (k: string) => vars[k] };
  const notes: string[] = [];
  const ingest: any = {
    adapters: () => [
      { key: 'realtdm_lee', cadence: 'weekly' },
      { key: 'duval_taxdeed', cadence: 'daily' },
    ],
    ingestCounty: jest.fn().mockResolvedValue({
      runId: 'run1', scanned: 10, created: 2, updated: 0, skipped: 0, belowFloor: 0,
      classified: 2, dead: 0, errors: 0, unchanged: 8, retiredFromList: 0,
      createdLeadIds: ['lead-a', 'lead-b'],
    }),
    noteRun: jest.fn(async (_id: string, note: string) => { notes.push(note); }),
    // The day 95 notice sweep. Nothing to read unless a test says otherwise.
    readMaturedNotices: jest.fn().mockResolvedValue({ candidates: 0, read: 0, addressed: 0, tooYoung: 0, errors: 0 }),
  };
  const lock: any = { run: jest.fn((_k: string, fn: () => Promise<unknown>) => fn()) };
  const skiptrace: any = {
    estateRelatives: jest.fn().mockResolvedValue({ searched: 0, matched: 0, withContact: 0 }),
    // Claims that crossed the 110 day mark since the last pull. Empty unless
    // a test says otherwise.
    maturedLeadIds: jest.fn().mockResolvedValue([]),
    traceLeads: jest.fn().mockResolvedValue({
      candidates: 2, submitted: 2, contacted: 1, mismatched: 0, skipped: {},
      nameSearch: { searched: 0, verified: 0, namesakes: 0 }, errors: 0,
    }),
  };
  const svc = new SurplusPollService(config, ingest, lock, skiptrace);
  return { svc, ingest, skiptrace, notes };
}

describe('SurplusPollService', () => {
  it('traces exactly the leads the pull created, BatchData only, never EnformionGo', async () => {
    const { svc, skiptrace, notes } = harness({ SURPLUS_DEFAULT_ORG_ID: 'org1' });

    await svc.pollWeekly();

    expect(skiptrace.traceLeads).toHaveBeenCalledTimes(1);
    expect(skiptrace.traceLeads).toHaveBeenCalledWith({
      organizationId: 'org1',
      leadIds: ['lead-a', 'lead-b'],
      nameSearch: false,
      addressSearch: true,
      relativeLookups: false,
    });
    expect(notes).toEqual(['Traced 1 of 2 new to a number (2 address lookups)']);
  });

  it('also traces the claims that have just become workable, and says which batch is which', async () => {
    const { svc, skiptrace, notes } = harness({ SURPLUS_DEFAULT_ORG_ID: 'org1' });
    skiptrace.maturedLeadIds.mockResolvedValue(['lead-old']);

    await svc.pollWeekly();

    expect(skiptrace.traceLeads).toHaveBeenCalledTimes(2);
    expect(skiptrace.traceLeads).toHaveBeenLastCalledWith({
      organizationId: 'org1',
      leadIds: ['lead-old'],
      nameSearch: false,
      addressSearch: true,
      relativeLookups: false,
    });
    expect(notes[1]).toBe('Traced 1 of 1 now workable to a number (2 address lookups)');
  });

  it('leaves the pull alone when nothing has matured', async () => {
    const { svc, skiptrace } = harness({ SURPLUS_DEFAULT_ORG_ID: 'org1' });

    await svc.pollWeekly();

    expect(skiptrace.traceLeads).toHaveBeenCalledTimes(1);
  });

  it('runs the obituary search on the same new leads, filing the survivors without looking them up', async () => {
    const { svc, notes } = harness({ SURPLUS_DEFAULT_ORG_ID: 'org1' });
    const obituary: any = { available: true, run: jest.fn().mockResolvedValue({ checked: 2, strong: 1, possible: 0, survivorsFiled: 2 }) };
    (svc as any).obituary = obituary;

    await svc.pollWeekly();

    expect(obituary.run).toHaveBeenCalledWith({ organizationId: 'org1', leadIds: ['lead-a', 'lead-b'], survivorLookups: false });
    expect(notes[0]).toMatch(/\. Obituary search on 2: 1 found dead, 0 to check, 2 survivors filed$/);
  });

  it('never runs the EnformionGo estate search on a pull', async () => {
    const { svc, skiptrace } = harness({ SURPLUS_DEFAULT_ORG_ID: 'org1' });

    await svc.pollWeekly();

    expect(skiptrace.estateRelatives).not.toHaveBeenCalled();
  });

  it('does not call the trace at all when the pull created nothing', async () => {
    // Zero leads means the filter would be an empty list. traceLeads treats
    // an empty list as "these zero leads", which is right, but not spending a
    // request on it is righter.
    const { svc, ingest, skiptrace } = harness();
    ingest.ingestCounty.mockResolvedValue({ runId: 'run1', created: 0, errors: 0, createdLeadIds: [] });

    await svc.pollDaily();

    expect(skiptrace.traceLeads).not.toHaveBeenCalled();
  });

  it('a trace failure is written on the run and does not fail the poll', async () => {
    const { svc, ingest, skiptrace, notes } = harness();
    skiptrace.traceLeads.mockRejectedValue(new Error('Endato rejected the credentials'));

    await expect(svc.pollWeekly()).resolves.toBeUndefined();

    expect(ingest.ingestCounty).toHaveBeenCalledTimes(1);
    expect(notes).toEqual(['Trace failed on the 2 new: Endato rejected the credentials']);
  });

  it('SURPLUS_AUTO_TRACE=false leaves new leads for the IDI batch, and says so on the run', async () => {
    const { svc, skiptrace, notes } = harness({ SURPLUS_AUTO_TRACE: 'false' });

    await svc.pollWeekly();

    expect(skiptrace.traceLeads).not.toHaveBeenCalled();
    expect(notes).toEqual(['Trace skipped on the 2 new: skip tracing runs through IDI batches']);
  });

  it('runs the notice sweep on each county after its pull, and notes what it did', async () => {
    const { svc, ingest, notes } = harness({ SURPLUS_DEFAULT_ORG_ID: 'org1', SURPLUS_AUTO_TRACE: 'false' });
    ingest.readMaturedNotices.mockResolvedValue({ candidates: 6, read: 2, addressed: 3, tooYoung: 4, errors: 0 });

    await svc.pollWeekly();

    expect(ingest.readMaturedNotices).toHaveBeenCalledWith('realtdm_lee', { organizationId: 'org1' });
    expect(notes[1]).toBe('Notice sweep: 2 notices read, 3 claimants given an address, 4 skipped as too young');
  });

  it('says nothing on the run when nothing was read and nothing is waiting', async () => {
    const { svc, notes } = harness({ SURPLUS_AUTO_TRACE: 'false' });

    await svc.pollWeekly();

    expect(notes).toEqual(['Trace skipped on the 2 new: skip tracing runs through IDI batches']);
  });

  it('writes a paused sweep on the run', async () => {
    const { svc, ingest, notes } = harness({ SURPLUS_AUTO_TRACE: 'false' });
    ingest.readMaturedNotices.mockResolvedValue({
      candidates: 3, read: 1, addressed: 1, tooYoung: 0, errors: 0,
      paused: 'notice reads paused, $19.9 of the $20 SURPLUS_NOTICE_MONTHLY_BUDGET spent in 2026-11',
    });

    await svc.pollWeekly();

    expect(notes[1]).toBe('Notice sweep: 1 notice read, 1 claimant given an address. Notice reads paused, $19.9 of the $20 SURPLUS_NOTICE_MONTHLY_BUDGET spent in 2026-11');
  });

  it('a sweep failure is written on the run and does not fail the poll', async () => {
    const { svc, ingest, notes } = harness({ SURPLUS_AUTO_TRACE: 'false' });
    ingest.readMaturedNotices.mockRejectedValue(new Error('the county timed out'));

    await expect(svc.pollWeekly()).resolves.toBeUndefined();

    expect(notes[1]).toBe('Notice sweep failed: the county timed out');
  });

  it('with nothing set, the retired BatchData rung stays off', async () => {
    const env: Record<string, string> = {};
    const config: any = { get: (k: string) => env[k] };
    const { svc, skiptrace } = harness();
    // Rebuild with a config that says nothing about the trace.
    const quiet = new SurplusPollService(config, (svc as any).ingest, (svc as any).lock, skiptrace);

    await quiet.pollWeekly();

    expect(skiptrace.traceLeads).not.toHaveBeenCalled();
  });
});

describe('describeTrace', () => {
  const base = { candidates: 3, submitted: 0, contacted: 0, mismatched: 0, skipped: {}, nameSearch: { searched: 0, verified: 0, namesakes: 0 }, deceased: 0, relatives: { looked: 0, withContact: 0 }, errors: 0 };

  it('says when nothing was attempted and why', () => {
    expect(describeTrace(3, { ...base, message: 'BATCHDATA_API_KEY is not set, so no trace was attempted.' }))
      .toBe('Trace skipped on the 3 new: BATCHDATA_API_KEY is not set, so no trace was attempted.');
  });

  it('names the deceased apart from the contacted, in a shape the brief still parses', () => {
    const line = describeTrace(6, { ...base, submitted: 5, contacted: 3, deceased: 1, nameSearch: { searched: 2, verified: 2, namesakes: 0 } });
    expect(line).toBe('Traced 3 of 6 new to a number, 1 more found deceased (5 address lookups, 2 name searches)');
    expect(/Traced (\d+) of (\d+) new to a number/.exec(line)?.slice(1)).toEqual(['3', '6']);
  });

  it('counts the relatives looked up for the newly dead', () => {
    expect(describeTrace(6, { ...base, submitted: 5, contacted: 3, deceased: 1, relatives: { looked: 4, withContact: 3 }, nameSearch: { searched: 2, verified: 2, namesakes: 0 } }))
      .toBe('Traced 3 of 6 new to a number, 1 more found deceased (5 address lookups, 2 name searches, 4 relative lookups, 3 with a number)');
  });

  it('counts errors on the line', () => {
    expect(describeTrace(5, { ...base, submitted: 4, contacted: 2, nameSearch: { searched: 3, verified: 1, namesakes: 4 }, errors: 1 }))
      .toBe('Traced 2 of 5 new to a number (4 address lookups, 3 name searches, 1 error)');
  });
});

describe('describeNoticeSweep', () => {
  const base = { candidates: 0, read: 0, addressed: 0, tooYoung: 0, errors: 0 };

  it('is silent when there was nothing to say', () => {
    expect(describeNoticeSweep(base)).toBeNull();
  });

  it('counts the reads, the addresses and the too young', () => {
    expect(describeNoticeSweep({ ...base, candidates: 3, read: 1, addressed: 1, tooYoung: 2 }))
      .toBe('Notice sweep: 1 notice read, 1 claimant given an address, 2 skipped as too young');
  });

  it('counts the failures, which are tried again next week', () => {
    expect(describeNoticeSweep({ ...base, candidates: 1, errors: 1 }))
      .toBe('Notice sweep: 0 notices read, 1 could not be read');
  });
});

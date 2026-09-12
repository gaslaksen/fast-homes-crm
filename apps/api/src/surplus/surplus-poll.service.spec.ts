import { SurplusPollService, describeTrace } from './surplus-poll.service';

/**
 * The cron poll's one job after the pull: run the skip trace waterfall on the
 * leads the pull just created, and only those. Pinned because the manual
 * trace without leadIds works the whole board, and a Monday refresh that did
 * that would re-buy every miss on it.
 */

function harness(env: Record<string, string> = {}) {
  const config: any = { get: (k: string) => env[k] };
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
  };
  const lock: any = { run: jest.fn((_k: string, fn: () => Promise<unknown>) => fn()) };
  const skiptrace: any = {
    traceLeads: jest.fn().mockResolvedValue({
      candidates: 2, submitted: 2, contacted: 1, mismatched: 0, skipped: {},
      nameSearch: { searched: 1, verified: 1, namesakes: 2 }, errors: 0,
    }),
  };
  const svc = new SurplusPollService(config, ingest, lock, skiptrace);
  return { svc, ingest, skiptrace, notes };
}

describe('SurplusPollService', () => {
  it('traces exactly the leads the pull created, both rungs on', async () => {
    const { svc, skiptrace, notes } = harness({ SURPLUS_DEFAULT_ORG_ID: 'org1' });

    await svc.pollWeekly();

    expect(skiptrace.traceLeads).toHaveBeenCalledTimes(1);
    expect(skiptrace.traceLeads).toHaveBeenCalledWith({
      organizationId: 'org1',
      leadIds: ['lead-a', 'lead-b'],
      nameSearch: true,
      addressSearch: true,
    });
    expect(notes).toEqual(['Traced 1 of 2 new to a number (2 address lookups, 1 name search)']);
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

  it('SURPLUS_AUTO_TRACE=false leaves new leads for a manual trace', async () => {
    const { svc, skiptrace, notes } = harness({ SURPLUS_AUTO_TRACE: 'false' });

    await svc.pollWeekly();

    expect(skiptrace.traceLeads).not.toHaveBeenCalled();
    expect(notes).toEqual([]);
  });
});

describe('describeTrace', () => {
  const base = { candidates: 3, submitted: 0, contacted: 0, mismatched: 0, skipped: {}, nameSearch: { searched: 0, verified: 0, namesakes: 0 }, errors: 0 };

  it('says when nothing was attempted and why', () => {
    expect(describeTrace(3, { ...base, message: 'BATCHDATA_API_KEY is not set, so no trace was attempted.' }))
      .toBe('Trace skipped on the 3 new: BATCHDATA_API_KEY is not set, so no trace was attempted.');
  });

  it('counts errors on the line', () => {
    expect(describeTrace(5, { ...base, submitted: 4, contacted: 2, nameSearch: { searched: 3, verified: 1, namesakes: 4 }, errors: 1 }))
      .toBe('Traced 2 of 5 new to a number (4 address lookups, 3 name searches, 1 error)');
  });
});

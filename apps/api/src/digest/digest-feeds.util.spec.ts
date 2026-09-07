import { describeCounts, describeFeed, FeedRun, FeedSource } from './digest-feeds.util';

/**
 * The county feed lines in the Daily Brief. The point of these is the failure
 * modes: a feed that did not run must read as a failure, never as a quiet day.
 */

const DUVAL: FeedSource = { key: 'duval_taxdeed', county: 'Duval', cadence: 'daily' };
const LEE: FeedSource = { key: 'realtdm_lee', county: 'Lee', cadence: 'weekly' };

/** Monday 7 Sep 2026, 7:00am ET, when the brief goes out. */
const MONDAY_7AM = new Date('2026-09-07T11:00:00Z');
/** Tuesday 8 Sep 2026, 7:00am ET. */
const TUESDAY_7AM = new Date('2026-09-08T11:00:00Z');

function run(over: Omit<Partial<FeedRun>, 'startedAt'> & { source: string; startedAt: string }): FeedRun {
  return {
    finishedAt: new Date(new Date(over.startedAt).getTime() + 60_000),
    ok: true,
    scanned: 441,
    created: 0,
    updated: 71,
    dead: 21,
    errors: 0,
    message: null,
    ...over,
    startedAt: new Date(over.startedAt),
  };
}

describe('describeFeed', () => {
  it('reports this morning\'s run with its counts and how long it took', () => {
    const row = describeFeed(DUVAL, [run({ source: 'duval_taxdeed', startedAt: '2026-09-07T09:45:00Z' })], MONDAY_7AM);
    expect(row.label).toBe('Duval County');
    expect(row.urgency).toBe('neutral');
    expect(row.detail).toBe('Ran 5:45am in 1 min: 441 scanned · 0 new · 71 updated · 21 retired.');
  });

  it('turns green when the run created leads', () => {
    const row = describeFeed(
      LEE,
      [run({ source: 'realtdm_lee', startedAt: '2026-09-07T08:30:00Z', scanned: 1756, created: 12, updated: 3, dead: 0, message: '360 unchanged since last poll' })],
      MONDAY_7AM,
    );
    expect(row.urgency).toBe('good');
    expect(row.detail).toContain('12 new');
    expect(row.detail).toContain('360 unchanged');
  });

  it('a daily feed that did not run is a red line, not a quiet day', () => {
    const row = describeFeed(DUVAL, [run({ source: 'duval_taxdeed', startedAt: '2026-09-06T09:45:00Z' })], MONDAY_7AM);
    expect(row.urgency).toBe('critical');
    expect(row.detail).toMatch(/^Did not run this morning\. Last ran Sun 9\/6/);
  });

  it('a weekly feed is only due on Monday', () => {
    const lastMonday = run({ source: 'realtdm_lee', startedAt: '2026-09-07T08:30:00Z', scanned: 1756 });
    const tuesday = describeFeed(LEE, [lastMonday], TUESDAY_7AM);
    expect(tuesday.urgency).toBe('neutral');
    expect(tuesday.detail).toMatch(/^Last ran Mon 9\/7: 1,756 scanned/);

    const nextMonday = describeFeed(LEE, [lastMonday], new Date('2026-09-14T11:00:00Z'));
    expect(nextMonday.urgency).toBe('critical');
    expect(nextMonday.detail).toMatch(/^Did not run this morning/);
  });

  it('a run with errors is a failure even if it finished', () => {
    const row = describeFeed(
      DUVAL,
      [run({ source: 'duval_taxdeed', startedAt: '2026-09-07T09:45:00Z', ok: false, errors: 1, message: 'timeout of 60000ms exceeded' })],
      MONDAY_7AM,
    );
    expect(row.urgency).toBe('critical');
    expect(row.detail).toContain('with problems');
    expect(row.detail).toContain('timeout of 60000ms exceeded');
  });

  it('a run that never finished is stuck after two hours', () => {
    const open = run({ source: 'realtdm_lee', startedAt: '2026-09-07T08:30:00Z', finishedAt: null });
    expect(describeFeed(LEE, [open], MONDAY_7AM).urgency).toBe('critical');
    expect(describeFeed(LEE, [open], new Date('2026-09-07T09:00:00Z')).urgency).toBe('warn');
  });

  it('a feed that has never run says so', () => {
    expect(describeFeed(LEE, [], TUESDAY_7AM)).toMatchObject({ urgency: 'warn', detail: 'Has not run yet.' });
    expect(describeFeed(LEE, [], MONDAY_7AM).urgency).toBe('critical');
  });

  it('reads the tiered-refresh counts out of the run message', () => {
    const text = describeCounts(
      run({ source: 'realtdm_lee', startedAt: '2026-09-07T08:30:00Z', scanned: 1756, updated: 1, dead: 0, message: '308 unchanged since last poll. 2 retired from the list row' }),
    );
    expect(text).toBe('1,756 scanned · 0 new · 1 updated · 2 retired · 308 unchanged');
  });
});

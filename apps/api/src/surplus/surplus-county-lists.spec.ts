import { addDays, everyLabel, listDue, todayNoonUtc } from './surplus-county-lists.util';
import { listPatch } from './surplus-counties.service';
import { describeCountyListDue } from '../digest/digest-feeds.util';

const noon = (ymd: string) => new Date(`${ymd}T12:00:00Z`);

describe('county list tracker dates', () => {
  it('takes today as the Eastern calendar day, even late in the evening', () => {
    // 11pm Eastern on Oct 29 is already Oct 30 in UTC.
    expect(todayNoonUtc(new Date('2026-10-30T03:00:00Z')).toISOString()).toBe('2026-10-29T12:00:00.000Z');
  });

  it('is due on the day and after, never before, and never with no date', () => {
    const now = new Date('2026-10-29T14:00:00Z');
    expect(listDue(noon('2026-10-29'), now)).toEqual({ due: true, days: 0 });
    expect(listDue(noon('2026-10-26'), now)).toEqual({ due: true, days: -3 });
    expect(listDue(noon('2026-11-05'), now)).toEqual({ due: false, days: 7 });
    expect(listDue(null, now)).toEqual({ due: false, days: null });
  });

  it('names the usual cadences', () => {
    expect(everyLabel(30)).toBe('monthly');
    expect(everyLabel(45)).toBe('every 45 days');
    expect(everyLabel(null)).toBeNull();
  });
});

describe('listPatch', () => {
  it('moves the next request on by the cadence when only the last request is logged', () => {
    const d = listPatch({ listRequestedAt: '2026-10-29' }, { listUpdateEveryDays: 30 });
    expect(d.listRequestedAt.toISOString()).toBe('2026-10-29T12:00:00.000Z');
    expect(d.listNextRequestAt.toISOString()).toBe(addDays(noon('2026-10-29'), 30).toISOString());
  });

  it('keeps a next date somebody typed, and a cadence set in the same edit wins', () => {
    const typed = listPatch({ listRequestedAt: '2026-10-29', listNextRequestAt: '2026-11-15' }, { listUpdateEveryDays: 30 });
    expect(typed.listNextRequestAt.toISOString()).toBe('2026-11-15T12:00:00.000Z');
    const weekly = listPatch({ listRequestedAt: '2026-10-29', listUpdateEveryDays: 7 }, { listUpdateEveryDays: 30 });
    expect(weekly.listNextRequestAt.toISOString()).toBe('2026-11-05T12:00:00.000Z');
  });

  it('refuses an unknown source, a silly cadence and a non-date, and clears with null', () => {
    expect(() => listPatch({ listSource: 'carrier pigeon' }, {})).toThrow('list source');
    expect(() => listPatch({ listUpdateEveryDays: 0 }, {})).toThrow('1 to 730');
    expect(() => listPatch({ listUpdatedAt: 'last Tuesday' }, {})).toThrow('must be a date');
    expect(listPatch({ listSource: null, listNextRequestAt: '', listUpdateEveryDays: '' }, {})).toEqual({
      listSource: null,
      listNextRequestAt: null,
      listUpdateEveryDays: null,
    });
  });
});

describe('describeCountyListDue', () => {
  it('says when it was due, how late, when it was last asked and how', () => {
    const row = describeCountyListDue(
      {
        name: 'Marion',
        listSource: 'email',
        listUpdateEveryDays: 30,
        listRequestedAt: noon('2026-09-25'),
        listNextRequestAt: noon('2026-10-25'),
        listUpdatedAt: noon('2026-09-20'),
      },
      new Date('2026-10-29T11:00:00Z'),
    );
    expect(row).toEqual({
      label: 'Marion list',
      schedule: 'monthly, by email',
      detail: 'UPDATE DUE Sun 10/25, 4 days late. Last asked Fri 9/25. The list we have is as of Sun 9/20.',
      urgency: 'warn',
    });
  });

  it('reads plainly with nothing but a date', () => {
    const row = describeCountyListDue(
      { name: 'Volusia', listSource: null, listUpdateEveryDays: null, listRequestedAt: null, listNextRequestAt: noon('2026-10-29'), listUpdatedAt: null },
      new Date('2026-10-29T11:00:00Z'),
    );
    expect(row.schedule).toBe('cadence not set');
    expect(row.detail).toBe('UPDATE DUE Thu 10/29. Never asked.');
  });
});

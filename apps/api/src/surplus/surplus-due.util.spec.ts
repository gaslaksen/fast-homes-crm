import { easternMorning } from './surplus-due.util';

describe('easternMorning', () => {
  it('lands at 9 AM Eastern in winter (14:00 UTC), not 9:00 UTC', () => {
    const now = new Date('2026-11-25T15:00:00Z'); // 10 AM EST
    expect(easternMorning(7, now).toISOString()).toBe('2026-12-02T14:00:00.000Z');
  });

  it('lands at 9 AM Eastern in summer (13:00 UTC)', () => {
    const now = new Date('2026-07-10T15:00:00Z'); // 11 AM EDT
    expect(easternMorning(1, now).toISOString()).toBe('2026-07-11T13:00:00.000Z');
  });

  it('counts from the Eastern day, even after the UTC date has rolled over', () => {
    // 9:30 PM Eastern on the 25th is already the 26th in UTC.
    const now = new Date('2026-11-26T02:30:00Z');
    expect(easternMorning(1, now).toISOString()).toBe('2026-11-26T14:00:00.000Z');
  });

  it('keeps the day across a DST change', () => {
    // Saturday 2026-03-07, clocks go forward on Sunday the 8th.
    const now = new Date('2026-03-07T17:00:00Z');
    expect(easternMorning(1, now).toISOString()).toBe('2026-03-08T13:00:00.000Z');
    // Saturday 2026-10-31, clocks go back on Sunday 2026-11-01.
    const fall = new Date('2026-10-31T16:00:00Z');
    expect(easternMorning(1, fall).toISOString()).toBe('2026-11-01T14:00:00.000Z');
  });

  it('crosses a month and a year end', () => {
    const now = new Date('2026-12-31T20:00:00Z');
    expect(easternMorning(1, now).toISOString()).toBe('2027-01-01T14:00:00.000Z');
  });

  it('gives this morning for zero days', () => {
    const now = new Date('2026-11-25T20:00:00Z');
    expect(easternMorning(0, now).toISOString()).toBe('2026-11-25T14:00:00.000Z');
  });
});

import { courtLocalToUtc, utcToCourtLocal } from './foreclosure-datetime.util';

describe('courtLocalToUtc', () => {
  it('places the 26SP002244-590 hearing at 2:00 PM Eastern', () => {
    // "The foreclosure hearing will be conducted via WebEx on September 8,
    // 2026 at 2:00PM." September is EDT, so 14:00 local is 18:00Z.
    const at = courtLocalToUtc('2026-09-08', '14:00');
    expect(at!.toISOString()).toBe('2026-09-08T18:00:00.000Z');
    expect(utcToCourtLocal(at)).toBe('2026-09-08T14:00');
  });

  it('places the ALAW hearing at 2:00 PM Eastern too', () => {
    // 26SP002242-590: "...ON OCTOBER 5, 2026 AT 2:00PM." Still EDT.
    expect(utcToCourtLocal(courtLocalToUtc('2026-10-05', '14:00'))).toBe('2026-10-05T14:00');
  });

  it('uses standard time in winter, not a fixed offset', () => {
    // The reason the offset is derived per-date: January is EST (-05:00).
    expect(courtLocalToUtc('2026-01-14', '14:00')!.toISOString()).toBe('2026-01-14T19:00:00.000Z');
    expect(courtLocalToUtc('2026-07-14', '14:00')!.toISOString()).toBe('2026-07-14T18:00:00.000Z');
  });

  it('round-trips across the spring-forward boundary', () => {
    // 2026 DST starts March 8. A hearing either side must read back as filed.
    expect(utcToCourtLocal(courtLocalToUtc('2026-03-07', '14:00'))).toBe('2026-03-07T14:00');
    expect(utcToCourtLocal(courtLocalToUtc('2026-03-09', '14:00'))).toBe('2026-03-09T14:00');
  });

  it('round-trips across the fall-back boundary', () => {
    // 2026 DST ends November 1.
    expect(utcToCourtLocal(courtLocalToUtc('2026-10-31', '10:00'))).toBe('2026-10-31T10:00');
    expect(utcToCourtLocal(courtLocalToUtc('2026-11-02', '10:00'))).toBe('2026-11-02T10:00');
  });

  it('treats a missing time as court-local midnight, keeping the date right', () => {
    // Naive UTC parsing of "2026-09-08" would render as Sept 7 in Eastern.
    expect(utcToCourtLocal(courtLocalToUtc('2026-09-08', null))).toBe('2026-09-08T00:00');
    expect(utcToCourtLocal(courtLocalToUtc('2026-09-08', ''))).toBe('2026-09-08T00:00');
  });

  it('accepts a single-digit hour', () => {
    expect(utcToCourtLocal(courtLocalToUtc('2026-09-08', '9:30'))).toBe('2026-09-08T09:30');
  });

  it('returns null rather than guessing when the date is absent or malformed', () => {
    for (const bad of [null, undefined, '', '   ', 'September 8, 2026', '2026-9-8', '2026-13-01', '2026-09-32']) {
      expect(courtLocalToUtc(bad as any, '14:00')).toBeNull();
    }
  });

  it('returns null on an out-of-range time rather than rolling over', () => {
    expect(courtLocalToUtc('2026-09-08', '25:00')).toBeNull();
    expect(courtLocalToUtc('2026-09-08', '14:75')).toBeNull();
  });

  it('ignores an unparseable time instead of dropping the date', () => {
    expect(utcToCourtLocal(courtLocalToUtc('2026-09-08', '2:00PM'))).toBe('2026-09-08T00:00');
  });
});

describe('utcToCourtLocal', () => {
  it('returns null for a missing or invalid instant', () => {
    expect(utcToCourtLocal(null)).toBeNull();
    expect(utcToCourtLocal(undefined)).toBeNull();
    expect(utcToCourtLocal(new Date('nonsense'))).toBeNull();
  });
});

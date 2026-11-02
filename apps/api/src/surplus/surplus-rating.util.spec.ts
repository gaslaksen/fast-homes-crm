import { caseKeys, parseRating, readRatingSheets } from './surplus-rating.util';

describe('parseRating', () => {
  it.each([
    ['A', 'A'],
    ['b', 'B'],
    ['A Tier', 'A'],
    ['Tier B', 'B'],
    ['A-rated', 'A'],
    [' a ', 'A'],
  ])('reads %p as %p', (v, want) => expect(parseRating(v)).toBe(want));

  it.each(['C', '', null, 'AB', 'Work it'])('refuses %p', (v) => expect(parseRating(v)).toBeNull());
});

describe('caseKeys', () => {
  const shared = (a: string[], b: string[]) => a.some((k) => b.includes(k));

  it('matches a case written with or without padding zeros', () => {
    expect(shared(caseKeys('Hernando', '2025-259TD'), caseKeys('hernando', '2025-0259TD'))).toBe(true);
  });

  it('matches a case written with or without separators', () => {
    expect(shared(caseKeys('Lee', '2025001157'), caseKeys('LEE', '2025001157'))).toBe(true);
    expect(shared(caseKeys('Lake', '04261-2023'), caseKeys('Lake', '04261 2023'))).toBe(true);
  });

  it('keeps the same number in two counties apart', () => {
    expect(shared(caseKeys('Citrus', '2026-0026TD'), caseKeys('Hernando', '2026-0026TD'))).toBe(false);
  });

  it('has no keys without a county or a case', () => {
    expect(caseKeys('', '2025-1')).toEqual([]);
    expect(caseKeys('Lee', '')).toEqual([]);
  });
});

describe('readRatingSheets', () => {
  const header = ['Folder name', 'Rating', 'County', 'Case number', 'Owner/claimant', 'Why this rating', 'Rated by'];

  it('reads the docket review sheet and skips blank rows', () => {
    const rows = readRatingSheets([
      {
        name: 'A Files',
        rows: [
          header,
          ['Lee - 2025001157 - Lai', 'A', 'Lee', '2025001157', 'Lai', 'No claim on the docket.', 'Florida bot'],
          [null, null, null, null, null, null, null],
          ['x', 'B', 'Lake', '04261-2023', 'Saul', null, null],
        ],
      },
    ]);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      row: 2,
      sheet: 'A Files',
      rating: 'A',
      county: 'Lee',
      caseNumber: '2025001157',
      reason: 'No claim on the docket.',
      ratedBy: 'Florida bot',
    });
    expect(rows[1]).toMatchObject({ row: 4, rating: 'B', reason: null, ratedBy: null });
  });

  it('finds a header below a title row and reports a bad rating', () => {
    const rows = readRatingSheets([
      { name: 'S', rows: [['Grok ratings, 2026-11-02'], ['County', 'Case', 'Tier'], ['Polk', '2025-12', 'maybe']] },
    ]);
    expect(rows).toEqual([expect.objectContaining({ row: 3, rating: null, ratingText: 'maybe', county: 'Polk' })]);
  });

  it('skips a sheet with no ratings header', () => {
    expect(readRatingSheets([{ name: 'Notes', rows: [['just notes'], ['more']] }])).toEqual([]);
  });
});

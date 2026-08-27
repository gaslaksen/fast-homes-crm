import { groupByProperty } from './surplus.service';

const lead = (o: any) => ({
  id: o.id,
  claimant: o.claimant,
  county: o.county ?? 'Duval',
  caseNumber: o.caseNumber ?? null,
  parcelId: o.parcelId ?? null,
  address: o.address ?? '0 HARDEE ST',
  city: 'JACKSONVILLE',
  grossSurplus: o.grossSurplus ?? 8611.05,
  workScore: o.workScore ?? 100,
  workReason: o.workReason ?? 'Open, nothing filed',
  claimStatus: o.claimStatus ?? 'open',
  cleanPhoneCount: o.cleanPhoneCount ?? 0,
  contactMismatch: o.contactMismatch ?? false,
  isDeceased: o.isDeceased ?? false,
  stage: 'New',
});

describe('groupByProperty', () => {
  it('collapses two claimants on one case into one property', () => {
    // The duplication on the board: Myrtis Griffin and Jessie Hall are both
    // owed on 0 Hardee St, and showed as two identical-looking cards.
    const groups = groupByProperty([
      lead({ id: 'a', claimant: 'MYRTIS GRIFFIN', caseNumber: '2025-0023TD' }),
      lead({ id: 'b', claimant: 'JESSIE HALL', caseNumber: '2025-0023TD' }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].claimantCount).toBe(2);
    expect(groups[0].claimantNames).toEqual(['MYRTIS GRIFFIN', 'JESSIE HALL']);
  });

  it('keeps two different cases apart even when the street line matches', () => {
    // "0 HARDEE ST" and "0 PLACEDA ST" style placeholders repeat across the tax
    // roll, so grouping on the address alone would merge unrelated parcels and
    // silently hide a whole surplus.
    const groups = groupByProperty([
      lead({ id: 'a', claimant: 'A', caseNumber: '2025-0023TD', address: '0 HARDEE ST' }),
      lead({ id: 'b', claimant: 'B', caseNumber: '2025-0025TD', address: '0 HARDEE ST' }),
    ]);
    expect(groups).toHaveLength(2);
  });

  it('falls back to the parcel, then the address, when there is no case number', () => {
    const byParcel = groupByProperty([
      lead({ id: 'a', claimant: 'A', caseNumber: null, parcelId: '147264-0000' }),
      lead({ id: 'b', claimant: 'B', caseNumber: null, parcelId: '147264-0000' }),
    ]);
    expect(byParcel).toHaveLength(1);

    const byAddress = groupByProperty([
      lead({ id: 'a', claimant: 'A', caseNumber: null, parcelId: null, address: '12 MAIN ST' }),
      lead({ id: 'b', claimant: 'B', caseNumber: null, parcelId: null, address: '12 Main St.' }),
    ]);
    expect(byAddress).toHaveLength(1);
  });

  it('does not merge the same case number across different counties', () => {
    const groups = groupByProperty([
      lead({ id: 'a', claimant: 'A', caseNumber: '2025-0001TD', county: 'Duval' }),
      lead({ id: 'b', claimant: 'B', caseNumber: '2025-0001TD', county: 'Lee' }),
    ]);
    expect(groups).toHaveLength(2);
  });

  it('ranks the property on its BEST claimant and explains the placement', () => {
    // A property where one owner is reachable is worth working even if the
    // other is not, so the group must not sort on the weaker one.
    const [g] = groupByProperty([
      lead({ id: 'a', claimant: 'UNREACHABLE', workScore: 40, workReason: 'no callable number yet' }),
      lead({ id: 'b', claimant: 'REACHABLE', workScore: 440, workReason: 'Open, 2 callable numbers' }),
    ]);
    expect(g.workScore).toBe(440);
    expect(g.workReason).toBe('Open, 2 callable numbers');
    expect(g.claimantNames[0]).toBe('REACHABLE');
  });

  it('rolls contact state up so the card can show it without opening', () => {
    const [g] = groupByProperty([
      lead({ id: 'a', claimant: 'A', cleanPhoneCount: 0, contactMismatch: true }),
      lead({ id: 'b', claimant: 'B', cleanPhoneCount: 2 }),
    ]);
    expect(g.anyContactable).toBe(true);
    expect(g.anyMismatch).toBe(true);
  });

  it('distinguishes some heirs from all heirs', () => {
    // An estate claim needs letters and a death certificate. A property where
    // only one of two owners is deceased is a different job from one where both
    // are, and the card should not flatten that to "Estate".
    const [mixed] = groupByProperty([
      lead({ id: 'a', claimant: 'A', isDeceased: true }),
      lead({ id: 'b', claimant: 'B', isDeceased: false }),
    ]);
    expect(mixed.anyDeceased).toBe(true);
    expect(mixed.allDeceased).toBe(false);
  });

  it('handles an empty list', () => {
    expect(groupByProperty([])).toEqual([]);
  });

  it('keeps every claimant reachable from the group', () => {
    // Nothing may be dropped: each claimant is a separate claim with its own
    // conversation, and the panel works them individually.
    const [g] = groupByProperty([
      lead({ id: 'a', claimant: 'A' }),
      lead({ id: 'b', claimant: 'B' }),
      lead({ id: 'c', claimant: 'C' }),
    ]);
    expect(g.claimants.map((c: any) => c.id).sort()).toEqual(['a', 'b', 'c']);
  });
});

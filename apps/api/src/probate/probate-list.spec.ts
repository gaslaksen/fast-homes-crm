import { ProbateService } from './probate.service';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Lead rows shaped the way list() gets them back from Prisma, so the grouping
 * can be exercised without a database.
 */
function lead(over: any = {}) {
  return {
    id: over.id || 'lead-1',
    propertyAddress: over.address || '920 E 36Th St',
    propertyCity: over.city || 'Charlotte',
    propertyZip: '28205',
    status: 'NEW',
    sellerFirstName: over.first || 'Jennifer',
    sellerLastName: over.last || 'Helms Collins',
    sellerPhone: over.phone || '+17044002575',
    sellerEmail: over.email ?? 'jhc@example.com',
    campaignEnrollments: over.campaigns || [],
    probateDetail: {
      // `in`, not `??`: a test passing contactKey: null means exactly that.
      contactKey: 'contactKey' in over ? over.contactKey : 'p:7044002575',
      primaryContact: over.primaryContact ?? false,
      estValue: over.estValue ?? 100000,
      consensusRank: over.rank ?? 50,
      consensusScore: 60,
      consensusTier: over.tier ?? 'Tier 1 - Attack First',
      caseNumber: over.caseNumber ?? '26E000800-590',
      caseFiledDate: over.filed ?? new Date('2026-03-06'),
      deceasedName: over.deceased ?? 'Henry Russell Helms',
      whyThisLead: 'Probate case 26E000800-590 filed Mar 06, 2026',
      heirCity: 'Charlotte',
      absenteeHeir: true,
      monthsSinceDeath: over.months ?? 5,
      phone1Type: 'Mobile',
      workStatus: over.workStatus ?? 'NOT_CONTACTED',
      doNotCall: over.doNotCall ?? false,
    },
  };
}

/** Reach the private grouping helper the way the tests need to read it. */
function group(rows: any[]) {
  const service = new ProbateService({} as unknown as PrismaService);
  return (service as any).groupByContact(rows);
}

function sorted(groups: any[], sort?: string) {
  const service = new ProbateService({} as unknown as PrismaService);
  (service as any).sortGroups(groups, sort);
  return groups;
}

describe('ProbateService grouping', () => {
  it('collapses every property on one phone into a single row', () => {
    const groups = group([
      lead({ id: 'a', address: '920 E 36Th St', primaryContact: true, rank: 39, estValue: 200000 }),
      lead({ id: 'b', address: '4115 Dunwoody Dr', rank: 64, estValue: 300000 }),
      lead({ id: 'c', address: '126 Shady Cir', rank: 86, estValue: 150000 }),
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0].propertyCount).toBe(3);
    expect(groups[0].totalValue).toBe(650000);
    expect(groups[0].heirName).toBe('Jennifer Helms Collins');
  });

  it('points the group at the primary lead, whatever order rows arrive in', () => {
    const groups = group([
      lead({ id: 'b', address: '4115 Dunwoody Dr', rank: 64 }),
      lead({ id: 'a', address: '920 E 36Th St', primaryContact: true, rank: 39 }),
    ]);
    // This id is what a campaign enrolls: one per person, not one per house.
    expect(groups[0].primaryLeadId).toBe('a');
  });

  it('keeps the best rank and its tier across the group', () => {
    const groups = group([
      lead({ id: 'a', rank: 64, tier: 'Tier 2 - Strong Leads' }),
      lead({ id: 'b', rank: 8, tier: 'Tier 1 - Attack First' }),
      lead({ id: 'c', rank: 140, tier: 'Tier 3 - Worth Working' }),
    ]);
    expect(groups[0].bestRank).toBe(8);
    expect(groups[0].bestTier).toBe('Tier 1 - Attack First');
  });

  it('collects every estate one heir is handling', () => {
    const groups = group([
      lead({ id: 'a', caseNumber: '26E000219-590', deceased: 'Deborah Ann Helms' }),
      lead({ id: 'b', caseNumber: '26E000800-590', deceased: 'Henry Russell Helms' }),
      lead({ id: 'c', caseNumber: '26E000800-590', deceased: 'Henry Russell Helms' }),
    ]);
    expect(groups[0].caseNumbers).toEqual(['26E000219-590', '26E000800-590']);
    expect(groups[0].deceasedNames).toEqual(['Deborah Ann Helms', 'Henry Russell Helms']);
    expect(groups[0].propertyCount).toBe(3);
  });

  it('keeps different heirs apart', () => {
    const groups = group([
      lead({ id: 'a', contactKey: 'p:7044002575', first: 'Jennifer' }),
      lead({ id: 'b', contactKey: 'p:7045161913', first: 'Jerome', last: 'Johnson' }),
    ]);
    expect(groups).toHaveLength(2);
  });

  it('does not fold keyless leads together', () => {
    const groups = group([
      lead({ id: 'a', contactKey: null }),
      lead({ id: 'b', contactKey: null, address: 'Somewhere else' }),
    ]);
    expect(groups).toHaveLength(2);
  });

  it('lets one do-not-call property speak for the whole contact', () => {
    const groups = group([
      lead({ id: 'a', doNotCall: false }),
      lead({ id: 'b', doNotCall: true }),
    ]);
    expect(groups[0].doNotCall).toBe(true);
  });

  it('lists each campaign the contact is in exactly once', () => {
    const groups = group([
      lead({ id: 'a', campaigns: [{ campaign: { name: 'Probate Q3' } }] }),
      lead({ id: 'b', campaigns: [{ campaign: { name: 'Probate Q3' } }] }),
    ]);
    expect(groups[0].enrolledCampaigns).toEqual(['Probate Q3']);
  });

  it('orders properties within a group by rank', () => {
    const groups = group([
      lead({ id: 'a', address: 'Third', rank: 140 }),
      lead({ id: 'b', address: 'First', rank: 8 }),
      lead({ id: 'c', address: 'Second', rank: 64 }),
    ]);
    expect(groups[0].properties.map((p: any) => p.address)).toEqual(['First', 'Second', 'Third']);
  });
});

describe('ProbateService group sorting', () => {
  const groups = () => [
    { heirName: 'Beta', bestRank: 50, totalValue: 100, propertyCount: 1, monthsSinceDeath: 8 },
    { heirName: 'Alpha', bestRank: 2, totalValue: 900, propertyCount: 16, monthsSinceDeath: 2 },
    { heirName: 'Gamma', bestRank: null, totalValue: 500, propertyCount: 4, monthsSinceDeath: null },
  ];

  it('defaults to best rank, with unranked contacts last', () => {
    expect(sorted(groups()).map((g) => g.heirName)).toEqual(['Alpha', 'Beta', 'Gamma']);
  });

  it('sorts by property count, value, recency and name', () => {
    expect(sorted(groups(), 'properties').map((g) => g.heirName)).toEqual(['Alpha', 'Gamma', 'Beta']);
    expect(sorted(groups(), 'value').map((g) => g.heirName)).toEqual(['Alpha', 'Gamma', 'Beta']);
    expect(sorted(groups(), 'recent').map((g) => g.heirName)).toEqual(['Alpha', 'Beta', 'Gamma']);
    expect(sorted(groups(), 'name').map((g) => g.heirName)).toEqual(['Alpha', 'Beta', 'Gamma']);
  });
});

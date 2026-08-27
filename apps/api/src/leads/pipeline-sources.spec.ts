import { PIPELINE_SOURCES } from './leads.service';
import { LeadSource } from '@fast-homes/shared';

describe('PIPELINE_SOURCES', () => {
  it('covers every source that has its own board', () => {
    // Each of these lives on a dedicated pipeline with its own columns,
    // compliance rules and outreach posture. Mixed into the Property Leads
    // list they bury it: seventy surplus claimants hide the handful of actual
    // property leads that list exists for.
    expect(PIPELINE_SOURCES).toEqual(
      expect.arrayContaining([
        LeadSource.FORECLOSURE,
        LeadSource.PROBATE,
        LeadSource.TAX_SALE,
        LeadSource.SURPLUS,
      ]),
    );
  });

  it('does not exclude the sources Property Leads is FOR', () => {
    for (const s of [
      LeadSource.PROPERTY_LEADS,
      LeadSource.GOOGLE_ADS,
      LeadSource.LEADHOUSE,
      LeadSource.MANUAL,
      LeadSource.DEAL_SEARCH,
      LeadSource.OTHER,
    ]) {
      expect(PIPELINE_SOURCES).not.toContain(s);
    }
  });
});

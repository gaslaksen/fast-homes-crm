import { FL_COUNTY_SEED, FL_COUNTY_LINKS, FL_COUNTIES } from './surplus-compliance';
import { seedColumns, blanksToFill, ACCEPTED_METHODS } from './surplus-counties.service';

/**
 * The county seed: what the code knows about a clerk before anybody rings
 * them. The one rule that matters is that it fills blanks and never
 * overwrites, because a value typed in after a call beats a website.
 */
describe('the county seed', () => {
  it('covers the two counties the pipeline runs in', () => {
    for (const name of ['Duval', 'Lee']) {
      expect(FL_COUNTIES.active).toContain(name);
      const cols = seedColumns(FL_COUNTY_SEED[name]);
      expect(cols.claimFormUrl).toMatch(/^https:\/\//);
      expect(cols.surplusListUrl).toMatch(/^https:\/\//);
      expect(cols.courtRecordsUrl).toMatch(/^https:\/\//);
      expect(cols.clerkAddress).toBeTruthy();
      expect(cols.clerkContactEmail).toMatch(/@/);
      expect(cols.attorneyRequired).toBe(false);
      for (const m of String(cols.acceptedMethods).split(',')) expect(ACCEPTED_METHODS).toContain(m);
    }
  });

  it('leaves out what the clerks\' documents do not state', () => {
    // Signature on delivery and the assignment preference are questions for
    // the clerk, so the row must keep asking for them.
    for (const name of ['Duval', 'Lee']) {
      const cols = seedColumns(FL_COUNTY_SEED[name]);
      expect(cols.signatureRequired).toBeUndefined();
      expect(cols.assignmentPreference).toBeUndefined();
      expect(cols.clerkContactName).toBeUndefined();
    }
  });

  it('still exposes the court records link the panel used before', () => {
    expect(FL_COUNTY_LINKS.Duval.courtRecords).toBe('https://core.duvalclerk.com/CoreCms.aspx?mode=PublicAccess');
    expect(FL_COUNTY_LINKS.Lee.courtRecords).toMatch(/leeclerk\.org/);
  });

  it('fills only the blanks on an existing row', () => {
    const seed = seedColumns(FL_COUNTY_SEED.Lee);
    const row = {
      claimFormUrl: null,
      surplusListUrl: '',
      courtRecordsUrl: 'https://example.test/typed-by-a-person',
      acceptedMethods: 'fedex,in_person',
      attorneyRequired: true,
      clerkContactPhone: null,
      clerkContactEmail: 'somebody@leeclerk.org',
      clerkAddress: null,
      notes: 'Rang the clerk on Tuesday.',
    };
    const fill = blanksToFill(row, seed);
    expect(Object.keys(fill).sort()).toEqual(['claimFormUrl', 'clerkAddress', 'clerkContactPhone', 'surplusListUrl']);
    // A false the clerk gave is a value, not a blank.
    expect(blanksToFill({ attorneyRequired: false }, { attorneyRequired: true })).toEqual({});
  });

  it('has no dashes anywhere in the seed text', () => {
    const text = JSON.stringify(FL_COUNTY_SEED);
    expect(/[–—]/.test(text)).toBe(false);
  });
});

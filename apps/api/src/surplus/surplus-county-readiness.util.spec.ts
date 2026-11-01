import { SurplusCallOutcome } from '@fast-homes/shared';
import {
  COUNTY_QUESTIONS,
  clerkContactName,
  clerkScript,
  clerkTaskTitle,
  countyReadiness,
  isCountyPrepOutcome,
  practiceRunTaskTitle,
} from './surplus-county-readiness.util';

const ready = {
  name: 'Hernando',
  claimFormUrl: 'https://clerk.example/form.pdf',
  acceptedMethods: 'usps,in_person',
  signatureRequired: false,
  attorneyRequired: false,
  assignmentPreference: 'partial',
  practiceRunAt: new Date('2026-10-01'),
};

describe('countyReadiness', () => {
  it('is ready only when all five clerk answers are in', () => {
    expect(countyReadiness(ready)).toEqual({ ready: true, unknowns: [], practiceRun: true });
  });

  it('names what the clerk has not been asked, in the order of the call', () => {
    const r = countyReadiness({ ...ready, claimFormUrl: null, claimFormKey: null, attorneyRequired: null, practiceRunAt: null });
    expect(r.ready).toBe(false);
    expect(r.unknowns).toEqual(['claim form', 'whether an attorney is required']);
    expect(r.practiceRun).toBe(false);
  });

  it('an uploaded form counts as the claim form, and "no" answers count as answered', () => {
    expect(countyReadiness({ ...ready, claimFormUrl: null, claimFormKey: 's3/key.pdf' }).ready).toBe(true);
    expect(countyReadiness({ ...ready, signatureRequired: false, attorneyRequired: false }).ready).toBe(true);
    expect(countyReadiness({ ...ready, acceptedMethods: ['efile'] }).ready).toBe(true);
    expect(countyReadiness({ ...ready, acceptedMethods: '' }).unknowns).toEqual(['how claims are submitted']);
  });

  it('a county not on the list has every question open', () => {
    expect(countyReadiness(null)).toEqual({ ready: false, unknowns: COUNTY_QUESTIONS.map((q) => q.unknown), practiceRun: false });
  });
});

describe('clerkScript', () => {
  it('lists the five questions with the answered ones marked', () => {
    const lines = clerkScript({ ...ready, assignmentPreference: null });
    expect(lines.map((l) => l.key)).toEqual(['claimForm', 'thirdParty', 'method', 'signature', 'attorney']);
    expect(lines.map((l) => l.answered)).toEqual([true, false, true, true, true]);
    expect(lines[1].ask).toMatch(/limited power of attorney/);
  });
});

describe('the county prep tasks', () => {
  it('have one title per county so they open once', () => {
    expect(clerkTaskTitle('Hernando')).toBe('Ask the Hernando clerk: claim form, third party or POA, submission method, signature, attorney');
    expect(practiceRunTaskTitle('Hernando')).toBe('Practice run for Hernando: fill out the whole document set once');
  });

  it('open on a yes or a maybe from the claimant and on nothing else', () => {
    expect(isCountyPrepOutcome(SurplusCallOutcome.SPOKE_CLAIMANT)).toBe(true);
    expect(isCountyPrepOutcome(SurplusCallOutcome.WANTS_PACKET)).toBe(true);
    expect(isCountyPrepOutcome(SurplusCallOutcome.CALLBACK_SCHEDULED)).toBe(true);
    expect(isCountyPrepOutcome(SurplusCallOutcome.SPOKE_RELATIVE)).toBe(false);
    expect(isCountyPrepOutcome(SurplusCallOutcome.NOT_INTERESTED)).toBe(false);
    expect(isCountyPrepOutcome(SurplusCallOutcome.NO_ANSWER)).toBe(false);
    expect(isCountyPrepOutcome(null)).toBe(false);
  });
});

describe('clerkContactName', () => {
  it('uses the clerk named on the county card, else the office', () => {
    expect(clerkContactName({ clerkContactName: 'Doug Chorvat' }, 'Hernando')).toBe('Doug Chorvat');
    expect(clerkContactName({ clerkContactName: '  ' }, 'Hernando')).toBe('Hernando County Clerk');
    expect(clerkContactName(null, 'Lee')).toBe('Lee County Clerk');
  });
});

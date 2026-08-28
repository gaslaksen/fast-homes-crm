import {
  sameGivenName,
  splitClaimantName,
  verifyTracedName,
  traceEligibility,
  addressKeyOf,
  addressCaseCounts,
  traceState,
} from './surplus-skiptrace.util';

describe('splitClaimantName', () => {
  it('splits a plain name', () => {
    expect(splitClaimantName('DANNIE LESTER STEWART')).toEqual({
      given: ['dannie', 'lester'],
      surname: 'stewart',
    });
  });

  it('strips the estate marker so the surname is not "estate"', () => {
    // Real claimants off the Duval docket. Getting this wrong makes every
    // estate lead unmatchable, and estates are a large share of the board.
    expect(splitClaimantName('RICHARD JONES JR ESTATE').surname).toBe('jones');
    expect(splitClaimantName('DANNIE LESTER STEWART ESTATE').surname).toBe('stewart');
    expect(splitClaimantName('THE ESTATE OF LEONARD C GREEN').surname).toBe('green');
  });

  it('strips a generational suffix so the surname is not "jr"', () => {
    expect(splitClaimantName('EDGAR CLOWERS, JR.')).toEqual({
      given: ['edgar'],
      surname: 'clowers',
    });
  });

  it('treats a single token as the surname', () => {
    expect(splitClaimantName('PEEPLES')).toEqual({ given: [], surname: 'peeples' });
  });

  it('handles an empty name', () => {
    expect(splitClaimantName('')).toEqual({ given: [], surname: '' });
    expect(splitClaimantName(null)).toEqual({ given: [], surname: '' });
  });
});

describe('verifyTracedName', () => {
  it('accepts the claimant themselves', () => {
    expect(verifyTracedName('KENNETH PEEPLES', 'Kenneth', 'Peeples').verdict).toBe('same_person');
  });

  it('accepts an estate claimant matched to the living person', () => {
    // The clerk writes "ESTATE"; the vendor returns the person. Same human.
    expect(verifyTracedName('DANNIE LESTER STEWART ESTATE', 'Dannie', 'Stewart').verdict)
      .toBe('same_person');
  });

  it('flags a relative rather than discarding them', () => {
    // The spouse who can hand you the claimant. Bertha Stewart is exactly this
    // case on the Duval file: surviving wife of the deceased owner.
    const r = verifyTracedName('DANNIE LESTER STEWART', 'Bertha', 'Stewart');
    expect(r.verdict).toBe('relative');
    expect(r.reason).toMatch(/household/i);
  });

  it('reads a one-character spelling slip as the same person', () => {
    // The real Duval hit. The county wrote MYRTIS GRIFFIN, the vendor returned
    // "Mertis Griffin". Exact matching called her a relative and labelled the
    // lead "not the claimant" when it was plainly her.
    expect(verifyTracedName('MYRTIS GRIFFIN', 'Mertis', 'Griffin').verdict).toBe('same_person');
  });

  it('accepts an initial standing in for the full given name', () => {
    expect(verifyTracedName('R PITTARD', 'Robert', 'Pittard').verdict).toBe('same_person');
  });

  it('still calls a genuinely different household member a relative', () => {
    // The fuzzy allowance must not swallow this: Dorothy is not Robert.
    expect(verifyTracedName('ROBERT PITTARD', 'Dorothy', 'Pittard').verdict).toBe('relative');
  });

  it('discards a stranger who merely shares a first name', () => {
    // The classic false positive. "Robert Pittard" vs "Robert Stranger" and
    // "Robert Pittard" vs "Dorothy Pittard" both score 50% on a single overlap
    // metric, and they are opposite situations.
    expect(verifyTracedName('ROBERT PITTARD', 'Robert', 'Stranger').verdict).toBe('stranger');
    expect(verifyTracedName('ROBERT PITTARD', 'Dorothy', 'Pittard').verdict).toBe('relative');
  });

  it('discards a completely unrelated person', () => {
    // What tracing a sold property usually returns: the new occupant.
    expect(verifyTracedName('SUSAN D WRIGHT', 'Marcus', 'Delgado').verdict).toBe('stranger');
  });

  it('tolerates a county writing the name inverted', () => {
    // "HILL TAMMIE LEE" style. A strict positional match would reject a hit.
    expect(verifyTracedName('HILL TAMMIE', 'Tammie', 'Hill').verdict).toBe('same_person');
  });

  it('ignores a middle name the vendor did or did not return', () => {
    expect(verifyTracedName('CALVIN J JOHNSON', 'Calvin', 'Johnson').verdict).toBe('same_person');
  });

  it('matches punctuation variants', () => {
    expect(verifyTracedName("MARY O'BRIEN", 'Mary', 'OBrien').verdict).toBe('same_person');
    expect(verifyTracedName('ANN SMITH-JONES', 'Ann', 'Jones').verdict).toBe('same_person');
  });

  it('is unverified, not accepted, when nothing came back to check', () => {
    const r = verifyTracedName('KENNETH PEEPLES', null, null);
    expect(r.verdict).toBe('unverified');
  });

  it('is unverified when we have no claimant surname to check against', () => {
    expect(verifyTracedName('', 'Jane', 'Doe').verdict).toBe('unverified');
  });
});

describe('traceEligibility', () => {
  const ok = { street: '2533 JERNIGAN RD', city: 'JACKSONVILLE', state: 'FL', zip: '32207' };

  it('accepts a complete Florida address', () => {
    expect(traceEligibility(ok).ok).toBe(true);
  });

  it('refuses an entity and points at Sunbiz', () => {
    // A consumer skip trace on an LLC returns nothing or a stranger.
    const r = traceEligibility(ok, { isEntity: true });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('entity');
    expect(r.detail).toMatch(/sunbiz/i);
  });

  it('refuses a street with no house number', () => {
    // Duval case 2026-0004TD really does list "BROADWAY AVE" with no number,
    // while the mailed notice went to 2607 Broadway Ave. Submitting the bare
    // street burns a credit and returns a guess.
    const r = traceEligibility({ ...ok, street: 'BROADWAY AVE' });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('no_house_number');
  });

  it('refuses a vacant-lot placeholder address', () => {
    // "0 HARDEE ST" starts with a digit so the house-number check passes it,
    // but it is the tax roll's stand-in for a parcel with no street number.
    // Two of the first three Duval submissions were these; both wasted a credit
    // and came back a stranger.
    for (const street of ['0 HARDEE ST', '0 PLACEDA ST', '00 SOMEWHERE RD']) {
      const r = traceEligibility({ ...ok, street });
      expect(r.ok).toBe(false);
      expect(r.reason).toBe('placeholder_address');
    }
  });

  it('still accepts a real house number', () => {
    expect(traceEligibility({ ...ok, street: '10 MAIN ST' }).ok).toBe(true);
    expect(traceEligibility({ ...ok, street: '2817 EAVERSON ST' }).ok).toBe(true);
  });

  it('refuses a ZIP that does not belong to the state', () => {
    // Caught on a real row carrying state AL against a Florida ZIP.
    const r = traceEligibility({ ...ok, zip: '79924' });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('zip_state_mismatch');
  });

  it('refuses ANY address whose clerk mail was returned, not just the property', () => {
    // Every submission against a returned address came back a stranger: six on
    // property addresses, then Maxine Fletcher at a Bronx mailing address and
    // Kelli Grimes at a Jacksonville one. Not one produced a contact.
    const r = traceEligibility(ok, { mailVerdict: 'undeliverable' });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('mail_returned');
    expect(r.detail).toMatch(/name/i);
  });

  it('still submits when the mail was delivered or mixed', () => {
    expect(traceEligibility(ok, { mailVerdict: 'delivered' }).ok).toBe(true);
    expect(traceEligibility(ok, { mailVerdict: 'mixed' }).ok).toBe(true);
    expect(traceEligibility(ok, { mailVerdict: null }).ok).toBe(true);
  });

  it('refuses an address shared across several cases', () => {
    // A professional address. One household comes back and attributing those
    // phones to every claimant on it is wrong more often than it is right.
    const r = traceEligibility(ok, { addressCaseCount: 3 });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('shared_address');
  });

  it('allows an address repeated within ONE case', () => {
    // That is a household, which is fine and expected for co-owners.
    expect(traceEligibility(ok, { addressCaseCount: 1 }).ok).toBe(true);
  });

  it('refuses an empty address', () => {
    expect(traceEligibility({}).reason).toBe('no_address');
  });
});

describe('addressKeyOf', () => {
  it('collapses punctuation and case so co-owners share one key', () => {
    // BatchData matches on address only, so co-owners at one property return
    // the identical row twice. The second credit buys nothing.
    const a = addressKeyOf({ street: '2817 Eaverson St.', city: 'Jacksonville', zip: '32209' });
    const b = addressKeyOf({ street: '2817 EAVERSON ST', city: 'JACKSONVILLE', zip: '32209-1234' });
    expect(a).toBe(b);
  });

  it('keeps different addresses apart', () => {
    expect(addressKeyOf({ street: '2817 EAVERSON ST', zip: '32209' })).not.toBe(
      addressKeyOf({ street: '2819 EAVERSON ST', zip: '32209' }),
    );
  });
});

describe('addressCaseCounts', () => {
  it('counts distinct cases per address, not rows', () => {
    // Two co-owners on one case is one case, and must stay eligible.
    const counts = addressCaseCounts([
      { addressKey: 'A', caseNumber: '2025-0023TD' },
      { addressKey: 'A', caseNumber: '2025-0023TD' },
      { addressKey: 'B', caseNumber: '2025-0001TD' },
      { addressKey: 'B', caseNumber: '2025-0002TD' },
      { addressKey: 'B', caseNumber: '2025-0003TD' },
    ]);
    expect(counts.get('A')).toBe(1);
    expect(counts.get('B')).toBe(3);
  });
});

describe('sameGivenName', () => {
  it('accepts a single character slip on a long enough name', () => {
    expect(sameGivenName('myrtis', 'mertis')).toBe(true);
    expect(sameGivenName('kathryn', 'katheryn')).toBe(true); // one insertion
  });

  it('accepts an initial against a full name', () => {
    expect(sameGivenName('r', 'robert')).toBe(true);
    expect(sameGivenName('calvin', 'c')).toBe(true);
  });

  it('refuses a fuzzy match on a SHORT name, where one letter is a different person', () => {
    // The reason the allowance is length-gated. These are not slips.
    expect(sameGivenName('jon', 'ron')).toBe(false);
    expect(sameGivenName('dan', 'dana')).toBe(false);
    expect(sameGivenName('ann', 'ana')).toBe(false);
  });

  it('refuses two characters of difference', () => {
    expect(sameGivenName('robert', 'rupert')).toBe(false);
    expect(sameGivenName('dorothy', 'timothy')).toBe(false);
  });

  it('refuses names of clearly different length', () => {
    expect(sameGivenName('robert', 'bob')).toBe(false);
  });

  it('handles empties', () => {
    expect(sameGivenName('', 'robert')).toBe(false);
    expect(sameGivenName('robert', '')).toBe(false);
  });
});

describe('traceState', () => {
  it('calls a row nothing has been submitted for "never", not a failure', () => {
    // The state 72 of 75 claimants are in. The nightly poll ingests and never
    // traces, and reading that as a failed trace is what prompts a re-run that
    // spends a credit to change nothing.
    const t = traceState({});
    expect(t.state).toBe('never');
    expect(t.actionable).toBe(true);
    expect(t.label).toMatch(/never/i);
  });

  it('does not offer a re-run once a submission has already answered', () => {
    const t = traceState({ tracedAt: new Date(), traceOutcome: 'no_person', traceDetail: 'nobody' });
    expect(t.actionable).toBe(false);
    expect(t.tone).toBe('bad');
  });

  it('reads the legacy mismatch flag on rows traced before the outcome column', () => {
    const t = traceState({ tracedAt: new Date(), contactMismatch: true, mismatchedName: 'Calvin Johnson' });
    expect(t.state).toBe('mismatch');
    expect(t.detail).toContain('Calvin Johnson');
  });

  it('needs BOTH a timestamp and an outcome before claiming a trace happened', () => {
    // A half-written row must fall back to "never" rather than assert a trace
    // that may not have been submitted.
    expect(traceState({ traceOutcome: 'matched' }).state).toBe('never');
    expect(traceState({ tracedAt: new Date() }).state).toBe('never');
  });
});

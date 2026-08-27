import { SurplusClaimStatus } from '@fast-homes/shared';
import {
  classifyDocument,
  classifyCase,
  classifyClaimant,
  collapseClaimants,
  isWorkable,
  CLAIM_STATUS_RANK,
} from './surplus-classify.util';
import {
  DANNIE_STEWART,
  ELLA_CLOWERS,
  LINDA_SHIRLEY,
  SUSAN_WRIGHT,
  KENNETH_PEEPLES,
} from './surplus-classify.fixtures';

const asDocs = (titles: string[]) => titles.map((title) => ({ title }));

describe('classifyDocument', () => {
  describe('the traps, each of which contains a word a later rule matches', () => {
    it('reads NO CLAIM as the county declining, not as a claim', () => {
      // 52 of 96 Brevard documents matching "claim" were this. Counting them as
      // competition hid most of the county's opportunity.
      expect(classifyDocument('BREVARD COUNTY CODE ENFORCEMENT NO CLAIM')).not.toBe('claim');
    });

    it('reads a disclaimer as a waiver, not as a claim', () => {
      // Pinellas 2023-01704: three documents, all disclaimers, $255,189 with
      // nobody claiming. Initially read as contested.
      expect(classifyDocument('Surplus Disclaimer- ACME LIENHOLDER')).not.toBe('claim');
    });

    it('does not count a photo ID exhibit as a claim', () => {
      expect(classifyDocument('Photo IDs for Surplus Claims')).toBe('claim_attachment');
    });

    it('does not count notary verification as a claim', () => {
      expect(classifyDocument('Notary Verification')).toBe('claim_attachment');
    });

    it('does not read returned mail as a claim, despite the substring', () => {
      expect(classifyDocument('RETURNED MAIL UNCLAIMED')).toBe('mail_undeliverable');
    });

    it('does not read a routine disbursement as a distribution of the surplus', () => {
      // Both of these appear on cases with no claim of any kind on file.
      expect(classifyDocument('Applicant Disbursement')).toBe('routine_disbursement');
      expect(classifyDocument('Tax Collector Disbursement')).toBe('routine_disbursement');
    });
  });

  describe('Duval ships three spellings of undeliverable on one docket', () => {
    it.each([
      'Certified Mail Undelieverd',
      'Regular Mail Undelievered',
      'Certified Mail Undelivered',
    ])('reads %s as undeliverable', (title) => {
      expect(classifyDocument(title)).toBe('mail_undeliverable');
    });
  });

  it('separates delivered mail from returned mail', () => {
    expect(classifyDocument('Regular Mail Delivered')).toBe('mail_delivered');
    expect(classifyDocument("Return of Service from Sheriff's Office")).toBe('sheriff_served');
    expect(classifyDocument('Returned Not Served Sheriff Notice')).toBe('sheriff_not_served');
  });

  it('reads the real signals', () => {
    expect(classifyDocument('Notice Of Surplus Funds')).toBe('notice_surplus');
    expect(classifyDocument('Surplus - Submitted Claim')).toBe('claim');
    expect(classifyDocument('Denial Letter')).toBe('denial');
    expect(classifyDocument('Surplus Distribution')).toBe('distribution');
    expect(classifyDocument('Surplus Breakdown')).toBe('distribution');
    expect(classifyDocument('Surplus - Ad Valorem Homestead Liens')).toBe('gov_lien_claim');
    expect(classifyDocument('Probate Documents')).toBe('probate');
    expect(classifyDocument('SunBiz')).toBe('entity');
  });

  it('reads the other counties\' claim vocabularies, typos included', () => {
    // Brevard files these four spellings for the same document.
    for (const t of [
      'STATEMENT OF CLAIM SMITH',
      'STATMENT OF CLAIM SMITH',
      'STATE OF CLAIM SMITH',
      'STATEMENT CLAIM SMITH',
    ]) {
      expect(classifyDocument(t)).toBe('claim');
    }
    expect(classifyDocument('SURPLUS CLAIM_JANE DOE')).toBe('claim'); // Lee
    expect(classifyDocument('JANE DOE surplus claim')).toBe('claim'); // Alachua
  });

  it('treats unknown boilerplate as other rather than guessing', () => {
    expect(classifyDocument('DR-512')).toBe('other');
    expect(classifyDocument('OEReportTitleExpress')).toBe('other');
    expect(classifyDocument('')).toBe('other');
  });
});

describe('classifyClaimant', () => {
  it('reads an assignment of the owner as terminal', () => {
    // The shape on Duval 2025-0732TD. The owner has already signed.
    expect(classifyClaimant('GG ELITE SERVICES LLC As ASSIGNEE of SUSAN D WRIGHT', ['SUSAN D WRIGHT']))
      .toBe('assignee');
  });

  it('does not mistake a government lien claimant for a competitor', () => {
    expect(classifyClaimant('CITY OF JACKSONVILLE')).toBe('government');
    expect(classifyClaimant('BREVARD COUNTY CODE ENFORCEMENT')).toBe('government');
  });

  it('recognises the owner claiming directly', () => {
    expect(classifyClaimant('KENNETH PEEPLES', ['KENNETH PEEPLES'])).toBe('owner');
  });

  it('reads a recovery shop as a competitor', () => {
    expect(classifyClaimant('SUNSHINE ASSET RECOVERY LLC', ['KENNETH PEEPLES'])).toBe('competitor');
  });

  it('returns unknown rather than guessing when the source names nobody', () => {
    expect(classifyClaimant(null)).toBe('unknown');
    expect(classifyClaimant('')).toBe('unknown');
  });
});

// ─── The five cases acquisitions worked by hand ─────────────────────────────

describe('classifyCase, against the real Duval dockets', () => {
  it('2026-0004TD Stewart: notice mailed and nothing filed is OPEN', () => {
    const r = classifyCase(asDocs(DANNIE_STEWART.docs), { owners: DANNIE_STEWART.owners });
    expect(r.claimStatus).toBe(SurplusClaimStatus.OPEN);
    expect(r.counts.claims).toBe(0);
    expect(r.counts.notices).toBe(1);
    // Seven returned mailings and no successful delivery. The record address is
    // dead, so this one lives or dies on the skip trace. The two sheriff
    // returns of service on this docket are service at the PROPERTY and must
    // not count as reaching the owner.
    expect(r.mailVerdict).toBe('undeliverable');
  });

  it('2025-0829TD Clowers: an ad valorem lien alone leaves the residual open', () => {
    const r = classifyCase(asDocs(ELLA_CLOWERS.docs), { owners: ELLA_CLOWERS.owners });
    expect(r.claimStatus).toBe(SurplusClaimStatus.GOV_LIEN);
    expect(r.counts.govLiens).toBe(1);
    expect(r.counts.claims).toBe(0);
    // Three certified returns but one regular delivery, so somebody is reachable.
    expect(r.mailVerdict).toBe('mixed');
    expect(isWorkable(r.claimStatus)).toBe(true);
  });

  it('2025-0761TD Shirley: two claims both denied is DENIED, not contested', () => {
    const r = classifyCase(asDocs(LINDA_SHIRLEY.docs), { owners: LINDA_SHIRLEY.owners });
    expect(r.claimStatus).toBe(SurplusClaimStatus.DENIED);
    expect(r.counts.claims).toBe(2);
    expect(r.counts.denials).toBe(2);
    expect(r.counts.distributions).toBe(0);
    expect(r.probateOnFile).toBe(true);
    // The whole point: this outranks an untouched case.
    expect(CLAIM_STATUS_RANK[r.claimStatus]).toBeGreaterThan(
      CLAIM_STATUS_RANK[SurplusClaimStatus.OPEN],
    );
  });

  it('2025-0761TD Shirley: the photo ID exhibit does not inflate the claim count', () => {
    // Guards the trap directly. Three "claim"-matching titles are on this
    // docket; only two are claims. If the exhibit counted, denials (2) would no
    // longer cover claims (3) and the verdict would flip to PENDING, turning
    // the best lead on the board into a contested one.
    const r = classifyCase(asDocs(LINDA_SHIRLEY.docs), { owners: LINDA_SHIRLEY.owners });
    expect(LINDA_SHIRLEY.docs.filter((t) => /claim/i.test(t))).toHaveLength(3);
    expect(r.counts.claims).toBe(2);
  });

  it('2025-0732TD Wright: a claim with no named claimant is PENDING, not assumed dead', () => {
    // The scan says GG ELITE SERVICES LLC as assignee, but Duval's claim titles
    // carry no claimant, so the honest verdict from the docket is PENDING with
    // claimantUnknown set. Reading ASSIGNED here would be guessing.
    const r = classifyCase(asDocs(SUSAN_WRIGHT.docs), { owners: SUSAN_WRIGHT.owners });
    expect(r.claimStatus).toBe(SurplusClaimStatus.PENDING);
    expect(r.claimantUnknown).toBe(true);
    expect(r.counts.claims).toBe(1);
    expect(r.entityOnFile).toBe(true);
  });

  it('2025-0732TD Wright: naming the claimant promotes it to ASSIGNED', () => {
    // What the same docket resolves to once the claim scan has been read. This
    // is the payoff for storing the ledger: re-running the classifier over it
    // with a claimant costs no county traffic.
    const docs = SUSAN_WRIGHT.docs.map((title) =>
      title === 'Surplus - Submitted Claim'
        ? { title, claimant: 'GG ELITE SERVICES LLC As ASSIGNEE of SUSAN D WRIGHT' }
        : { title },
    );
    const r = classifyCase(docs, { owners: SUSAN_WRIGHT.owners });
    expect(r.claimStatus).toBe(SurplusClaimStatus.ASSIGNED);
    expect(isWorkable(r.claimStatus)).toBe(false);
  });

  it('2025-0774TD Peeples: distribution beats everything else on the docket', () => {
    const r = classifyCase(asDocs(KENNETH_PEEPLES.docs), { owners: KENNETH_PEEPLES.owners });
    expect(r.claimStatus).toBe(SurplusClaimStatus.DISTRIBUTED);
    expect(r.counts.distributions).toBe(4); // three filings plus the breakdown
    expect(isWorkable(r.claimStatus)).toBe(false);
  });

  it('2025-0774TD Peeples: the posted balance is not evidence the money is there', () => {
    // The regression this whole module exists to prevent. The Duval search grid
    // still reports $27,929.98 on this case. Triaging on the balance alone puts
    // a paid-out case at the top of the call list.
    const r = classifyCase(asDocs(KENNETH_PEEPLES.docs), { owners: KENNETH_PEEPLES.owners });
    expect(KENNETH_PEEPLES.surplus).toBe('$27,929.98');
    expect(isWorkable(r.claimStatus)).toBe(false);
  });

  it('every fixture explains itself rather than asserting a bare verdict', () => {
    for (const f of [DANNIE_STEWART, ELLA_CLOWERS, LINDA_SHIRLEY, SUSAN_WRIGHT, KENNETH_PEEPLES]) {
      const r = classifyCase(asDocs(f.docs), { owners: f.owners });
      expect(r.reason.length).toBeGreaterThan(20);
    }
  });
});

describe('classifyCase, edges', () => {
  it('is UNKNOWN, never OPEN, when no notice has been mailed', () => {
    // An empty docket means the clock has not started, not that the case is
    // clear. Defaulting to OPEN would put unqualified cases at the top.
    const r = classifyCase(asDocs(['DR-512', 'Tax Record']));
    expect(r.claimStatus).toBe(SurplusClaimStatus.UNKNOWN);
  });

  it('handles an empty document list without throwing', () => {
    const r = classifyCase([]);
    expect(r.claimStatus).toBe(SurplusClaimStatus.UNKNOWN);
    expect(r.ledger).toEqual([]);
    expect(r.mailVerdict).toBe('unknown');
  });

  it('leaves a claim outstanding as PENDING when denials do not cover it', () => {
    const r = classifyCase(
      asDocs([
        'Notice Of Surplus Funds',
        'Surplus - Submitted Claim',
        'Denial Letter',
        'Surplus - Submitted Claim',
      ]),
    );
    expect(r.claimStatus).toBe(SurplusClaimStatus.PENDING);
  });

  it('retires an assigned case even with no distribution on file', () => {
    const r = classifyCase(
      [
        { title: 'Notice Of Surplus Funds' },
        { title: 'Surplus - Submitted Claim', claimant: 'ACME LLC as assignee of JOHN DOE' },
      ],
      { owners: ['JOHN DOE'] },
    );
    expect(r.claimStatus).toBe(SurplusClaimStatus.ASSIGNED);
    expect(isWorkable(r.claimStatus)).toBe(false);
  });

  it('ranks a denied case above an open one and both above a pending one', () => {
    expect(CLAIM_STATUS_RANK[SurplusClaimStatus.DENIED]).toBeGreaterThan(
      CLAIM_STATUS_RANK[SurplusClaimStatus.OPEN],
    );
    expect(CLAIM_STATUS_RANK[SurplusClaimStatus.OPEN]).toBeGreaterThan(
      CLAIM_STATUS_RANK[SurplusClaimStatus.PENDING],
    );
    expect(CLAIM_STATUS_RANK[SurplusClaimStatus.DISTRIBUTED]).toBe(0);
  });
});

describe('collapseClaimants', () => {
  it('collapses the estate variant of one person into one claimant', () => {
    // Duval 2026-0004TD lists both. One deceased man, not two claimants. Each
    // claimant becomes its own lead, so failing to collapse doubles the board
    // and has the team calling the same family twice.
    const r = collapseClaimants(['DANNIE LESTER STEWART ESTATE', 'DANNIE LESTER STEWART']);
    expect(r).toHaveLength(1);
    expect(r[0].name).toBe('DANNIE LESTER STEWART');
    expect(r[0].deceased).toBe(true);
    expect(r[0].variants).toHaveLength(2);
  });

  it('promotes the estate marker to a flag rather than discarding it', () => {
    // An estate claim needs letters and a death certificate before it can be
    // filed at all, which is what routes the lead onto the heir drip.
    const [c] = collapseClaimants(['RITA J MCNURLIN ESTATE']);
    expect(c.deceased).toBe(true);
  });

  it('collapses a name suffix difference', () => {
    const r = collapseClaimants(['EDGAR CLOWERS, JR.', 'EDGAR CLOWERS']);
    expect(r).toHaveLength(1);
  });

  it('keeps genuinely different co-owners apart', () => {
    // BatchData matches on address, so co-owners at one address return the same
    // row twice, but they are still two claimants and two leads.
    const r = collapseClaimants(['JOHN SMITH', 'MARY SMITH']);
    expect(r).toHaveLength(2);
  });

  it('flags an entity, which needs Sunbiz rather than a consumer skip trace', () => {
    const [c] = collapseClaimants(['WILLIAMS CEDAR SHORES PROPERTY LLC']);
    expect(c.isEntity).toBe(true);
    expect(c.deceased).toBe(false);
  });

  it('does not treat a trust as deceased', () => {
    const [c] = collapseClaimants(['MINNIE BOWDISH TRUST LLC']);
    expect(c.isEntity).toBe(true);
    expect(c.deceased).toBe(false);
  });

  it('handles the estate-of prefix form', () => {
    const [c] = collapseClaimants(['THE ESTATE OF LEONARD C GREEN']);
    expect(c.deceased).toBe(true);
  });

  it('collapses a punctuation-only difference in an entity name', () => {
    // Duval lists both spellings on one case.
    const r = collapseClaimants(['D R HORTON INC-JACKSONVILLE', 'D R HORTON INC - JACKSONVILLE']);
    expect(r).toHaveLength(1);
  });

  it('collapses a bare entity name with its suffixed form', () => {
    // Duval 2025-0032TD lists both. One company, listed twice.
    const r = collapseClaimants(['HEAVENLY HANDS FUNDING', 'HEAVENLY HANDS FUNDING, LLC']);
    expect(r).toHaveLength(1);
    // Keep the full legal name, which is the one that goes on paperwork.
    expect(r[0].name).toBe('HEAVENLY HANDS FUNDING, LLC');
    expect(r[0].isEntity).toBe(true);
  });

  it('does not strip a company word from the middle of a name', () => {
    // TRUST here is part of the name, not a suffix, so these stay distinct.
    const r = collapseClaimants(['MINNIE BOWDISH TRUST LLC', 'MINNIE BOWDISH']);
    expect(r).toHaveLength(2);
  });

  it('drops empty entries without producing a blank claimant', () => {
    // A blank claimant would be refused downstream anyway, but it would be
    // counted as scanned and skipped, which reads as data loss in the run log.
    expect(collapseClaimants(['', '  ', null as any])).toEqual([]);
  });
});

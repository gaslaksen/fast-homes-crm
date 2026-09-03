import {
  assertCountySite,
  certificateFromLetter,
  claimantFromTitle,
  inFilingOrder,
  parseDocumentsPage,
  parseListPage,
  parseNotifications,
  parseParties,
  parseSummary,
  realTdmDate,
  splitAddressLines,
  surplusFromLetter,
} from './realtdm.adapter';
import { classifyCase } from './surplus-classify.util';

/**
 * Fixtures are verbatim fragments from lee.realtdm.com, pulled 2026-09-03
 * during the discovery pass the spec requires before a county is ingested.
 * Cases 82214, 82220 and 82422 are the three that pass was run on.
 */

const LIST_HTML = `
<html><head><title>realTDM : Lee - Case Search</title></head><body>
<table><thead><tr>
<th></th><th>Case Number</th><th>Date Created</th><th>App Number</th><th>Parcel Number</th><th>Sale Date</th><th>Surplus Balance</th>
</tr></thead><tbody>
<tr class="link load-case" data-caseID="82214" tabindex="0" aria-label="Case 2025000391, open with ENTER or add/remove from caselist with SPACE" title="Case 2025000391, open with ENTER or add to caselist with SPACE">
<td class="d-flex justify-content-start align-items-center">
<div class="case-check" data-caseid="82214">
<input type="checkbox" aria-label="Select Case 2025000391" title="Select Case 2025000391" name="selectedCases" id="case82214" value="82214|2025000391" data-caseid="82214" />
<i class="fa-thin fa-square public-case-select-off"></i>
<i class="fa-solid fa-check-square public-case-select-on"></i>
</div>
<div>ACTIVE - SOLD BIDDER</div>
</td>
<td class="text-end">2025000391</td>
<td class="text-end">Jun 24, 2025</td>
<td class="text-end">2025000391</td>
<td class="text-end">34-43-23-C1-02970.A100</td>
<td class="text-end">Sep 9, 2025</td>
<td class="text-end">$1,189.11</td>
</tr>
<tr class="link load-case" data-caseID="82215" tabindex="0" aria-label="Case 2025000392, open with ENTER or add/remove from caselist with SPACE" title="Case 2025000392, open with ENTER or add to caselist with SPACE">
<td class="d-flex justify-content-start align-items-center">
<div class="case-check" data-caseid="82215">
<input type="checkbox" aria-label="Select Case 2025000392" title="Select Case 2025000392" name="selectedCases" id="case82215" value="82215|2025000392" data-caseid="82215" />
<i class="fa-thin fa-square public-case-select-off"></i>
<i class="fa-solid fa-check-square public-case-select-on"></i>
</div>
<div>COMPLETED - REDEEMED</div>
</td>
<td class="text-end">2025000392</td>
<td class="text-end">Jun 24, 2025</td>
<td class="text-end">2025000392</td>
<td class="text-end">35-44-26-04-00032.0050</td>
<td class="text-end">Sep 9, 2025</td>
<td class="text-end">$0.00</td>
</tr>
</tbody></table>
<div class="d-flex">Page 1 of 11</div>
</body></html>`;

const SUMMARY_HTML = `
<div class="content-box tabs mb-2">
<div class="public-tab-header d-none d-lg-block">Case Summary</div>
</div>
<div class="content-box contain mt-3">
<div class="public-header">Summary Details</div>
<div class="row g-0" id="caseSummary">
<div class="col-12 col-lg-6 px-3">
<div class="data-row">
<div class="data-label">App Receive Date</div>
<div class="data-value">June 24, 2025</div>
</div>
<div class="data-row">
<div class="data-label">Sale Date</div>
<div class="data-value">September 9, 2025</div>
</div>
<div class="data-row top">
<div class="data-label">Publish Date(s)</div>
<div class="data-value text-end">
July 18, 2025<br/>
July 25, 2025<br/>
</div>
</div>
<div class="data-row top">
<div class="data-label">Property Address</div>
<div class="data-value text-end">
2319 CHIQUITA BLVD N<br/>
CAPE CORAL, FL 33993
</div>
</div>
<div class="data-row border-0">
<div class="data-label">Homestead</div>
<div class="data-value">No</div>
</div>
</div>
<div class="col-12 col-lg-6 px-3">
<div class="data-row">
<div class="data-label">Legal Description</div>
<div class="data-value">&nbsp;</div>
</div>
<div class="p-3 text-large">LOT 10, BLOCK 2970A, UNIT 42, CAPE CORAL, ACCORDING TO THE PLAT THEREOF RECORDED IN PLAT BOOK 17, PAGES 32 THROUGH 44, INCLUSIVE, PUBLIC RECORDS OF LEE COUNTY, FLORIDA</div>
</div>
</div>
</div>`;

const PARTIES_HTML = `
<table><tbody>
<tr>
<td>
<div class="d-flex justify-content-start align-items-center">
<i class="fa-thin fa-user me-3 fs-3 text-primary"></i>
<div class="lh-1">
<span class="text-black">CITY FLORIDA LAND INC.</span>
<div class="text-dark mt-1">APPLICANT</div>
</div>
</div>
</td>
<td class="text-end">5401 COLLINS AVENUE APT. 208 <br>MIAMI BEACH, FL 33140</td>
<td class="text-end">United States</td>
</tr>
<tr>
<td>
<div class="d-flex justify-content-start align-items-center">
<i class="fa-thin fa-user me-3 fs-3 text-primary"></i>
<div class="lh-1">
<span class="text-black">BEVERLY F. KONOPKA</span>
<div class="text-dark mt-1">OWNER</div>
</div>
</div>
</td>
<td class="text-end">130 WOODIN STREET <br>HAMDEN, CT 06489</td>
<td class="text-end">United States</td>
</tr>
<tr>
<td>
<div class="d-flex justify-content-start align-items-center">
<i class="fa-thin fa-user me-3 fs-3 text-primary"></i>
<div class="lh-1">
<span class="text-black">ESTATE OF KENNETH M. KONOPKA</span>
<div class="text-dark mt-1">OWNER</div>
</div>
</div>
</td>
<td class="text-end">130 WOODIN STREET <br>HAMDEN, CT 06489</td>
<td class="text-end">United States</td>
</tr>
<tr>
<td>
<div class="d-flex justify-content-start align-items-center">
<i class="fa-thin fa-user me-3 fs-3 text-primary"></i>
<div class="lh-1">
<span class="text-black">LINDA KONOPKA</span>
<div class="text-dark mt-1">INTERESTED PARTY</div>
</div>
</div>
</td>
<td class="text-end">47 NORTH HIGH ST LOT 8 <br>CLINTON, CT 06413</td>
<td class="text-end">United States</td>
</tr>
</tbody></table>`;

const DOCS_HTML = `
<div class="d-flex">Found 25 Results Displaying 1 - 20 Page 1 of 2</div>
<div class="d-lg-none">
<div class="content-box p-4 mb-1">
<div class="d-flex justify-content-start align-items-center">
<i class="fa-thin fa-file fs-5 me-2 text-primary" aria-hidden="true"></i>
Surplus Claim_Kevin Saturno
</div>
<div class="data-row p-2 mt-2">
<div class="data-label fw-normal">Upload Date</div>
<div class="data-value">June 9, 2026</div>
</div>
<div class="data-row p-2 mt-2">
<div class="data-label fw-normal">Filename</div>
<div class="data-value">2025000427 Surplus Claim_Kevin Saturno.pdf</div>
</div>
<div class="data-row p-2">
<div class="data-label fw-normal">Details</div>
<div class="data-value text-end ps-4">Case Document Uploaded</div>
</div>
<div class="data-row p-2 border-0">
<div class="data-label fw-normal">View Document</div>
<div class="data-value text-end ps-4">
<button class="btn btn-light w-100 d-flex justify-content-between align-items-center" data-documentid="10807110" data-doctype="CASE_LOG" aria-label="View Surplus Claim_Kevin Saturno" title="View Surplus Claim_Kevin Saturno">View Document<i class="fa-solid fa-external-link ms-2"></i></button>
</div>
</div>
</div>
<div class="content-box p-4 mb-1">
<div class="d-flex justify-content-start align-items-center">
<i class="fa-thin fa-file fs-5 me-2 text-primary" aria-hidden="true"></i>
SURPLUS_LETTER
</div>
<div class="data-row p-2 mt-2">
<div class="data-label fw-normal">Upload Date</div>
<div class="data-value">September 17, 2025</div>
</div>
<div class="data-row p-2 mt-2">
<div class="data-label fw-normal">Filename</div>
<div class="data-value">SURPLUS_LETTER.pdf</div>
</div>
<div class="data-row p-2">
<div class="data-label fw-normal">Details</div>
<div class="data-value text-end ps-4">The Surplus Letter is now available</div>
</div>
<div class="data-row p-2 border-0">
<div class="data-label fw-normal">View Document</div>
<div class="data-value text-end ps-4">
<button class="btn btn-light w-100 d-flex justify-content-between align-items-center" data-documentid="9825853" data-doctype="CASE_LOG" aria-label="View SURPLUS_LETTER" title="View SURPLUS_LETTER">View Document<i class="fa-solid fa-external-link ms-2"></i></button>
</div>
</div>
</div>
</div>`;

const NOTIF_HTML = `
<div class="d-flex">Found 3 Results Displaying 1 - 3 Page 1 of 1</div>
<div class="col-12">
<div class="content-box h-100 p-4">
<div class="fs-5"><i class="fa-regular fa-user me-2 text-primary"></i>KEVIN SATURNO</div>
<div class="data-row p-2">
<div class="data-label fw-normal">Party Type</div>
<div class="data-value">OWNER</div>
</div>
<div class="data-row p-2">
<div class="data-label fw-normal">Address</div>
<div class="data-value text-end lh-1">
972 GARDINER DRIVE<br/>
<div>
BAY SHORE, NY 11706</div>
</div>
</div>
<div class="data-row p-2">
<div class="data-label fw-normal">Delivery Type</div>
<div class="data-value text-end lh-1">Certified Mail</div>
</div>
</div>
</div>
<div class="col-12">
<div class="content-box h-100 p-4">
<div class="fs-5"><i class="fa-regular fa-user me-2 text-primary"></i>LINDA KONOPKA</div>
<div class="data-row p-2">
<div class="data-label fw-normal">Party Type</div>
<div class="data-value">INTERESTED PARTY</div>
</div>
<div class="data-row p-2">
<div class="data-label fw-normal">Address</div>
<div class="data-value text-end lh-1">
47 NORTH HIGH ST LOT 8<br/>
<div>
CLINTON, CT 06413</div>
</div>
</div>
<div class="data-row p-2">
<div class="data-label fw-normal">Delivery Type</div>
<div class="data-value text-end lh-1">Certified Mail</div>
</div>
</div>
</div>`;

describe('realTdmDate', () => {
  it('reads both the long detail form and the short list form', () => {
    expect(realTdmDate('September 9, 2025')).toBe('2025-09-09');
    expect(realTdmDate('Sep 9, 2025')).toBe('2025-09-09');
    expect(realTdmDate('June 24, 2025')).toBe('2025-06-24');
  });

  it('returns null rather than an epoch on junk', () => {
    // A 1970 notice date would sort to the top as the most overdue lead.
    expect(realTdmDate('Not Assigned')).toBeNull();
    expect(realTdmDate('')).toBeNull();
    expect(realTdmDate(null)).toBeNull();
  });
});

describe('parseListPage', () => {
  it('reads the desktop table rows with the county case id and posted balance', () => {
    const page = parseListPage(LIST_HTML);
    expect(page.title).toBe('realTDM : Lee - Case Search');
    expect(page.totalPages).toBe(11);
    expect(page.rows).toHaveLength(2);
    expect(page.rows[0]).toMatchObject({
      sourceCaseId: '82214',
      caseNumber: '2025000391',
      parcelId: '34-43-23-C1-02970.A100',
      saleDate: '2025-09-09',
      status: 'ACTIVE - SOLD BIDDER',
      surplus: 1189.11,
    });
    expect(page.rows[1]).toMatchObject({ status: 'COMPLETED - REDEEMED', surplus: 0 });
  });

  it('fails loudly when the column order moves', () => {
    // Without this a reordering upstream would write the parcel number into
    // the sale date and every clock downstream would be wrong, silently.
    const swapped = LIST_HTML.replace(
      '<th>Sale Date</th><th>Surplus Balance</th>',
      '<th>Surplus Balance</th><th>Sale Date</th>',
    );
    expect(() => parseListPage(swapped)).toThrow(/column order changed/);
  });
});

describe('assertCountySite', () => {
  it('refuses the demo site an unknown subdomain serves', () => {
    // A zero result from `realTDM : TEST` looks exactly like an empty county.
    expect(() => assertCountySite('realTDM : TEST - Case Search', 'Lee')).toThrow(/not the Lee site/);
    expect(() => assertCountySite('realTDM : Lee - Case Search', 'Lee')).not.toThrow();
  });
});

describe('parseSummary', () => {
  it('reads the sale date, the split property address and the legal description', () => {
    expect(parseSummary(SUMMARY_HTML)).toEqual({
      saleDate: '2025-09-09',
      appReceiveDate: '2025-06-24',
      street: '2319 CHIQUITA BLVD N',
      city: 'CAPE CORAL',
      state: 'FL',
      zip: '33993',
      homestead: false,
      legalDescription:
        'LOT 10, BLOCK 2970A, UNIT 42, CAPE CORAL, ACCORDING TO THE PLAT THEREOF RECORDED IN PLAT BOOK 17, PAGES 32 THROUGH 44, INCLUSIVE, PUBLIC RECORDS OF LEE COUNTY, FLORIDA',
    });
  });

  it('leaves the address empty on a case with none rather than inventing one', () => {
    const none = SUMMARY_HTML.replace('2319 CHIQUITA BLVD N<br/>\nCAPE CORAL, FL 33993', 'No Address<br/>\n, FL');
    const s = parseSummary(none);
    expect(s.street).toBeNull();
    expect(s.zip).toBeNull();
  });
});

describe('parseParties', () => {
  it('reads every party with role and mailing address', () => {
    const parties = parseParties(PARTIES_HTML);
    expect(parties.map((p) => [p.name, p.role])).toEqual([
      ['CITY FLORIDA LAND INC.', 'APPLICANT'],
      ['BEVERLY F. KONOPKA', 'OWNER'],
      ['ESTATE OF KENNETH M. KONOPKA', 'OWNER'],
      ['LINDA KONOPKA', 'INTERESTED PARTY'],
    ]);
    // The owner's address is in Connecticut. The property is in Cape Coral.
    // That gap is the whole reason the parties tab is read.
    expect(parties[1]).toMatchObject({
      street: '130 WOODIN STREET',
      city: 'HAMDEN',
      state: 'CT',
      zip: '06489',
      country: 'United States',
    });
  });
});

describe('parseDocumentsPage', () => {
  it('reads the label as the title, the document id, and the upload date', () => {
    const page = parseDocumentsPage(DOCS_HTML);
    expect(page.totalPages).toBe(2);
    expect(page.docs).toEqual([
      {
        title: 'Surplus Claim_Kevin Saturno',
        docId: '10807110',
        url: null,
        claimant: 'Kevin Saturno',
        filedAt: '2026-06-09',
        fileName: '2025000427 Surplus Claim_Kevin Saturno.pdf',
        docType: 'CASE_LOG',
      },
      {
        title: 'SURPLUS_LETTER',
        docId: '9825853',
        url: null,
        claimant: null,
        filedAt: '2025-09-17',
        fileName: 'SURPLUS_LETTER.pdf',
        docType: 'CASE_LOG',
      },
    ]);
  });
});

describe('inFilingOrder', () => {
  it('turns the newest-first docket into filing order, keeping same-day order', () => {
    const docs = [
      { title: 'Receipt', filedAt: '2026-06-09' },
      { title: 'Surplus Claim_Kevin Saturno', filedAt: '2026-06-09' },
      { title: 'SURPLUS_LETTER', filedAt: '2025-09-17' },
      { title: 'NOA_PARTIES', filedAt: null },
    ];
    expect(inFilingOrder(docs).map((d) => d.title)).toEqual([
      'NOA_PARTIES',
      'SURPLUS_LETTER',
      'Surplus Claim_Kevin Saturno',
      'Receipt',
    ]);
  });
});

describe('claimantFromTitle', () => {
  it('reads the claimant the clerk wrote into the claim title', () => {
    expect(claimantFromTitle('Surplus Claim_Kevin Saturno')).toBe('Kevin Saturno');
    expect(claimantFromTitle('SURPLUS CLAIM_ROBERT PITTARD')).toBe('ROBERT PITTARD');
  });

  it('tolerates a clerk typing the filename in as the label', () => {
    // Lee 2025000500: label is the filename, case number and extension included.
    expect(claimantFromTitle('2025000500 Surplus Claim_Ashley Berger.pdf')).toBe('Ashley Berger');
  });

  it('never invents a claimant from a document that is not a claim', () => {
    expect(claimantFromTitle('SURPLUS_LETTER')).toBeNull();
    expect(claimantFromTitle('Returned Mail')).toBeNull();
    expect(claimantFromTitle('Receipt')).toBeNull();
  });
});

describe('parseNotifications', () => {
  it('reads who the clerk mailed the surplus letter to, with role and delivery', () => {
    expect(parseNotifications(NOTIF_HTML)).toEqual([
      {
        name: 'KEVIN SATURNO',
        role: 'OWNER',
        street: '972 GARDINER DRIVE',
        city: 'BAY SHORE',
        state: 'NY',
        zip: '11706',
        attention: null,
        delivery: 'Certified Mail',
      },
      {
        name: 'LINDA KONOPKA',
        role: 'INTERESTED PARTY',
        street: '47 NORTH HIGH ST LOT 8',
        city: 'CLINTON',
        state: 'CT',
        zip: '06413',
        attention: null,
        delivery: 'Certified Mail',
      },
    ]);
  });

  it('returns nothing when the county has not generated that letter', () => {
    expect(parseNotifications('<div>NO NOTIFICATIONS</div><p>There are no notifications for this case!</p>')).toEqual([]);
  });
});

describe('splitAddressLines', () => {
  it('splits the last line into city, state and zip and keeps the rest as street', () => {
    expect(splitAddressLines(['5401 COLLINS AVENUE APT. 208', 'MIAMI BEACH, FL 33140'])).toEqual({
      street: '5401 COLLINS AVENUE APT. 208',
      city: 'MIAMI BEACH',
      state: 'FL',
      zip: '33140',
      attention: null,
    });
  });

  it('lifts a care-of or trustee line off the street so the house number leads', () => {
    // Lee 2024002557 was noticed "C/O GLENN BROWN / 4 BEE RIDGE CT". Folded
    // into one street it failed the house-number check and was never traced.
    expect(splitAddressLines(['C/O GLENN BROWN', '4 BEE RIDGE CT', 'SAINT PETERS, MO 63376'])).toEqual({
      street: '4 BEE RIDGE CT',
      city: 'SAINT PETERS',
      state: 'MO',
      zip: '63376',
      attention: 'C/O GLENN BROWN',
    });
    expect(
      splitAddressLines(['EDWARD H POTTER, TRUSTEE', '7935 HILLANDALE DRIVE', 'SAN DIEGO, CA 92120']).attention,
    ).toBe('EDWARD H POTTER, TRUSTEE');
    expect(splitAddressLines(['PO BOX 398', 'FT. MYERS, FL 33902']).street).toBe('PO BOX 398');
  });

  it('keeps a foreign or unparseable address whole rather than guessing parts', () => {
    // 19 Brevard owner records are overseas; splitting them by US rules
    // produces a state that does not exist and a zip that matches a stranger.
    expect(splitAddressLines(['BAHNHOFSTRASSE 12', '8001 ZURICH', 'SWITZERLAND'])).toEqual({
      street: 'BAHNHOFSTRASSE 12, 8001 ZURICH, SWITZERLAND',
      city: null,
      state: null,
      zip: null,
      attention: null,
    });
  });
});

describe('the surplus letter', () => {
  const LETTER = `September 17, 2025
Kevin C. Karnes
Clerk of the Circuit Court
Notice of Tax Deed Surplus
Tax Deed Number:2025000427
Certificate Number:23-04107 Certificate Year:2023
Pursuant to Chapter 197, Florida Statutes, the above property was sold at public sale on September-09-2025. The
sale resulted in a surplus of approximately $31,806.04 which will be held by this office for the benefit of persons
having an interest in this property, as described in 197.502(4), Florida Statutes.`;

  it('reads the surplus as stated at notice, which is the number to say on a call', () => {
    expect(surplusFromLetter(LETTER)).toBe(31806.04);
    expect(certificateFromLetter(LETTER)).toBe('23-04107');
  });

  it('returns null on a scan with no text layer', () => {
    expect(surplusFromLetter('')).toBeNull();
    expect(certificateFromLetter('')).toBeNull();
  });
});

/**
 * The three dockets the discovery pass opened, classified with the shared
 * rules. If a change moves any of these verdicts it is wrong until proven
 * otherwise, exactly as with the Duval fixtures.
 */
describe('classifying live Lee dockets', () => {
  const routine = [
    'Recorded Tax Deed',
    'Recorded Proof of Publication',
    'Proof of Publication',
    'COM_PARTIES',
    'NOA_POSTCARD',
    'NOA_PARTIES',
    'NOA_PARTIES_LABELS',
    'NOA_PUBLISHER',
    'NOA_PUBLISHER_LABELS',
    'INITIAL_LETTER',
    'INITIAL_LETTER_LABELS',
    'Recorded Notice of Application',
    'NOA_RECORDING',
    'Tax Deed Document',
    'Tax Deed Document',
  ];
  const docs = (titles: string[]) => titles.map((title) => ({ title, claimant: claimantFromTitle(title) }));

  it('82214 (2025000391): letter mailed, nothing filed, is OPEN', () => {
    const v = classifyCase(docs(['SURPLUS_LETTER_LABELS', 'SURPLUS_LETTER', ...routine]), {
      owners: ['BEVERLY F. KONOPKA', 'BEVERLY F KONOPKA', 'ESTATE OF KENNETH M. KONOPKA'],
    });
    expect(v.claimStatus).toBe('open');
    // The labels sheet must not count as a second notice.
    expect(v.counts.notices).toBe(1);
    expect(v.mailVerdict).toBe('unknown');
  });

  it('82220 (2025000427): both owners have claimed, so it is ASSIGNED and dead', () => {
    const v = classifyCase(
      docs([
        'Surplus Claim_Kevin Saturno',
        'Surplus Claim_Anthony H Staurno',
        'Receipt',
        'SURPLUS_LETTER',
        'SURPLUS_LETTER_LABELS',
        'Returned Mail',
        'Returned Mail',
        ...routine,
      ]),
      { owners: ['ANTHONY SATURNO', 'KEVIN SATURNO'] },
    );
    expect(v.claimStatus).toBe('assigned');
    expect(v.counts.claims).toBe(2);
    expect(v.counts.receipts).toBe(1);
    expect(v.mailVerdict).toBe('undeliverable');
  });

  it('82422 (2025000500): the owner claimed with the filename as the label; sheriff served', () => {
    const v = classifyCase(
      docs([
        '2025000500 Surplus Claim_Ashley Berger.pdf',
        'Returned Mail',
        'Returned Mail',
        "Sheriff's Service",
        "Sheriff's Service",
        "Sheriff's Service",
        'SHERIFF_LETTER',
        'SHERIFF_LETTER_LABELS',
        ...routine,
      ]),
      { owners: ['MICHAEL C BERGER', 'ASHLEY D BERGER'] },
    );
    expect(v.claimStatus).toBe('assigned');
    expect(v.ledger.filter((d) => d.kind === 'sheriff_served')).toHaveLength(3);
    // Sheriff service is at the property and says nothing about the owner's
    // mailing address, which the clerk's returned mail says is dead.
    expect(v.mailVerdict).toBe('undeliverable');
  });

  it('a receipt with no claim document beside it reads as a claim we cannot see, on Lee only', () => {
    // On Lee every one of 68 receipts sat on a claimed case. OPEN would put
    // this at the top of the board; PENDING is the honest rank. The rule is
    // opt-in per source because Duval files a bare "Receipt" on open cases.
    const titles = ['SURPLUS_LETTER', 'Receipt', ...routine];
    const lee = classifyCase(docs(titles), { owners: ['JANE DOE'], receiptsImplyClaim: true });
    expect(lee.claimStatus).toBe('pending');
    expect(lee.claimantUnknown).toBe(true);
    const elsewhere = classifyCase(docs(titles), { owners: ['JANE DOE'] });
    expect(elsewhere.claimStatus).toBe('open');
  });

  it('only mail returned AFTER the surplus letter condemns the address', () => {
    // Lee 2024002557: the notice of application bounced in February, the
    // surplus letter went out on March 19 to the clerk's corrected addresses
    // (one of them care of a relative) and nothing has come back since.
    // Counting the February returns gated 13 of the first 24 Lee leads out of
    // a skip trace they were exactly the right candidates for.
    const before = classifyCase(
      [
        { title: 'Returned Mail', filedAt: '2025-02-07' },
        { title: 'Returned Mail', filedAt: '2025-02-07' },
        { title: 'SURPLUS_LETTER', filedAt: '2025-03-19' },
      ],
      { owners: ['JOHN ALLEN BROWN'] },
    );
    expect(before.mailVerdict).toBe('unknown');

    // Lee 2024002573: two returns on May 20 against a May 14 letter. Dead.
    const after = classifyCase(
      [
        { title: 'Returned Mail', filedAt: '2025-02-03' },
        { title: 'SURPLUS_LETTER', filedAt: '2025-05-14' },
        { title: 'Returned Mail', filedAt: '2025-05-20' },
      ],
      { owners: ['DELORES ROUSE'] },
    );
    expect(after.mailVerdict).toBe('undeliverable');

    // Duval dates nothing, so every return still counts there.
    const undated = classifyCase(
      [{ title: 'Notice of Surplus Funds' }, { title: 'Certified Mail Undelivered' }],
      { owners: ['MYRTIS GRIFFIN'] },
    );
    expect(undated.mailVerdict).toBe('undeliverable');
  });

  it('a competitor claim leaves the owner residual contestable', () => {
    const v = classifyCase(docs(['SURPLUS_LETTER', 'Surplus Claim_Fast Funding LLC']), {
      owners: ['JANE DOE'],
    });
    expect(v.claimStatus).toBe('pending');
  });
});

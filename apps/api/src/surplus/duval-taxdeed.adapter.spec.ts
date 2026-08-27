import {
  duvalDate,
  parseOwners,
  parseAddress,
  detailField,
  parseDocuments,
} from './duval-taxdeed.adapter';

describe('duvalDate', () => {
  it('reads the M/D/YYYY the grid ships', () => {
    expect(duvalDate('1/14/2026')).toBe('2026-01-14');
    expect(duvalDate('12/3/2025')).toBe('2025-12-03');
  });

  it('tolerates the time the detail page sometimes appends', () => {
    expect(duvalDate('4/15/2026 9:00 AM')).toBe('2026-04-15');
  });

  it('returns null rather than an epoch date on junk', () => {
    // A null sale date leaves the clock unset and visibly unknown. A 1970 date
    // would render as a 20,000 day old notice and sort to the top.
    expect(duvalDate('')).toBeNull();
    expect(duvalDate(null)).toBeNull();
    expect(duvalDate('not a date')).toBeNull();
  });
});

describe('parseOwners', () => {
  it('splits the tilde-delimited list and drops the duplicates', () => {
    // Verbatim from Duval case 2021-0002TD, which repeats the trustee three
    // times and the LLC twice.
    const raw =
      '~RICHARD D HUGHES AS TRUSTEE OF THE MINNIE BOWDISH TRUST~~RICHARD D HUGHES AS TRUSTEE OF THE MINNIE BOWDISH TRUST~~RICHARD D HUGHES AS TRUSTEE OF THE MINNIE BOWDISH TRUST~~MINNIE BOWDISH TRUST LLC~~MINNIE BOWDISH TRUST LLC';
    expect(parseOwners(raw)).toEqual([
      'RICHARD D HUGHES AS TRUSTEE OF THE MINNIE BOWDISH TRUST',
      'MINNIE BOWDISH TRUST LLC',
    ]);
  });

  it('strips the trailing comma the source leaves on some entries', () => {
    expect(parseOwners('~DANNIE LESTER STEWART ESTATE,~~DANNIE LESTER STEWART~')).toEqual([
      'DANNIE LESTER STEWART ESTATE',
      'DANNIE LESTER STEWART',
    ]);
  });

  it('keeps genuinely different co-owners', () => {
    // Dropping one of these loses a claimant, and each claimant is its own lead.
    expect(parseOwners('~JOHN SMITH~~MARY SMITH~')).toEqual(['JOHN SMITH', 'MARY SMITH']);
  });

  it('splits the newline form the DETAIL page ships', () => {
    // The grid uses tildes, the detail page uses newlines with a trailing comma
    // on every entry but the last. Both reach this function.
    expect(parseOwners('DANNIE LESTER STEWART ESTATE,\nDANNIE LESTER STEWART\n')).toEqual([
      'DANNIE LESTER STEWART ESTATE',
      'DANNIE LESTER STEWART',
    ]);
  });

  it('never splits on the comma inside an entity name', () => {
    // The trap: every detail-page line but the last ends in a comma, so comma
    // splitting looks right and is not. These are each ONE owner, and splitting
    // them invents claimants and leads for people who do not exist.
    expect(parseOwners('HERCELL, LLLP\n')).toEqual(['HERCELL, LLLP']);
    expect(parseOwners('HEAVENLY HANDS FUNDING, LLC\n')).toEqual(['HEAVENLY HANDS FUNDING, LLC']);
    expect(parseOwners('MYRTIS GRIFFIN,\nJESSIE HALL\n')).toEqual(['MYRTIS GRIFFIN', 'JESSIE HALL']);
  });

  it('handles an empty field', () => {
    expect(parseOwners('')).toEqual([]);
    expect(parseOwners(null)).toEqual([]);
  });
});

describe('parseAddress', () => {
  it('splits a full Duval property address', () => {
    expect(parseAddress('2533 JERNIGAN RD, JACKSONVILLE, FL 32207')).toEqual({
      street: '2533 JERNIGAN RD',
      city: 'JACKSONVILLE',
      state: 'FL',
      zip: '32207',
    });
  });

  it('drops a ZIP+4 to the five digit form', () => {
    expect(parseAddress('2866 W 11TH ST, JACKSONVILLE, FL 32254-1923').zip).toBe('32254');
  });

  it('keeps an unparseable address as the street rather than losing it', () => {
    // Duval 2026-0004TD ships "BROADWAY AVE, JACKSONVILLE, FL 32254" with no
    // house number, and other rows ship no city at all. Keeping the raw string
    // means the case is still identifiable on the card.
    expect(parseAddress('SOME ODD LOCATION')).toEqual({
      street: 'SOME ODD LOCATION',
      city: null,
      state: 'FL',
      zip: null,
    });
  });
});

describe('detailField', () => {
  const html = `
    <div class="row"><label>Case Number</label><span>2025-0774TD</span></div>
    <div class="row"><label>Parcel ID</label><span>147264-0000</span></div>
    <div class="row"><label>Surplus</label><span>$27,929.98</span></div>
    <div class="row"><label>Property Owners</label><span>KENNETH PEEPLES</span></div>
  `;

  it('reads a labelled value', () => {
    expect(detailField(html, 'Case Number')).toBe('2025-0774TD');
    expect(detailField(html, 'Surplus')).toBe('$27,929.98');
  });

  it('returns null for a label that is not on the page', () => {
    expect(detailField(html, 'Certificate')).toBeNull();
  });

  it('does not let one label match another that contains it', () => {
    // "Parcel ID" must not be answered by a "Parcel" label elsewhere.
    expect(detailField(html, 'Parcel ID')).toBe('147264-0000');
  });
});

describe('parseDocuments', () => {
  it('reads linked documents in filing order with their ids', () => {
    const html = `<h3>Documents</h3>
      <a href="/Home/Image/98045">Notice Of Surplus Funds</a>
      <a href="/Home/Image/98797">Surplus - Submitted Claim</a>
      <a href="/Home/Image/98798">Denial Letter</a>`;
    expect(parseDocuments(html)).toEqual([
      { title: 'Notice Of Surplus Funds', docId: '98045', url: '/Home/Image/98045' },
      { title: 'Surplus - Submitted Claim', docId: '98797', url: '/Home/Image/98797' },
      { title: 'Denial Letter', docId: '98798', url: '/Home/Image/98798' },
    ]);
  });

  it('keeps filings the clerk indexed but never scanned', () => {
    // These carry no anchor. Dropping them would lose Surplus Breakdown, which
    // is distribution evidence, and Applicant Disbursement, which is the trap
    // that must NOT be read as one.
    const html = `<h3>Documents</h3>
      <a href="/Home/Image/108427">Surplus Distribution</a>
      Applicant Disbursement (Image Not Available)
      Surplus Breakdown (Image Not Available)`;
    const docs = parseDocuments(html);
    expect(docs.map((d) => d.title)).toEqual([
      'Surplus Distribution',
      'Applicant Disbursement',
      'Surplus Breakdown',
    ]);
    expect(docs[1].docId).toBeNull();
  });

  it('does not pick up navigation links from above the Documents heading', () => {
    const html = `<a href="/Home/Image/1">Back to Search Results</a>
      <h3>Documents</h3>
      <a href="/Home/Image/98045">Notice Of Surplus Funds</a>`;
    expect(parseDocuments(html).map((d) => d.title)).toEqual(['Notice Of Surplus Funds']);
  });

  it('decodes entities in a title', () => {
    const html = `<h3>Documents</h3><a href="/Home/Image/9">Return of Service from Sheriff&#39;s Office</a>`;
    expect(parseDocuments(html)[0].title).toBe("Return of Service from Sheriff's Office");
  });

  it('returns an empty list for a page with no documents', () => {
    expect(parseDocuments('<h3>Documents</h3>')).toEqual([]);
  });
});

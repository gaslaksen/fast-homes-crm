import { classifyCase, classifyDocument } from './surplus-classify.util';
import {
  DuvalTaxDeedAdapter,
  HernandoTaxSmartAdapter,
  taxSmartDate,
  parseOwners,
  parseAddress,
  detailField,
  parseDocuments,
} from './pioneer-taxsmart.adapter';

describe('taxSmartDate', () => {
  it('reads the M/D/YYYY the grid ships', () => {
    expect(taxSmartDate('1/14/2026')).toBe('2026-01-14');
    expect(taxSmartDate('12/3/2025')).toBe('2025-12-03');
  });

  it('tolerates the time the detail page sometimes appends', () => {
    expect(taxSmartDate('4/15/2026 9:00 AM')).toBe('2026-04-15');
  });

  it('returns null rather than an epoch date on junk', () => {
    // A null sale date leaves the clock unset and visibly unknown. A 1970 date
    // would render as a 20,000 day old notice and sort to the top.
    expect(taxSmartDate('')).toBeNull();
    expect(taxSmartDate(null)).toBeNull();
    expect(taxSmartDate('not a date')).toBeNull();
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

/**
 * Citrus and Hernando, from the 2026-09-18 discovery pass over every live case
 * over the floor: 147 in Citrus, 43 in Hernando. Titles are verbatim.
 */
describe('Pioneer counties beyond Duval', () => {
  const doc = (title: string) => ({ title });

  it('reads documents through the path prefix Citrus and Hernando serve under', () => {
    const html = `<h3>Documents</h3>
      <a href="/TaxSmartWeb/Home/Image/145437" target="_blank">Returned Mail</a>
      <a href="/TaxSmart/Home/Image/68376" target="_blank">Claims Filed</a>`;
    expect(parseDocuments(html)).toEqual([
      { title: 'Returned Mail', docId: '145437', url: '/TaxSmartWeb/Home/Image/145437' },
      { title: 'Claims Filed', docId: '68376', url: '/TaxSmart/Home/Image/68376' },
    ]);
  });

  it('knows the two counties\' notice titles and Hernando\'s claim folder', () => {
    expect(classifyDocument('Surplus')).toBe('notice_surplus');
    expect(classifyDocument('QUADIENT: Surplus PDF (161)')).toBe('notice_surplus');
    expect(classifyDocument('Claims Filed')).toBe('claim');
    // The deed going back from the BIDDER's address, not the clerk's notice
    // coming back from the owner's.
    expect(classifyDocument('Tax Deed Returned Undeliverable')).toBe('other');
    expect(classifyDocument('Recorded Tax Deed Returned Undeliverable')).toBe('other');
    // Still a real bounce everywhere it means one.
    expect(classifyDocument('Returned Mail')).toBe('mail_undeliverable');
  });

  it('Hernando 2026-033TD: the claim folder makes it pending, and a check request does not close it', () => {
    const v = classifyCase(
      ['APPLICANT', 'ADVERTISING', 'Certificate of Mailing', 'Claims Filed', 'Notice of Mailing',
       'Report of Sale', 'Tax Deed', 'Surplus', 'Check Request'].map(doc),
      { owners: ['LISA THOMPSON, LIFE ESTATE'] },
    );
    expect(v.claimStatus).toBe('pending');
    expect(v.counts.distributions).toBe(0);
  });

  it('Hernando 2025-038TD: a check request with no claim beside it leaves the case open', () => {
    // 7 of the 18 check requests sat on cases with no claim at all, and the
    // county still posts the full surplus on every one.
    const v = classifyCase(
      ['APPLICANT', 'Recorded Notice of Application for Tax Deed', '2024 Taxes', 'Surplus', 'Check Request'].map(doc),
      { owners: ['THOMAS L HENRY', 'ROSARIO A SCLAFANI'] },
    );
    expect(v.claimStatus).toBe('open');
  });

  it('Citrus: the folders it files on every case say nothing, and the verdict admits claims are invisible', () => {
    const citrus = {
      categoryFolders: ['Returned Mail', 'Additional Taxes', 'APPLICATION'],
      claimsNotPublished: true,
      owners: ['BARBARA CHAMNESS'],
    };
    const v = classifyCase(
      ['APPLICATION', 'Returned Mail', 'Additional Taxes', 'LETTERS: Notice of Application for Case (#40861B)',
       'Bid Log', 'Tax Deed (#43227)', 'QUADIENT: Surplus PDF (161)'].map(doc),
      citrus,
    );
    expect(v.claimStatus).toBe('open');
    // Read literally, the folder would mark all 147 Citrus claimants unreachable.
    expect(v.mailVerdict).toBe('unknown');
    expect(v.ledger.some((d) => d.kind === 'mail_undeliverable')).toBe(false);
    expect(v.reason).toContain('does not publish claims');
  });

  it('Citrus without the flags would call every claimant undeliverable, which is why they exist', () => {
    const v = classifyCase([doc('Returned Mail'), doc('QUADIENT: Surplus PDF (161)')], { owners: ['BARBARA CHAMNESS'] });
    expect(v.mailVerdict).toBe('undeliverable');
  });

  it('Hernando: an empty Claims Filed folder is not a claim', () => {
    // All 82 Hernando cases list "Claims Filed"; 47 carry no image. Counting
    // the folder itself made all 31 workable cases read as claimed, and the
    // county's real number is 14.
    const html = `<h3>Documents</h3>
      <a href="/TaxSmart/Home/Image/1" target="_blank">Surplus</a>
      Claims Filed (Image Not Available)`;
    const hernando = new HernandoTaxSmartAdapter({ get: () => undefined } as any);
    const kept = (hernando as any).unlinkedDocsAreFolders
      ? parseDocuments(html).filter((d: any) => d.docId)
      : parseDocuments(html);
    expect(kept.map((d: any) => d.title)).toEqual(['Surplus']);
    expect(classifyCase(kept, { owners: ['X Y'] }).claimStatus).toBe('open');
    // Duval keeps its image-less filings: that is where its distributions live.
    const duval = new DuvalTaxDeedAdapter({ get: () => undefined } as any);
    expect(duval.unlinkedDocsAreFolders).toBeFalsy();
    expect(parseDocuments('<h3>Documents</h3>Applicant Disbursement (Image Not Available)').map((d) => d.title))
      .toEqual(['Applicant Disbursement']);
  });

  it('absolutizes document links against the origin, not the prefixed base URL', () => {
    // The prefix is already in the anchor, so joining it onto a base URL that
    // also carries it gave /TaxSmart/TaxSmart/Home/Image/70088 and a 404.
    const hernando = new HernandoTaxSmartAdapter({ get: () => undefined } as any);
    const docs = (hernando as any).absoluteDocuments([
      { title: 'Surplus', docId: '70088', url: '/TaxSmart/Home/Image/70088' },
      { title: 'Already absolute', docId: '1', url: 'https://example.test/x' },
    ]);
    expect(docs[0].url).toBe('https://or.hernandoclerk.com/TaxSmart/Home/Image/70088');
    expect(docs[1].url).toBe('https://example.test/x');
    const duval = new DuvalTaxDeedAdapter({ get: () => undefined } as any);
    expect((duval as any).absoluteDocuments([{ title: 'x', docId: '1', url: '/Home/Image/1' }])[0].url)
      .toBe('https://taxdeed.duvalclerk.com/Home/Image/1');
  });

  it('Hernando keeps its returned mail, because it files no such folder', () => {
    const v = classifyCase([doc('Surplus'), doc('Returned Mail')], { owners: ['X Y'] });
    expect(v.mailVerdict).toBe('undeliverable');
  });
});

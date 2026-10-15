import { classifyCase, classifyDocument } from './surplus-classify.util';
import { matchRecipient } from './surplus-name-search.util';
import {
  CharlotteTaxDeedAdapter,
  charlotteDate,
  parseCharlotteOwners,
  parseCharlotteAddress,
  preCleanOwner,
  rowToSummary,
  toDocument,
  viewerImagePath,
  viewerUrl,
} from './charlotte-taxdeed.adapter';

/** Docket rows as GetTaxDeedDocumentView returns them, from the 2026-10-15 discovery pass. */
const row = (DocumentId: number, Description: string, HideFromWeb = false) => ({
  CaseId: 27102,
  Description,
  DocumentId,
  DocumentType: Description,
  HideFromWeb,
  PageCount: 1,
});

/** 25-0952: sold 2026-01-27, noticed, nothing filed. */
const DOCKET_25_0952 = [
  row(412484, 'DR513 & TAX COLLECTOR CERT'),
  row(412485, 'PROPERTY INFORMATION REPORT'),
  row(412486, 'MISCELLANEOUS'),
  row(412487, 'CHECKS', true),
  row(412489, 'MAIL - RETURN RECEIPTS'),
  row(412490, 'MAIL - ENVELOPES'),
  row(412629, 'LETTERS: NOTICE OF APPLICATION FOR TD'),
  row(412736, 'LETTERS: MULTIPLE APPLICANT BILL'),
  row(413387, 'RECEIPT'),
  row(416860, 'LETTERS: CLERK AFFIDAVIT'),
  row(416976, 'COMPTROLLER: CHECK REQUEST BY AUCTION DATE '),
  row(417055, 'TAX DEED'),
  row(417074, 'COMPTROLLER: CHECK REQUEST'),
  row(417075, 'COMPTROLLER: DISBURSEMENT REGISTER'),
  row(417093, 'LETTERS: NOTICE OF SURPLUS'),
];

/** 25-0858: two claims, each with its hidden W-9 and a hidden attachment. */
const DOCKET_25_0858 = [
  row(411214, 'MAIL - RETURN RECEIPTS'),
  row(412766, 'RECEIPT'),
  row(416624, 'COMPTROLLER: DISBURSEMENT REGISTER'),
  row(416661, 'LETTERS: NOTICE OF SURPLUS'),
  row(418906, 'EXCESS MONEY CLAIM'),
  row(418907, 'TAX FORM FOR COMPTROLLER', true),
  row(418910, "CAN'T GO ON THE WEB", true),
  row(428450, 'EXCESS MONEY CLAIM'),
  row(428451, 'TAX FORM FOR COMPTROLLER', true),
];

const docs = (rows: any[]) => rows.map(toDocument).filter(Boolean) as any[];

describe('charlotteDate', () => {
  it('reads the ISO the list ships and the M/D/YYYY the detail ships', () => {
    expect(charlotteDate('2026-01-27T09:00:00')).toBe('2026-01-27');
    expect(charlotteDate('01/27/2026')).toBe('2026-01-27');
    expect(charlotteDate('1/7/2014')).toBe('2014-01-07');
  });

  it('returns null rather than an epoch on junk', () => {
    expect(charlotteDate('')).toBeNull();
    expect(charlotteDate(null)).toBeNull();
    expect(charlotteDate('soon')).toBeNull();
  });
});

describe('parseCharlotteOwners', () => {
  it('reads 26-0405, where the living trustees must not become an estate', () => {
    // The testator is DECEASED; the trustees are not. The clerk spells it
    // TRUSTESS, which the shared cleaner does not know.
    const raw =
      'HAMMER, ALICE M. AS TO AN UNDIVIDED 1/2 INTEREST\r\n' +
      'COCHRUN, BEATRICE R AS TRUSTESS UNDER THE WILL OF CHARLES J HAMMER, DECEASED, AS TO AN UNDIVIDED 1/2 INTEREST\r\n' +
      'HAMMER, HAROLD H. AS TRUSTESS UNDER THE WILL OF CHARLES J HAMMER, DECEASED, AS TO AN UNDIVIDED 1/2 INTEREST';
    expect(parseCharlotteOwners(raw)).toEqual(['HAMMER, ALICE M.', 'COCHRUN, BEATRICE R', 'HAMMER, HAROLD H.']);
  });

  it('collapses an LLC written with and without its charter (26-0370)', () => {
    expect(
      parseCharlotteOwners('SONO HOMES, LLC, A FLORIDA LIMITED LIABILITY COMPANY\r\nSONO HOMES LLC'),
    ).toEqual(['SONO HOMES, LLC']);
  });

  it('keeps a surname-first line as ONE person', () => {
    // The RealTDM compound splitter makes two people of each of these.
    expect(parseCharlotteOwners('MILLER JR, GEORGE G.')).toEqual(['MILLER JR, GEORGE G.']);
    expect(parseCharlotteOwners('DE PARADIS, DOLORES APONTE')).toEqual(['DE PARADIS, DOLORES APONTE']);
    expect(parseCharlotteOwners('JUDD TRAVIS, NORMA V.')).toEqual(['JUDD TRAVIS, NORMA V.']);
  });

  it('takes the share off in every wording the list uses', () => {
    const lines: [string, string][] = [
      ['HARRIS, EIRA, 1/12 INTEREST', 'HARRIS, EIRA'],
      ['CLOYES, DOUGLAS G., AN UNDIVIDED 1/6TH INTEREST', 'CLOYES, DOUGLAS G.'],
      ['SPARKS, CATHERINE, UNDIVIDED 1/9TH INTEREST', 'SPARKS, CATHERINE'],
      ['EDWARDS, JAMIE, EACH WITH AN UNDIVIDED 1/5TH INTEREST', 'EDWARDS, JAMIE'],
      ['TOBIAS, GARY, EACH 1/3RD INTEREST', 'TOBIAS, GARY'],
      ['ERICSON, JOHN TUCKER, AS TO A 1/5TH INTEREST', 'ERICSON, JOHN TUCKER'],
      ['BOURCIER, JEAN AN UNDIVIDED 50% INTEREST', 'BOURCIER, JEAN'],
      ['PADAR JR, ALBERT EACH AN UNDIVIDED 1/2 INTEREST', 'PADAR JR, ALBERT'],
      ['ALLEN II, ROY P., 1/4 INTEREST', 'ALLEN II, ROY P.'],
    ];
    for (const [raw, want] of lines) expect(parseCharlotteOwners(raw)).toEqual([want]);
  });

  it('does not read a life estate as a dead owner', () => {
    expect(parseCharlotteOwners('GINER, MARGARET T, AS TO A LIFE ESTATE')).toEqual(['GINER, MARGARET T']);
  });

  it('writes an estate once, not "ESTATE OF THE ESTATE OF"', () => {
    expect(parseCharlotteOwners('THE ESTATE OF JACK KING, DECEASED')).toEqual(['ESTATE OF JACK KING']);
    expect(parseCharlotteOwners('THE ESTATE OF MARIE J. ARBUCCI, DECEASED, AN UNDIVIDED 1/2 INTEREST')).toEqual([
      'ESTATE OF MARIE J. ARBUCCI',
    ]);
  });

  it('keeps the personal representative convention the other counties use', () => {
    expect(
      parseCharlotteOwners('MCCRORY, JILL C. AS PERSONAL REPRESENTATIVE OF THE ESTATE OF JAMES B. IRWIN, DECEASED'),
    ).toEqual(['ESTATE OF JAMES B. IRWIN']);
  });

  it('drops charters, typos and all, and a trade name', () => {
    expect(parseCharlotteOwners('SUN AND SAND HOMES LLC, A FLORIDA LIMITED LIABILTY COMPANY')).toEqual([
      'SUN AND SAND HOMES LLC',
    ]);
    expect(parseCharlotteOwners('MAX SUPREME MANAGEMENT, LLC, A FLORIDA LIMITED L IABILITY COMPANY')).toEqual([
      'MAX SUPREME MANAGEMENT, LLC',
    ]);
    expect(parseCharlotteOwners('KB HOME FORT MYERS, LLC A DELAWARE LIMITED LIABILITY COMPANY')).toEqual([
      'KB HOME FORT MYERS, LLC',
    ]);
    expect(parseCharlotteOwners('FLIPPINGHOUSE, LLC, A FLORIDA LIMITED LIABILITY COMPANY, D/B/A JMJ HOMES')).toEqual([
      'FLIPPINGHOUSE, LLC',
    ]);
  });

  it('keeps a numbered company its number', () => {
    expect(parseCharlotteOwners('1720763 ONTARIO, LTD')).toEqual(['1720763 ONTARIO, LTD']);
  });

  it('reads the IRA owner out of a custodial line', () => {
    expect(parseCharlotteOwners('AMERICAN ESTATE AND TRUST FBO SHANNON SCOTT IRA')).toEqual(['SHANNON SCOTT']);
  });

  it('handles an empty field', () => {
    expect(parseCharlotteOwners('')).toEqual([]);
    expect(parseCharlotteOwners(null)).toEqual([]);
  });

  it('leaves a plain name alone apart from trailing space', () => {
    expect(preCleanOwner('MCNEAL, JOSEPH ')).toBe('MCNEAL, JOSEPH');
  });
});

describe('parseCharlotteAddress', () => {
  it('stores nothing for the words the county uses in place of an address', () => {
    expect(
      parseCharlotteAddress('ADDRESS 1 NOT AVAILABLE|ADDRESS 2 NOT AVAILABLE|CITY NOT AVAILABLE|FL|ZIP NOT AVAILABLE'),
    ).toEqual({ street: null, city: null, state: 'FL', zip: null });
  });

  it('reads one the county does hold', () => {
    expect(parseCharlotteAddress('123 MAIN ST|UNIT 4|PUNTA GORDA|FL|33950-1234')).toEqual({
      street: '123 MAIN ST UNIT 4',
      city: 'PUNTA GORDA',
      state: 'FL',
      zip: '33950',
    });
  });
});

describe('the list row', () => {
  it('reads 25-0952 as the list ships it', () => {
    expect(
      rowToSummary({
        Applicant: 'LINDA ULMER',
        BaseBid: 5195.36,
        CaseId: 27102,
        CaseNumber: '25-0952',
        CertificateNumber: '2022-718',
        HighBid: 11200.0,
        Owners: 'PICCIOLO, GIUSEPPE',
        ParcelId: '402106204006',
        SaleDate: '2026-01-27T09:00:00',
        Status: 'SOLD',
        Surplus: 5905.69,
      }),
    ).toEqual({
      sourceCaseId: '27102',
      caseNumber: '25-0952',
      certificateNumber: '2022-718',
      parcelId: '402106204006',
      saleDate: '2026-01-27',
      status: 'SOLD',
      surplus: 5905.69,
      openingBid: 5195.36,
      highBid: 11200,
      owners: ['PICCIOLO, GIUSEPPE'],
    });
  });

  it('trims the stray space the county leaves on a certificate number', () => {
    expect(rowToSummary({ CaseId: 19427, CaseNumber: '19-1248', CertificateNumber: ' 4020-2017' })?.certificateNumber).toBe(
      '4020-2017',
    );
  });

  it('skips a row with no case id', () => {
    expect(rowToSummary({ CaseNumber: '19-1248' })).toBeNull();
  });

  const adapter = new CharlotteTaxDeedAdapter({ get: () => undefined } as any);
  const s = (status: string) => ({ sourceCaseId: '1', caseNumber: 'x', owners: [], status });

  it('works SOLD and the pending claim flag alike, since the flag is unreliable', () => {
    // 26724 reads plain SOLD with a claim on its docket.
    expect(adapter.isLive(s('SOLD'))).toBe(true);
    expect(adapter.isLive(s('SOLD - PENDING EXCESS MONEY CLAIM'))).toBe(true);
    expect(adapter.isLive(s('SOLD - EXCESS FUNDS SENT TO STATE'))).toBe(false);
    expect(adapter.isLive(s('SOLD - NO BID'))).toBe(false);
    expect(adapter.isLive(s('SOLD - LANDS AVAILABLE'))).toBe(false);
  });

  it('retires a case whose money went to the state', () => {
    expect(adapter.isPaidOut(s('SOLD - EXCESS FUNDS SENT TO STATE'))).toBe(true);
    expect(adapter.isPaidOut(s('SOLD'))).toBe(false);
  });

  it('polls weekly with the other counties', () => {
    expect(adapter.cadence).toBe('weekly');
    expect(adapter.county).toBe('Charlotte');
  });
});

describe('documents', () => {
  it('builds the viewer link the clerk page opens', () => {
    // Computed the clerk's way: base64 of escape("app=TAXDEEDWEB&imagenumber=417093&...").
    expect(viewerUrl(417093)).toBe(
      'https://viewer.charlotteclerk.com/Viewer.aspx?YXBwJTNEVEFYREVFRFdFQiUyNmltYWdlbnVtYmVyJTNENDE3MDkzJTI2c3RhcnRwYWdlJTNEMCUyNnRvdGFscGFnZXMlM0Qw',
    );
  });

  it('finds the session image path on the viewer page', () => {
    const html =
      '<input type="hidden" name="WebThumbnailViewer1_uri" id="WebThumbnailViewer1_uri" value="/atala-capture-upload/4p4gchvxtigjfvnapc5e25d2417093.tif" />';
    expect(viewerImagePath(html)).toBe('/atala-capture-upload/4p4gchvxtigjfvnapc5e25d2417093.tif');
    expect(viewerImagePath('<html></html>')).toBeNull();
  });

  it('keeps a hidden document on the ledger without a link', () => {
    expect(toDocument(row(412487, 'CHECKS', true))).toEqual({
      title: 'CHECKS',
      docId: '412487',
      url: null,
      docType: 'CHECKS',
    });
    expect(toDocument(row(417093, 'LETTERS: NOTICE OF SURPLUS'))?.url).toBe(viewerUrl(417093));
  });

  it('knows the notice and the claim, and nothing else on the docket means anything', () => {
    expect(classifyDocument('LETTERS: NOTICE OF SURPLUS')).toBe('notice_surplus');
    expect(classifyDocument('EXCESS MONEY CLAIM')).toBe('claim');
    // Sale-day paperwork on every case, before the notice.
    for (const t of [
      'COMPTROLLER: DISBURSEMENT REGISTER',
      'COMPTROLLER: CHECK REQUEST',
      'COMPTROLLER: CHECK REQUEST BY AUCTION DATE ',
      'TAX FORM FOR COMPTROLLER',
      'LETTERS: NOTICE OF APPLICATION FOR TD',
    ]) {
      expect(classifyDocument(t)).toBe('other');
    }
  });
});

describe('Charlotte verdicts', () => {
  const opts = { owners: ['PICCIOLO, GIUSEPPE'], docketInFilingOrder: true };

  it('25-0952: noticed, nothing filed, so open', () => {
    const v = classifyCase(docs(DOCKET_25_0952), opts);
    expect(v.claimStatus).toBe('open');
    // The sale-day RECEIPT is the purchaser's, on every case.
    expect(v.counts.claims).toBe(0);
  });

  it('25-0858: two claims on file, so pending', () => {
    const v = classifyCase(docs(DOCKET_25_0858), opts);
    expect(v.claimStatus).toBe('pending');
    expect(v.counts.claims).toBe(2);
    expect(v.counts.distributions).toBe(0);
  });

  it('green cards from the application notice say nothing about the surplus letter', () => {
    // The MAIL - RETURN RECEIPTS on 25-0952 is filed months before the notice.
    expect(classifyCase(docs(DOCKET_25_0952), opts).mailVerdict).toBe('unknown');
    // Without the order the classifier would call the address delivered.
    expect(classifyCase(docs(DOCKET_25_0952), { owners: opts.owners }).mailVerdict).toBe('delivered');
  });

  it('a return filed AFTER the notice still counts', () => {
    const later = [...DOCKET_25_0952, row(418000, 'RETURNED MAIL')];
    expect(classifyDocument('RETURNED MAIL')).toBe('mail_undeliverable');
    expect(classifyCase(docs(later), opts).mailVerdict).toBe('undeliverable');
  });
});

describe('matching notice addressees to owners', () => {
  const adapter = new CharlotteTaxDeedAdapter({ get: () => undefined } as any);

  it('26-0405: each owner finds their own page once the deed wording is off the addressee', () => {
    // As the notice reader returned them from the live 14-page TIFF on 2026-10-15.
    const printed = [
      { name: 'HAMMER, ALICE M. AS TO AN UNDIVIDED 1/2 INTEREST', street: '684 S CLOVER AVENUE', zip: '95128' },
      {
        name: 'COCHRUN, BEATRICE R AS TRUSTESS UNDER THE WILL OF CHARLES J HAMMER, DECEASED, AS TO AN UNDIVIDED 1/2 INTEREST',
        street: '684 S CLOVER AVENUE',
        zip: '95128',
      },
      {
        name: 'HAMMER, HAROLD H. AS TRUSTESS UNDER THE WILL OF CHARLES J HAMMER, DECEASED, AS TO AN UNDIVIDED 1/2 INTEREST',
        street: '1407 BEVERLY DRIVE',
        zip: '93291',
      },
      { name: 'HAMMER-COCHRUN PROPERTIES', street: '525 WEST CENTER AVENUE SUITE D', zip: '93291' },
    ];
    // Read raw, INTEREST is everybody's surname and nobody matches.
    expect(matchRecipient('HAMMER, ALICE M.', printed)).toBeNull();

    const cleaned = printed.map((r) => ({ ...r, name: adapter.ownerName(r.name) || r.name }));
    expect(matchRecipient('HAMMER, ALICE M.', cleaned)?.street).toBe('684 S CLOVER AVENUE');
    expect(matchRecipient('COCHRUN, BEATRICE R', cleaned)?.name).toBe('COCHRUN, BEATRICE R');
    expect(matchRecipient('HAMMER, HAROLD H.', cleaned)?.street).toBe('1407 BEVERLY DRIVE');
  });
});

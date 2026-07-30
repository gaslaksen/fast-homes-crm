import { ForeclosureDocumentType, ForeclosureExtractionMethod } from '@fast-homes/shared';
import {
  sha256Hex,
  squash,
  classifyDocumentType,
  caseNumberFrom,
  normalizeCaseNumber,
  isCaseNumberLike,
  charsPerPageOf,
  isTextLayerThin,
  extractionMethodOf,
  THIN_TEXT_CHARS_PER_PAGE,
} from './foreclosure-document.util';

/**
 * Caption of 26SP002244-590 (Mecklenburg, LOGS/LLG Trustee) as pdf-parse
 * actually returns it: page 1 is a scan with an OCR text layer, so the spaces
 * are gone in places. Kept verbatim - the mashing is the thing under test.
 */
const LOGS_CAPTION =
  ' 26SP002244-590 STATEOFNORTHCAROLINA INTHE GENERALCOURTOFJUSTICE SUPERIORCOURTDIVISION' +
  ' MECKLENBURGCOUNTY INTHEMATTER OF THE FORECLOSUREOF ADEED OF TRUSTEXECUTED BYBELINDA' +
  ' SPEARS DATED OCTOBER 22, 2022AND RECORDED IN BOOK37739 AT PAGE576 INTHE' +
  ' MECKLENBURGCOUNTYPUBLIC REGISTRY, NORTHCAROLINA SUBSTITUTETRUSTEE:LLGTrusteeLLC' +
  ' RECORD OWNER(S): Belinda Spears TO: NOTICEOFHEARINGON FORECLOSURE OF DEED OFTRUST' +
  ' Belinda Spears Filing Fee: $300.00 YOU AREHEREBY NOTIFIED that theClerkof Superior' +
  ' Courtof MecklenburgCounty, North Carolina, shallconduct a hearingpursuant to' +
  ' NorthCarolinaGeneralStatutesSection45-21.16with respect totheforeclosureofcertainreal' +
  ' property as hereinaftersetforth.';

/** Caption of 26SP002242-590, the ALAW template. Different firm, same filing type. */
const ALAW_CAPTION =
  ' 26SP002242-590 STATEOFNORTHCAROLINA INTHE GENERALCOURTOFJUSTICE' +
  ' COUNTYOFMECKLENBURGSUPERIORCOURTDIVISION INTHEMATTEROFTHEFORECLOSUREOFADEEDOF' +
  ' TRUSTEXECUTED BYKENNETH OKAM AND LATOSHA OKAMDATEDDECEMBER 29, 2021ANDRECORDEDIN' +
  ' BOOK36923 AT PAGE 111INTHE MECKLENBURG COUNTY PUBLIC REGISTRY, NORTHCAROLINA' +
  ' NOTICEOFHEARINGONFORECLOSUREOFDEEDOFTRUST LatoshaRochelle Okam, Trustee';

/**
 * Body boilerplate every NC hearing notice carries. It names a sale and an
 * upset bid period without being either kind of document, which is why
 * classification reads the caption and not the whole file.
 */
const HEARING_BODY_BOILERPLATE =
  ' If you do not intend to contest the Holder allegations of default, you do not have to' +
  ' appear at the hearing and your failure to attend said hearing will affect neither your' +
  ' right to pay the indebtedness to prevent the proposed sale, nor your right to attend the' +
  ' actual sale. Notice of Sale will be served as required. The upset bid period runs ten' +
  ' days from the filing of the report of sale.';

describe('sha256Hex', () => {
  it('is stable for identical bytes and differs for different bytes', () => {
    expect(sha256Hex(Buffer.from('filing'))).toBe(sha256Hex(Buffer.from('filing')));
    expect(sha256Hex(Buffer.from('filing'))).not.toBe(sha256Hex(Buffer.from('filinh')));
    expect(sha256Hex(Buffer.from('filing'))).toHaveLength(64);
  });
});

describe('squash', () => {
  it('makes mashed and spaced captions identical', () => {
    expect(squash('NOTICEOFHEARINGON FORECLOSURE OF DEED OFTRUST')).toBe(
      squash('Notice of Hearing on Foreclosure of Deed of Trust'),
    );
  });

  it('strips punctuation and section marks left by the court OCR', () => {
    // The court's own OCR renders N.C.G.S. as N.C.G.8. and (ii) as (11).
    expect(squash('N.C.G.8.§45-101(1b)')).toBe('ncg8451011b');
  });

  it('returns empty string for null-ish input', () => {
    expect(squash('')).toBe('');
    expect(squash(undefined as any)).toBe('');
  });
});

describe('classifyDocumentType', () => {
  it('reads a hearing notice off the LOGS caption despite lost spaces', () => {
    expect(classifyDocumentType(LOGS_CAPTION)).toBe(ForeclosureDocumentType.NOTICE_OF_HEARING);
  });

  it('reads a hearing notice off the ALAW caption', () => {
    expect(classifyDocumentType(ALAW_CAPTION)).toBe(ForeclosureDocumentType.NOTICE_OF_HEARING);
  });

  it('is not fooled by sale and upset-bid language in the body', () => {
    // Both sampled templates mention each of these exactly once, far past the
    // caption. Scanning the whole document would misclassify every notice.
    expect(classifyDocumentType(LOGS_CAPTION + HEARING_BODY_BOILERPLATE)).toBe(
      ForeclosureDocumentType.NOTICE_OF_HEARING,
    );
  });

  it('classifies the other filing types from their captions', () => {
    expect(classifyDocumentType('NOTICE OF FORECLOSURE SALE')).toBe(
      ForeclosureDocumentType.NOTICE_OF_SALE,
    );
    expect(classifyDocumentType('NOTICEOFUPSETBID 26SP002244-590')).toBe(
      ForeclosureDocumentType.NOTICE_OF_UPSET_BID,
    );
    expect(classifyDocumentType('SUBSTITUTION OF TRUSTEE')).toBe(
      ForeclosureDocumentType.SUBSTITUTION_OF_TRUSTEE,
    );
    expect(classifyDocumentType('ORDER ALLOWING FORECLOSURE SALE')).toBe(
      ForeclosureDocumentType.ORDER_ALLOWING_SALE,
    );
    expect(classifyDocumentType('NOTICE OF CANCELLATION OF FORECLOSURE SALE')).toBe(
      ForeclosureDocumentType.CANCELLATION,
    );
  });

  it('prefers an order allowing sale over reading it as a notice of sale', () => {
    expect(classifyDocumentType('ORDER ALLOWING SALE AND NOTICE OF SALE')).toBe(
      ForeclosureDocumentType.ORDER_ALLOWING_SALE,
    );
  });

  it('returns OTHER rather than guessing', () => {
    expect(classifyDocumentType('CERTIFICATE OF SERVICE')).toBe(ForeclosureDocumentType.OTHER);
    expect(classifyDocumentType('')).toBe(ForeclosureDocumentType.OTHER);
  });
});

describe('caseNumberFrom', () => {
  it('reads the case number stamped at the top of each sampled filing', () => {
    expect(caseNumberFrom(LOGS_CAPTION)).toBe('26SP002244-590');
    expect(caseNumberFrom(ALAW_CAPTION)).toBe('26SP002242-590');
  });

  it('tolerates spacing introduced by the text layer', () => {
    expect(caseNumberFrom('26 SP 002244 - 590 STATE OF NORTH CAROLINA')).toBe('26SP002244-590');
  });

  it('accepts a case number with no county suffix', () => {
    expect(caseNumberFrom('25SP001234 IN THE GENERAL COURT OF JUSTICE')).toBe('25SP001234');
  });

  it('returns null when there is no case number', () => {
    expect(caseNumberFrom('STATE OF NORTH CAROLINA')).toBeNull();
    expect(caseNumberFrom('')).toBeNull();
  });
});

describe('normalizeCaseNumber', () => {
  it('canonicalises the forms a source might supply', () => {
    expect(normalizeCaseNumber('26SP002244-590')).toBe('26SP002244-590');
    expect(normalizeCaseNumber(' 26 sp 002244 - 590 ')).toBe('26SP002244-590');
    expect(normalizeCaseNumber('25SP001234')).toBe('25SP001234');
  });

  it('rejects anything that is not a case number, so it cannot key a case', () => {
    // These are the values that would silently collapse unrelated leads onto
    // one another if they were accepted as a dedupe key.
    for (const junk of ['', '   ', 'N/A', 'unknown', '590', 'SP', '2026', null, undefined]) {
      expect(normalizeCaseNumber(junk as any)).toBeNull();
    }
  });

  it('rejects a case number buried in surrounding prose', () => {
    // Free text goes through caseNumberFrom; this one is an exact-match guard.
    expect(normalizeCaseNumber('case no. 26SP002244-590 filed')).toBeNull();
  });
});

describe('isCaseNumberLike', () => {
  it('accepts real case numbers and rejects junk', () => {
    expect(isCaseNumberLike('26SP002244-590')).toBe(true);
    expect(isCaseNumberLike('')).toBe(false);
    expect(isCaseNumberLike('unknown')).toBe(false);
  });
});

describe('charsPerPageOf', () => {
  it('averages text length over pages', () => {
    expect(charsPerPageOf('x'.repeat(12884), 7)).toBeCloseTo(1840.6, 1);
  });

  it('returns null when the page count is unusable', () => {
    expect(charsPerPageOf('x'.repeat(100), 0)).toBeNull();
    expect(charsPerPageOf('x'.repeat(100), null)).toBeNull();
  });
});

describe('isTextLayerThin', () => {
  it('passes the three sampled filings, which run 1841-2415 chars per page', () => {
    expect(isTextLayerThin('x'.repeat(12884), 7)).toBe(false); // 26SP002244-590
    expect(isTextLayerThin('x'.repeat(12988), 7)).toBe(false); // 26SP002243-590
    expect(isTextLayerThin('x'.repeat(12075), 5)).toBe(false); // 26SP002242-590
  });

  it('flags an image-only PDF', () => {
    expect(isTextLayerThin('', 7)).toBe(true);
    expect(isTextLayerThin('x'.repeat(200), 7)).toBe(true);
  });

  it('treats the threshold as exclusive', () => {
    expect(isTextLayerThin('x'.repeat(THIN_TEXT_CHARS_PER_PAGE), 1)).toBe(false);
    expect(isTextLayerThin('x'.repeat(THIN_TEXT_CHARS_PER_PAGE - 1), 1)).toBe(true);
  });

  it('falls back to total length when the page count is unknown', () => {
    expect(isTextLayerThin('x'.repeat(5000), null)).toBe(false);
    expect(isTextLayerThin('x'.repeat(50), null)).toBe(true);
  });

  it('does not count whitespace as text', () => {
    expect(isTextLayerThin('   \n  \n ', 1)).toBe(true);
  });
});

describe('extractionMethodOf', () => {
  it('reports the text layer for a readable filing', () => {
    expect(extractionMethodOf('x'.repeat(12884), 7)).toBe(ForeclosureExtractionMethod.TEXT_LAYER);
  });

  it('reports none for an image-only filing, so the OCR gap stays measurable', () => {
    expect(extractionMethodOf('', 7)).toBe(ForeclosureExtractionMethod.NONE);
  });
});

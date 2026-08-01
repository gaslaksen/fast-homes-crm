import * as XLSX from 'xlsx';
import { ForeclosureImportService } from './foreclosure-import.service';
import { ForeclosuresService } from './foreclosures.service';
import { ForeclosureLeadInput } from './foreclosure.types';

function sheetBuffer(rows: any[][]): Buffer {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'Sheet1');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

/** Import the sheet and hand back the normalized inputs the service produced. */
async function importRows(rows: any[][]): Promise<ForeclosureLeadInput[]> {
  const captured: ForeclosureLeadInput[] = [];
  const foreclosures = {
    createForeclosureLead: jest.fn(async (input: ForeclosureLeadInput) => {
      captured.push(input);
      return { leadId: 'lead-1', created: true };
    }),
  } as unknown as ForeclosuresService;

  const service = new ForeclosureImportService(foreclosures);
  await service.executeImport(sheetBuffer(rows), { organizationId: 'org-1' });
  return captured;
}

// Headers exactly as the purchased Mecklenburg/Union list ships them.
const VENDOR_HEADERS = [
  'S No', 'County Name', 'State', 'Owner Full Name', 'Owner Last Name',
  'Owner First Name', 'Owner Middle Name', 'Owner Suffix', 'List Type',
  'Property Address', 'Property City', 'Property State', 'Property Zipcode',
  'Mailing Address', 'Mailing City', 'Mailing State', 'Mailing Zipcode',
  'Parcel ID', 'Total Assessment', 'Property Type', 'Bathrooms', 'Bedrooms',
  'Square Footage', 'Year Built', 'Date Of Auctions', 'primary_phone',
  'primary_phone_type', 'Email-1', 'Email-2', 'Email-3', 'Email-4', 'Email-5',
  'Mobile-1', 'Mobile-2', 'Mobile-3', 'Mobile-4', 'Mobile-5',
  'Landline-1', 'Landline-2', 'Landline-3',
];

const VENDOR_ROW = [
  '1', 'MECKLENBURG', 'NC', 'Campbell Patricia', 'Campbell', 'Patricia', '', '',
  'Foreclosures', '5125 Birchbark Ln', 'Charlotte', 'NC', '28227',
  '5125 Birchbark Ln', 'Charlotte', 'NC', '28227', '13507202', '333880',
  'Single Family', '2', '3', '1672', '1976', '08/25/2026', '7042819871',
  'Mobile', 'one@example.com', 'two@example.com', 'three@example.com', '', '',
  '8287740223', '7042991940', '', '', '', '7045372739', '7045699347', '',
];

describe('ForeclosureImportService - purchased list format', () => {
  it('maps the vendor headers onto the tracker fields', async () => {
    const [input] = await importRows([VENDOR_HEADERS, VENDOR_ROW]);

    expect(input.address).toBe('5125 Birchbark Ln');
    expect(input.city).toBe('Charlotte');
    expect(input.state).toBe('NC');
    expect(input.zip).toBe('28227');
    expect(input.county).toBe('MECKLENBURG');
    expect(input.mailingAddress).toBe('5125 Birchbark Ln');
    expect(input.mailCity).toBe('Charlotte');
    expect(input.mailState).toBe('NC');
    expect(input.mailZip).toBe('28227');
    expect(input.assessedValue).toBe(333880);
    expect(input.saleDate).toBe('08/25/2026');
    expect(input.noticeType).toBe('mortgage_foreclosure');
    expect(input.parcelId).toBe('13507202');
    expect(input.propertyType).toBe('Single Family');
    expect(input.bedrooms).toBe(3);
    expect(input.bathrooms).toBe(2);
    expect(input.sqft).toBe(1672);
    expect(input.yearBuilt).toBe(1976);
  });

  it('takes the split owner columns rather than the last-first full name', async () => {
    const [input] = await importRows([VENDOR_HEADERS, VENDOR_ROW]);

    expect(input.ownerFirstName).toBe('Patricia');
    expect(input.ownerLastName).toBe('Campbell');
  });

  it('fills the four phone slots primary, then mobiles, then landlines', async () => {
    const [input] = await importRows([VENDOR_HEADERS, VENDOR_ROW]);

    expect([input.phone1, input.phone2, input.phone3, input.phone4]).toEqual([
      '7042819871', '8287740223', '7042991940', '7045372739',
    ]);
    expect([input.phone1Type, input.phone2Type, input.phone3Type, input.phone4Type]).toEqual([
      'Mobile', 'Mobile', 'Mobile', 'Landline',
    ]);
  });

  it('keeps the first two emails and drops the rest', async () => {
    const [input] = await importRows([VENDOR_HEADERS, VENDOR_ROW]);

    expect(input.email).toBe('one@example.com');
    expect(input.email2).toBe('two@example.com');
  });

  it('dedupes a number that appears as both the primary and a landline', async () => {
    const row = [...VENDOR_ROW];
    row[25] = '7045372739'; // primary_phone, also Landline-1
    row[26] = 'Landline';
    const [input] = await importRows([VENDOR_HEADERS, row]);

    expect([input.phone1, input.phone2, input.phone3, input.phone4]).toEqual([
      '7045372739', '8287740223', '7042991940', '7045699347',
    ]);
  });

  it('reports the repeat columns as recognized in the preview', () => {
    const service = new ForeclosureImportService({} as ForeclosuresService);
    const { recognized } = service.parseUpload(sheetBuffer([VENDOR_HEADERS, VENDOR_ROW]));

    expect(recognized).toEqual(
      expect.arrayContaining(['Mobile-1', 'Landline-3', 'Email-5', 'Date Of Auctions', 'Parcel ID']),
    );
    expect(recognized).not.toContain('S No');
  });
});

describe('ForeclosureImportService - tracker format', () => {
  it('still imports the offline tracker headers unchanged', async () => {
    const [input] = await importRows([
      ['Property Address', 'City', 'Zip', 'Owner Names', 'Case Number', 'Sale Date',
       'Assessed Value', 'Potential Equity', 'Owner Occupied', 'Phone1', 'Phone2', 'Email'],
      ['900 Main St', 'Matthews', '28105', 'Doe John', '24 SP 1234', '2026-09-01',
       '250000', '42%', 'Y', '704-555-0101', '(704) 555-0102', 'john@example.com'],
    ]);

    expect(input.address).toBe('900 Main St');
    expect(input.city).toBe('Matthews');
    expect(input.ownerNames).toBe('Doe John');
    expect(input.caseNumber).toBe('24 SP 1234');
    expect(input.equityPct).toBe(42);
    expect(input.ownerOccupied).toBe('Y');
    expect(input.phone1).toBe('7045550101');
    expect(input.phone2).toBe('7045550102');
    expect(input.phone3).toBeUndefined();
    expect(input.email).toBe('john@example.com');
    expect(input.email2).toBeUndefined();
  });
});

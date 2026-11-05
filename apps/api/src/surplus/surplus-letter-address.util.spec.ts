import { letterAddress } from './surplus-letter-address.util';

describe('letterAddress', () => {
  it.each([
    ['1313 TORGERSON RD SE, PALM BAY, FL 32909', '1313 Torgerson Rd SE, Palm Bay, FL 32909'],
    ['1313 TORGERSON RD, PALM BAY', '1313 Torgerson Rd, Palm Bay'],
    ['1633 E HENNIKER CT, INVERNESS, FL', '1633 E Henniker Ct, Inverness, FL'],
    ['1260 N ELLIS ST, Bensenville, IL 60106', '1260 N Ellis St, Bensenville, IL 60106'],
    ['7901 4TH ST N, SUITE 300, ST. PETERSBURG, FL 33702', '7901 4th St N, Suite 300, St. Petersburg, FL 33702'],
    ['12 OAK STREET APT 4B, TAMPA, FL 33602-1234', '12 Oak St Apt 4B, Tampa, FL 33602-1234'],
    ['450 MCDONALD AVENUE, FT MYERS, FL 33901', '450 McDonald Ave, Ft Myers, FL 33901'],
    ['P.O. BOX 123, OCALA, FL 34470', 'PO Box 123, Ocala, FL 34470'],
    ['2200 US HWY 19 N, HOLIDAY, FL 34691', '2200 US Hwy 19 N, Holiday, FL 34691'],
    ['100 PONCE DE LEON BOULEVARD, CORAL GABLES, FL 33134', '100 Ponce de Leon Blvd, Coral Gables, FL 33134'],
    ['55 LAKE OF THE WOODS DRIVE, LEESBURG, FL 34788', '55 Lake of the Woods Dr, Leesburg, FL 34788'],
    ['AVENIDA 15 #127-B-33 APT 1705, BOGOTA, COLOMBIA', 'Avenida 15 #127-B-33 Apt 1705, Bogota, Colombia'],
    ['9 O\'BRIEN CIRCLE, WILMINGTON, DE 19801', "9 O'Brien Cir, Wilmington, DE 19801"],
    ['100 COURT, OCALA, FL', '100 Court, Ocala, FL'],
    ['1 Main St', '1 Main St'],
  ])('%s', (input, expected) => {
    expect(letterAddress(input)).toBe(expected);
  });

  it('is empty for nothing', () => {
    expect(letterAddress(null)).toBe('');
    expect(letterAddress('  ')).toBe('');
  });
});

import {
  blankish,
  cellText,
  probateUidOf,
  normalizeCaseNumber,
  normalizeZip,
  parseListDate,
  isoToDate,
  parseNum,
  normalizePhoneDigits,
  phoneTypeOf,
  tierNumberOf,
  parseWhyThisLead,
  parseDeceasedName,
  contactKeyOf,
} from './probate.util';

describe('blankish / cellText', () => {
  it('treats the list\'s empty markers as empty', () => {
    expect(blankish('—')).toBe(true);
    expect(blankish('–')).toBe(true);
    expect(blankish('-')).toBe(true);
    expect(blankish('  ')).toBe(true);
    expect(blankish('N/A')).toBe(true);
    expect(blankish(null)).toBe(true);
    expect(blankish('Charlotte')).toBe(false);
  });

  it('trims and folds empty markers to an empty string', () => {
    expect(cellText('  Charlotte ')).toBe('Charlotte');
    expect(cellText('—')).toBe('');
  });
});

describe('probateUidOf', () => {
  it('keys on case AND address so one estate can hold many properties', () => {
    const a = probateUidOf({ caseNumber: '26E000800-590', address: '920 E 36Th St' });
    const b = probateUidOf({ caseNumber: '26E000800-590', address: '4115 Dunwoody Dr' });
    expect(a).not.toEqual(b);
  });

  it('is stable across case-number spacing and address casing', () => {
    expect(probateUidOf({ caseNumber: '26E 000800-590', address: '920 e 36th st' })).toEqual(
      probateUidOf({ caseNumber: '26e000800-590', address: '920 E 36Th St' }),
    );
  });

  it('still keys on the address when a row carries no case number', () => {
    expect(probateUidOf({ address: '920 E 36Th St' })).toBe('|920_E_36TH_ST');
    expect(probateUidOf({})).toBe('');
  });
});

describe('normalizeCaseNumber', () => {
  it('upper-cases and strips whitespace', () => {
    expect(normalizeCaseNumber(' 26e000342-890 ')).toBe('26E000342-890');
    expect(normalizeCaseNumber(null)).toBe('');
  });
});

describe('normalizeZip', () => {
  it('pads a zip the sheet stored as a number', () => {
    expect(normalizeZip(28173)).toBe('28173');
    expect(normalizeZip(7302)).toBe('07302');
    expect(normalizeZip('28205-1234')).toBe('28205');
    expect(normalizeZip('')).toBe('');
  });
});

describe('parseListDate / isoToDate', () => {
  it('parses the list\'s "Mar 24, 2026" spelling', () => {
    expect(parseListDate('Mar 24, 2026')).toBe('2026-03-24');
    expect(parseListDate('December 15 2025')).toBe('2025-12-15');
    expect(parseListDate('Jul 09, 2026')).toBe('2026-07-09');
  });

  it('returns empty for anything that is not a date', () => {
    expect(parseListDate('sometime last spring')).toBe('');
    expect(parseListDate(null)).toBe('');
  });

  it('converts to a local-midnight Date, or null', () => {
    const d = isoToDate('2026-03-24')!;
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(2);
    expect(d.getDate()).toBe(24);
    expect(isoToDate('')).toBeNull();
  });
});

describe('parseNum', () => {
  it('strips currency and separators', () => {
    expect(parseNum('$477,600')).toBe(477600);
    expect(parseNum('4.5')).toBe(4.5);
    expect(parseNum('—')).toBeNull();
    expect(parseNum('')).toBeNull();
    expect(parseNum(null)).toBeNull();
  });
});

describe('normalizePhoneDigits / phoneTypeOf', () => {
  it('takes the last ten digits', () => {
    expect(normalizePhoneDigits('(704) 651-4821')).toBe('7046514821');
    expect(normalizePhoneDigits('+1 704 651 4821')).toBe('7046514821');
    expect(normalizePhoneDigits('704-651')).toBeNull();
    expect(normalizePhoneDigits('—')).toBeNull();
  });

  it('reads the line type', () => {
    expect(phoneTypeOf('Mobile')).toBe('Mobile');
    expect(phoneTypeOf('Landline')).toBe('Landline');
    expect(phoneTypeOf('VOIP')).toBeNull();
  });
});

describe('tierNumberOf', () => {
  it('reads every spelling these lists use', () => {
    expect(tierNumberOf('Tier 1 - Attack First')).toBe(1);
    expect(tierNumberOf('Tier 2')).toBe(2);
    expect(tierNumberOf('3')).toBe(3);
    expect(tierNumberOf('')).toBeNull();
    expect(tierNumberOf('Attack First')).toBeNull();
  });
});

describe('parseWhyThisLead', () => {
  it('pulls case, filing date and heir city out of the sentence', () => {
    expect(
      parseWhyThisLead(
        'Probate case 26E000342-890 filed Mar 24, 2026 — heir/petitioner lives in Monroe, not at the property',
      ),
    ).toEqual({ caseNumber: '26E000342-890', filedDate: '2026-03-24', heirCity: 'Monroe' });
  });

  it('handles a two-word heir city', () => {
    expect(
      parseWhyThisLead(
        'Probate case 26E002562-590 filed Jul 09, 2026 — heir/petitioner lives in Grosse Point, not at the property',
      ).heirCity,
    ).toBe('Grosse Point');
  });

  it('leaves heirCity empty on a non-absentee row without failing the rest', () => {
    const parsed = parseWhyThisLead('Probate case 26E001002-590 filed Mar 19, 2026');
    expect(parsed.caseNumber).toBe('26E001002-590');
    expect(parsed.filedDate).toBe('2026-03-19');
    expect(parsed.heirCity).toBe('');
  });

  it('returns empties for text with nothing in it', () => {
    expect(parseWhyThisLead('')).toEqual({ caseNumber: '', filedDate: '', heirCity: '' });
  });
});

describe('parseDeceasedName', () => {
  it('drops the label', () => {
    expect(parseDeceasedName('Deceased owner: Albert Joseph Starnes')).toBe('Albert Joseph Starnes');
    expect(parseDeceasedName('Deceased: Betty B Kaba')).toBe('Betty B Kaba');
  });

  it('passes through a bare name and an empty cell', () => {
    expect(parseDeceasedName('Betty B Kaba')).toBe('Betty B Kaba');
    expect(parseDeceasedName('—')).toBe('');
  });
});

describe('contactKeyOf', () => {
  it('groups on the phone, whatever format it arrived in', () => {
    expect(contactKeyOf({ phone: '(704) 400-2575' })).toBe('p:7044002575');
    expect(contactKeyOf({ phone: '+17044002575' })).toBe('p:7044002575');
  });

  it('falls back to the email only when there is no phone', () => {
    expect(contactKeyOf({ phone: '', email: 'A@B.com' })).toBe('e:a@b.com');
    expect(contactKeyOf({ phone: '7044002575', email: 'a@b.com' })).toBe('p:7044002575');
    expect(contactKeyOf({})).toBe('');
  });
});

import { brandForNumber, businessNameForLead } from './company.constants';

describe('brandForNumber', () => {
  it('knows the D.I.G. Deeper line in any spelling', () => {
    expect(brandForNumber('+19045959620').key).toBe('digdeeper');
    expect(brandForNumber('(904) 595-9620').key).toBe('digdeeper');
  });

  it('treats every other number as Quick Cash', () => {
    expect(brandForNumber('+18885748121').key).toBe('qchb');
    expect(brandForNumber('+17045299523').key).toBe('qchb');
    expect(brandForNumber('').key).toBe('qchb');
  });
});

describe('businessNameForLead', () => {
  it('always names D.I.G. Deeper to a surplus lead, whatever the org is called', () => {
    expect(businessNameForLead('SURPLUS', 'Quick Cash Home Buyers')).toBe('D.I.G. Deeper LLC');
  });

  it('keeps the org name, then Quick Cash, for everyone else', () => {
    expect(businessNameForLead('MANUAL', 'Acme Homes')).toBe('Acme Homes');
    expect(businessNameForLead('MANUAL', null)).toBe('Quick Cash Home Buyers');
    expect(businessNameForLead(null, '  ', 'Fallback Co')).toBe('Fallback Co');
  });
});

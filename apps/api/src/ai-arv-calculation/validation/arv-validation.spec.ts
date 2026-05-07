import {
  parseValidationFile,
  parseRangeFromLine,
} from './arv-validation.service';

describe('parseRangeFromLine', () => {
  it('parses ranges with dashes and dollar signs', () => {
    expect(parseRangeFromLine('$45,000-55,000')).toEqual({ low: 45000, high: 55000 });
    expect(parseRangeFromLine('~$15,000–18,000')).toEqual({ low: 15000, high: 18000 });
    expect(parseRangeFromLine('$155k - $200k')).toEqual({ low: 155000, high: 200000 });
  });

  it('parses single values as ±5% range', () => {
    const r = parseRangeFromLine('$218,000');
    expect(r).not.toBeNull();
    expect(r!.low).toBeCloseTo(218000 * 0.95, 0);
    expect(r!.high).toBeCloseTo(218000 * 1.05, 0);
  });

  it('returns null for empty', () => {
    expect(parseRangeFromLine(null)).toBeNull();
    expect(parseRangeFromLine('')).toBeNull();
  });
});

describe('parseValidationFile', () => {
  const sample = `# ARV Validation Set

## Property 001

### Identification
- **Address:** 1209 N 3rd Street, Wichita Falls, TX 76306
- **Lead ID in Dealcore:** abc-123
- **Category:** Rural / Thin-data market

### Geoff's Judged ARV
- **As-is value:** ~$15,000–18,000
- **Full-rehab ARV:** ~$45,000–55,000
- **Confidence:** Medium-Low

### Reasoning
Small old distressed property.
`;

  it('parses a complete entry', () => {
    const entries = parseValidationFile(sample);
    expect(entries).toHaveLength(1);
    const e = entries[0];
    expect(e.propertyKey).toBe('Property 001');
    expect(e.address).toBe('1209 N 3rd Street, Wichita Falls, TX 76306');
    expect(e.leadId).toBe('abc-123');
    expect(e.judgedAsIs).toEqual({ low: 15000, high: 18000 });
    expect(e.judgedRenovated).toEqual({ low: 45000, high: 55000 });
    expect(e.judgedConfidence).toBe('Medium-Low');
    expect(e.reasoning).toMatch(/distressed/);
  });

  it('skips entries with placeholder addresses', () => {
    const placeholder = `## Property 002

### Identification
- **Address:** [address]
`;
    expect(parseValidationFile(placeholder)).toEqual([]);
  });
});

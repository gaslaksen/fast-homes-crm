import { SurplusTemplateKind } from '@fast-homes/shared';
import { resolveKind, canonicalCounty, COUNTY_DEFAULTS, renderTemplate, unfilledFields, MERGE_FIELDS, TemplateRowLike } from './surplus-templates.service';
import { NOTARY_COVER, DIRECTION_TO_PAY, LIMITED_POA } from './surplus-notary-package';

/**
 * Which text a kind resolves to for a county, and what the built-in scripts
 * and the notary package carry. The rule under test is "most specific
 * wins": a county's saved version, then its built-in, then the general
 * saved version, then the general built-in.
 */
const row = (over: Partial<TemplateRowLike> & { kind: string }): TemplateRowLike => ({
  county: null,
  version: 1,
  active: true,
  name: null,
  subject: null,
  body: `body of ${over.kind} ${over.county || 'all'} v${over.version || 1}`,
  ...over,
});

describe('resolveKind', () => {
  const notary = SurplusTemplateKind.NOTARY_INSTRUCTIONS;
  const phone = SurplusTemplateKind.PHONE_SCRIPT;

  it('gives a county its own saved version first', () => {
    const rows = [row({ kind: notary, county: 'Lee', version: 2 }), row({ kind: notary, version: 5 })];
    const r = resolveKind(notary, rows, 'Lee');
    expect(r.scope).toBe('county');
    expect(r.version).toBe(2);
    expect(r.body).toBe('body of notary_instructions Lee v2');
    expect(r.generalVersionShadowed).toBe(true);
  });

  it('then the county built-in, over a general saved version', () => {
    const rows = [row({ kind: notary, version: 5 })];
    const r = resolveKind(notary, rows, 'Duval');
    expect(r.scope).toBe('county_builtin');
    expect(r.version).toBe(0);
    expect(r.body).toBe(NOTARY_COVER.Duval);
    expect(r.generalVersionShadowed).toBe(true);
  });

  it('then the general saved version, for a kind with no county text', () => {
    const rows = [row({ kind: phone, version: 3 })];
    const r = resolveKind(phone, rows, 'Lee');
    expect(r.scope).toBe('all');
    expect(r.version).toBe(3);
    expect(r.generalVersionShadowed).toBe(false);
  });

  it('and the general built-in last', () => {
    const r = resolveKind(phone, [], 'Lee');
    expect(r.scope).toBe('builtin');
    expect(r.version).toBe(0);
    expect(r.body).toContain('{{companyShortName}}');
  });

  it('ignores an inactive county version and another county\'s versions', () => {
    const rows = [
      row({ kind: notary, county: 'Lee', version: 1, active: false }),
      row({ kind: notary, county: 'Duval', version: 1 }),
    ];
    const r = resolveKind(notary, rows, 'Lee');
    expect(r.scope).toBe('county_builtin');
    expect(r.body).toBe(NOTARY_COVER.Lee);
    // The count is this county's versions only, active or not.
    expect(r.versionCount).toBe(1);
  });

  it('matches the county name regardless of case', () => {
    const rows = [row({ kind: notary, county: 'lee', version: 1 })];
    expect(resolveKind(notary, rows, 'LEE').scope).toBe('county');
    expect(canonicalCounty('lee')).toBe('Lee');
    expect(canonicalCounty('  duval ')).toBe('Duval');
    expect(canonicalCounty('Polk')).toBe('Polk');
    expect(canonicalCounty('')).toBeNull();
  });

  it('with no county resolves to the general text and never a county built-in', () => {
    const r = resolveKind(notary, [], null);
    expect(r.scope).toBe('builtin');
    expect(r.body).toBe(NOTARY_COVER.general);
  });
});

describe('the built-in scripts and the notary package', () => {
  const known = new Set(MERGE_FIELDS.map((f) => f.key));
  const fieldsIn = (body: string) => unfilledFields(body);

  it('use only documented merge fields', () => {
    const bodies = [
      resolveKind(SurplusTemplateKind.PHONE_SCRIPT, [], null).body,
      resolveKind(SurplusTemplateKind.VOICEMAIL, [], null).body,
      NOTARY_COVER.general,
      NOTARY_COVER.Duval,
      NOTARY_COVER.Lee,
      LIMITED_POA,
      DIRECTION_TO_PAY.general,
      DIRECTION_TO_PAY.Duval,
      DIRECTION_TO_PAY.Lee,
    ];
    for (const b of bodies) for (const f of fieldsIn(b)) expect(known.has(f)).toBe(true);
  });

  it('the phone script and voicemail carry the revised wording with the brand filled by field', () => {
    const phone = resolveKind(SurplusTemplateKind.PHONE_SCRIPT, [], null).body;
    const vm = resolveKind(SurplusTemplateKind.VOICEMAIL, [], null).body;
    expect(phone).toContain('has anyone already reached out to help you recover it?');
    expect(phone).toContain('{{surplusAmount}} that belongs to you');
    expect(phone).toContain('Never disclose the fund source before the fee agreement is signed.');
    expect(vm).toContain('I found a good chunk of money');
    expect(vm).toContain('ask for {{callerName}}');
    // Nothing spoken is typed in: the name, number and site are fields.
    for (const b of [phone, vm]) {
      expect(b).not.toMatch(/Ian\\b/);
      expect(b).not.toContain('904');
      expect(b).not.toContain('digdeeperllc.com');
    }
    const filled = renderTemplate(vm, {
      claimantFirstName: 'Myrtis',
      callerName: 'Ian',
      companyShortName: 'D.I.G. Deeper',
      website: 'digdeeperllc.com',
      callbackNumber: '(904) 595-9620',
    });
    expect(unfilledFields(filled)).toEqual([]);
    expect(filled).toContain('my name is Ian with the company D.I.G. Deeper');
  });

  it('the Lee package says two witnesses and the Duval one does not', () => {
    expect(NOTARY_COVER.Lee).toContain('two witnesses');
    expect(NOTARY_COVER.Lee).toContain('Affidavit of Claim for Tax Deed Sale Surplus Funds');
    expect(NOTARY_COVER.Duval).not.toContain('two witnesses');
    expect(NOTARY_COVER.Duval).toContain('Statement of Claim to Surplus Funds from Tax Deed Sale');
    expect(DIRECTION_TO_PAY.Lee).toContain('STRAP #: {{parcelId}}');
    expect(DIRECTION_TO_PAY.Duval).toContain('Clerk Tax Deed File #: {{caseNumber}}');
    expect(COUNTY_DEFAULTS[SurplusTemplateKind.NOTARY_INSTRUCTIONS]?.Lee?.body).toBe(NOTARY_COVER.Lee);
  });

  it('keeps the draft caveat on every cover', () => {
    for (const b of [NOTARY_COVER.general, NOTARY_COVER.Duval, NOTARY_COVER.Lee]) {
      expect(b).toContain('has not been reviewed by a Florida licensed attorney');
    }
  });

  it('has no dashes anywhere', () => {
    const all = [
      resolveKind(SurplusTemplateKind.PHONE_SCRIPT, [], null).body,
      resolveKind(SurplusTemplateKind.VOICEMAIL, [], null).body,
      NOTARY_COVER.general,
      NOTARY_COVER.Duval,
      NOTARY_COVER.Lee,
      LIMITED_POA,
      DIRECTION_TO_PAY.general,
      DIRECTION_TO_PAY.Duval,
      DIRECTION_TO_PAY.Lee,
    ].join('\n');
    expect(/[–—]/.test(all)).toBe(false);
  });
});

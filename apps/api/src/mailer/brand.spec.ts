import { MailerService } from './mailer.service';
import {
  DIG_DEEPER_BRAND,
  QCHB_BRAND,
  brandForLeadSource,
} from '../common/company.constants';

/**
 * The brand rules are the part of the mailer a seller actually sees. Getting
 * them wrong does not throw: it quietly sends one company's copy from another
 * company's domain, which is exactly the failure these cover.
 */

const makeService = (env: Record<string, string>) =>
  new MailerService(
    { get: (k: string) => env[k] } as any,
    {} as any,
  );

describe('brandForLeadSource', () => {
  it('routes surplus-funds leads to Dig Deeper', () => {
    expect(brandForLeadSource('SURPLUS')).toBe(DIG_DEEPER_BRAND);
  });

  it('leaves every other pipeline on the default brand', () => {
    for (const source of ['PROBATE', 'FORECLOSURE', 'TAX_SALE', 'manual', '', null, undefined]) {
      expect(brandForLeadSource(source)).toBe(QCHB_BRAND);
    }
  });
});

describe('brandConfig', () => {
  const configured = {
    MAILGUN_DOMAIN: 'crm.quickcashhomebuyers.com',
    MAILGUN_DIGDEEPER_DOMAIN: 'crm.digdeeperllc.com',
    EMAIL_DEALS_FROM: 'deals@quickcashhomebuyers.com',
    EMAIL_DIGDEEPER_FROM: 'deals@digdeeperllc.com',
  };

  it('sends Dig Deeper from its own domain and address once configured', () => {
    const svc: any = makeService(configured);
    const identity = svc.brandConfig(DIG_DEEPER_BRAND);

    expect(identity.brand).toBe(DIG_DEEPER_BRAND);
    expect(identity.domain).toBe('crm.digdeeperllc.com');
    expect(identity.dealsAddress).toBe('deals@digdeeperllc.com');
  });

  it('falls back to the default brand entirely when the domain is not set yet', () => {
    // The dangerous near-miss is keeping the Dig Deeper signature while
    // sending through the Quick Cash domain. Brand and domain must move
    // together or not at all.
    const svc: any = makeService({ ...configured, MAILGUN_DIGDEEPER_DOMAIN: '' });
    const identity = svc.brandConfig(DIG_DEEPER_BRAND);

    expect(identity.brand).toBe(QCHB_BRAND);
    expect(identity.domain).toBe('crm.quickcashhomebuyers.com');
    expect(identity.dealsAddress).toBe('deals@quickcashhomebuyers.com');
  });
});

describe('wrapEmailBody', () => {
  it('signs with the default brand when no brand is passed', () => {
    const svc = makeService({});
    const { bodyText, bodyHtml } = svc.wrapEmailBody('Hi there');

    expect(bodyText).toContain(QCHB_BRAND.companyName);
    expect(bodyText).toContain(QCHB_BRAND.phone);
    expect(bodyHtml).toContain(QCHB_BRAND.website);
  });

  it('signs with Dig Deeper and omits the website line it does not have', () => {
    const svc = makeService({});
    const { bodyText, bodyHtml } = svc.wrapEmailBody('Hi there', undefined, DIG_DEEPER_BRAND);

    expect(bodyText).toContain('Dig Deeper LLC');
    expect(bodyText).toContain('(904) 595-9620');
    expect(bodyText).not.toContain(QCHB_BRAND.companyName);
    expect(bodyHtml).toContain('tel:+19045959620');
    expect(bodyHtml).not.toContain(QCHB_BRAND.websiteUrl);
    // No empty anchor left behind by the missing website.
    expect(bodyHtml).not.toContain('href="undefined"');
  });
});

describe('userSendIdentity', () => {
  const configured = {
    MAILGUN_DOMAIN: 'crm.quickcashhomebuyers.com',
    MAILGUN_DIGDEEPER_DOMAIN: 'crm.digdeeperllc.com',
    EMAIL_DIGDEEPER_FROM: 'deals@digdeeperllc.com',
  };

  it('keeps the user on their own address for the default brand', () => {
    const svc = makeService(configured);
    const out = svc.userSendIdentity(QCHB_BRAND, 'ian@quickcashhomebuyers.com');

    expect(out.fromAddress).toBe('ian@quickcashhomebuyers.com');
    expect(out.replyTo).toBe('ian@crm.quickcashhomebuyers.com');
    expect(out.brandName).toBe(QCHB_BRAND.companyName);
  });

  it("substitutes the brand's deals address where the user has no mailbox", () => {
    const svc = makeService(configured);
    const out = svc.userSendIdentity(DIG_DEEPER_BRAND, 'ian@quickcashhomebuyers.com');

    expect(out.fromAddress).toBe('deals@digdeeperllc.com');
    expect(out.replyTo).toBe('deals@crm.digdeeperllc.com');
    expect(out.brandName).toBe('Dig Deeper LLC');
  });

  it('previews the fallback, not the brand, when the domain is not live', () => {
    // The composer's "sending as" line reads this same method, so an
    // unconfigured brand must preview the address that would really be used.
    const svc = makeService({ ...configured, MAILGUN_DIGDEEPER_DOMAIN: '' });
    const out = svc.userSendIdentity(DIG_DEEPER_BRAND, 'ian@quickcashhomebuyers.com');

    expect(out.fromAddress).toBe('ian@quickcashhomebuyers.com');
    expect(out.brandName).toBe(QCHB_BRAND.companyName);
  });
});

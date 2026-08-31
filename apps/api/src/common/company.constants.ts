/**
 * Single source of truth for the company's public contact details.
 *
 * COMPANY_PHONE is the Twilio-backed main line. Anything a seller can see
 * (email signatures, the daily brief footer, the unsubscribe page) must use
 * this constant rather than a literal, so there is one place to change it.
 *
 * This is the display number. The per-message outbound "from" number is a
 * separate concern and comes from TWILIO_PHONE_NUMBER / the dialer's caller-ID
 * allowlist.
 */
export const COMPANY_NAME = 'Quick Cash Home Buyers';

/** Display form, e.g. for email signatures. */
export const COMPANY_PHONE = '(888) 574-8121';

/** E.164 form, for tel: links. */
export const COMPANY_PHONE_E164 = '+18885748121';

export const COMPANY_WEBSITE = 'www.quickcashhomebuyers.com';
export const COMPANY_WEBSITE_URL = 'https://www.quickcashhomebuyers.com';

// ─── Sending brands ─────────────────────────────────────────────────────────

/**
 * Which company a seller thinks they are talking to.
 *
 * Dealcore works more than one market under more than one LLC, and a seller
 * must never see the two mixed: a Dig Deeper first email followed by a Quick
 * Cash reply reads as a different company and kills the thread. So the brand
 * is resolved once, from the lead, and carried through the whole send.
 *
 * This describes the brand as a seller sees it. How a brand actually sends
 * (Mailgun domain, deals address) is config and lives in MailerService.
 */
export type BrandKey = 'qchb' | 'digdeeper';

export interface Brand {
  key: BrandKey;
  companyName: string;
  /** Display form for signatures. */
  phone: string;
  /** E.164 form, for tel: links. */
  phoneE164: string;
  /** Optional: a brand with no public site simply omits the line. */
  website?: string;
  websiteUrl?: string;
}

export const QCHB_BRAND: Brand = {
  key: 'qchb',
  companyName: COMPANY_NAME,
  phone: COMPANY_PHONE,
  phoneE164: COMPANY_PHONE_E164,
  website: COMPANY_WEBSITE,
  websiteUrl: COMPANY_WEBSITE_URL,
};

/**
 * The Florida surplus-funds brand. No website yet, so the signature carries
 * name and phone only. The phone is the Jacksonville Twilio number, which is
 * in the phone_numbers table as a sending number too.
 */
export const DIG_DEEPER_BRAND: Brand = {
  key: 'digdeeper',
  companyName: 'Dig Deeper LLC',
  phone: '(904) 595-9620',
  phoneE164: '+19045959620',
};

/** Everything that is not explicitly another brand is Quick Cash. */
export const DEFAULT_BRAND: Brand = QCHB_BRAND;

export const BRANDS: Record<BrandKey, Brand> = {
  qchb: QCHB_BRAND,
  digdeeper: DIG_DEEPER_BRAND,
};

/**
 * The single rule mapping a lead to a brand.
 *
 * Keep it here rather than at each send site: three separate call sites decide
 * a From address, and if they disagree a seller gets two companies in one
 * thread. Surplus-funds leads are Dig Deeper; everything else is Quick Cash.
 */
export function brandForLeadSource(source?: string | null): Brand {
  return source === 'SURPLUS' ? DIG_DEEPER_BRAND : DEFAULT_BRAND;
}

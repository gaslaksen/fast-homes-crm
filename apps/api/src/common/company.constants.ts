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

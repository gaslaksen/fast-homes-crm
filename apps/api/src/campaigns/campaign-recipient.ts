/**
 * Who a campaign email goes to.
 *
 * A lead's emails live in two places: Lead.sellerEmail, and a second address
 * on whichever detail row the lead came in with (surplus, probate, tax sale,
 * foreclosure). An enrollment may name one of them as its toEmail.
 */

/** Prisma select for everything knownEmails reads. */
export const LEAD_EMAILS_SELECT = {
  sellerEmail: true,
  surplusDetail: { select: { email2: true } },
  probateDetail: { select: { email2: true } },
  taxSaleDetail: { select: { email2: true } },
  foreclosureDetail: { select: { email2: true } },
} as const;

type LeadEmails = {
  sellerEmail?: string | null;
  surplusDetail?: { email2?: string | null } | null;
  probateDetail?: { email2?: string | null } | null;
  taxSaleDetail?: { email2?: string | null } | null;
  foreclosureDetail?: { email2?: string | null } | null;
};

/** Every email on the lead, primary first, without blanks or repeats. */
export function knownEmails(lead: LeadEmails | null | undefined): string[] {
  if (!lead) return [];
  const all = [
    lead.sellerEmail,
    lead.surplusDetail?.email2,
    lead.probateDetail?.email2,
    lead.taxSaleDetail?.email2,
    lead.foreclosureDetail?.email2,
  ];
  const out: string[] = [];
  for (const e of all) {
    const v = (e || '').trim();
    if (v && !out.some((o) => o.toLowerCase() === v.toLowerCase())) out.push(v);
  }
  return out;
}

/**
 * The chosen address while it is still on the lead, otherwise the primary.
 * A person who deletes an address from the lead has said not to use it, so a
 * stale toEmail never outlives the contact it named.
 */
export function campaignEmailFor(toEmail: string | null | undefined, emails: string[]): string | null {
  const chosen = (toEmail || '').trim().toLowerCase();
  if (chosen) {
    const match = emails.find((e) => e.toLowerCase() === chosen);
    if (match) return match;
  }
  return emails[0] || null;
}

/**
 * Everything a campaign needs from a person on a surplus case who is not the
 * claimant. Read fresh at send time, so a number or email removed since
 * enrollment is never used.
 */
export const HEIR_CONTACT_SELECT = {
  id: true,
  name: true,
  deceased: true,
  doNotCall: true,
  phone1: true,
  phone2: true,
  phone3: true,
  phone4: true,
  phone1Dnc: true,
  phone2Dnc: true,
  phone3Dnc: true,
  phone4Dnc: true,
  email1: true,
  email2: true,
  surplusDetail: { select: { leadId: true } },
} as const;

export type HeirContact = {
  id: string;
  name: string;
  deceased?: boolean | null;
  doNotCall?: boolean | null;
  phone1?: string | null;
  phone2?: string | null;
  phone3?: string | null;
  phone4?: string | null;
  phone1Dnc?: string | null;
  phone2Dnc?: string | null;
  phone3Dnc?: string | null;
  phone4Dnc?: string | null;
  email1?: string | null;
  email2?: string | null;
};

/** The person's emails, first first, without blanks or repeats. */
export function heirEmails(heir: HeirContact | null | undefined): string[] {
  if (!heir) return [];
  const out: string[] = [];
  for (const e of [heir.email1, heir.email2]) {
    const v = (e || '').trim();
    if (v && !out.some((o) => o.toLowerCase() === v.toLowerCase())) out.push(v);
  }
  return out;
}

/**
 * The number a campaign texts this person on: their first number that carries
 * no do-not-call flag. A flagged number is skipped rather than refused, so a
 * son with a registry hit on one line and a clean mobile is still reachable.
 */
export function heirTextNumber(heir: HeirContact | null | undefined): string | null {
  if (!heir) return null;
  for (const i of [1, 2, 3, 4] as const) {
    const num = (heir[`phone${i}`] || '').trim();
    if (num && !heir[`phone${i}Dnc`]) return num;
  }
  return null;
}

/**
 * Why a campaign must not message this person, or null when it may. A dead
 * heir's share needs its own estate, and do not call is a person's own word.
 */
export function heirBlockedReason(heir: HeirContact): string | null {
  if (heir.deceased) return `${heir.name} is marked deceased`;
  if (heir.doNotCall) return `${heir.name} is marked do not call`;
  return null;
}

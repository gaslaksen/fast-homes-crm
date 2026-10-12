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

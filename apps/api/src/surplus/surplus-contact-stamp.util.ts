import { numberKey } from '../phone-numbers/phone-numbers.service';

/**
 * When a contact last GAINED a phone number or email.
 *
 * The board sorts on this so the team can see who has new numbers nobody has
 * used yet. That only works if the stamp means "something new arrived", not
 * "the row was saved": a trace re-run that returns the same numbers in a
 * different order, making phone 3 the primary, removing a dead number or
 * flagging one as bad all rewrite the columns and none of them is news.
 *
 * So the rule is a set comparison. Phones compare on their last 10 digits and
 * emails without case, and the stamp moves only when the after set holds a
 * value the before set did not. A number replaced by a different one counts,
 * because the replacement is new.
 */
export interface ContactSet {
  phones: (string | null | undefined)[];
  emails: (string | null | undefined)[];
}

export const NO_CONTACTS: ContactSet = { phones: [], emails: [] };

function phoneKeys(v: ContactSet['phones']): Set<string> {
  return new Set((v || []).map((p) => numberKey(String(p || ''))).filter(Boolean));
}

function emailKeys(v: ContactSet['emails']): Set<string> {
  return new Set((v || []).map((e) => String(e || '').trim().toLowerCase()).filter(Boolean));
}

/** True when `after` holds a phone or email that `before` did not. */
export function gainsContact(before: ContactSet, after: ContactSet): boolean {
  const hadPhones = phoneKeys(before.phones);
  const hadEmails = emailKeys(before.emails);
  for (const p of phoneKeys(after.phones)) if (!hadPhones.has(p)) return true;
  for (const e of emailKeys(after.emails)) if (!hadEmails.has(e)) return true;
  return false;
}

/**
 * The fields to spread into a write: the stamp when something was gained,
 * nothing otherwise, so an unchanged contact keeps the date it already had.
 */
export function contactStampPatch(
  before: ContactSet,
  after: ContactSet,
  now: Date = new Date(),
): { contactInfoUpdatedAt?: Date } {
  return gainsContact(before, after) ? { contactInfoUpdatedAt: now } : {};
}

/**
 * The claimant's contacts. They are split across two tables: the best number
 * and email on the Lead, the rest on SurplusDetail.
 */
export function claimantContacts(
  lead: { sellerPhone?: string | null; sellerEmail?: string | null } | null | undefined,
  d: {
    phone2?: string | null;
    phone3?: string | null;
    phone4?: string | null;
    email2?: string | null;
  } | null | undefined,
): ContactSet {
  return {
    phones: [lead?.sellerPhone, d?.phone2, d?.phone3, d?.phone4],
    emails: [lead?.sellerEmail, d?.email2],
  };
}

/** An heir's or relative's contacts, all on their own row. */
export function heirContacts(
  h: {
    phone1?: string | null;
    phone2?: string | null;
    phone3?: string | null;
    phone4?: string | null;
    email1?: string | null;
    email2?: string | null;
  } | null | undefined,
): ContactSet {
  return {
    phones: [h?.phone1, h?.phone2, h?.phone3, h?.phone4],
    emails: [h?.email1, h?.email2],
  };
}

/** The columns `claimantContacts` and `heirContacts` read, for a Prisma select. */
export const CLAIMANT_CONTACT_SELECT = { phone2: true, phone3: true, phone4: true, email2: true } as const;
export const HEIR_CONTACT_SELECT = {
  phone1: true,
  phone2: true,
  phone3: true,
  phone4: true,
  email1: true,
  email2: true,
} as const;

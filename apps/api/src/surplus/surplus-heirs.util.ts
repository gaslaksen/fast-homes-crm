import { traceState } from './surplus-skiptrace.util';
import { outreachRank } from './surplus-outreach.util';
import {
  SurplusPersonRole,
  SURPLUS_PERSON_ROLE_LABEL,
  SurplusContactStatus,
  SURPLUS_CONTACT_STATUS_LABEL,
} from '@fast-homes/shared';

/** The last ten digits, the key Lead.badContacts is compared on. */
export function phoneTail(v: string | null | undefined): string {
  return String(v || '').replace(/\D/g, '').slice(-10);
}

/**
 * One heir as every surface sees it.
 *
 * A pure function rather than a method, so the board payload and the heirs
 * endpoint share one definition of `callable` without SurplusService having to
 * depend on SurplusHeirsService. The two disagreeing is the bug this shape
 * exists to prevent: the card saying an estate is callable while the panel
 * shows nobody to ring.
 */
export function heirRow(h: any, badNumbers?: Set<string>) {
  // A number somebody marked wrong or disconnected (Lead.badContacts, shared
  // by everyone on the case) stays on show, flagged, but is not a reason to
  // call this person callable.
  const phones = [1, 2, 3, 4]
    .map((i) => ({
      number: h[`phone${i}`],
      type: h[`phone${i}Type`],
      dnc: h[`phone${i}Dnc`],
      bad: !!badNumbers?.has(phoneTail(h[`phone${i}`])),
    }))
    .filter((p) => p.number);
  const emails = [h.email1, h.email2].filter(Boolean);
  const cleanPhoneCount = phones.filter((p) => !p.dnc && !p.bad).length;
  const role = (h.role || SurplusPersonRole.HEIR) as SurplusPersonRole;
  // Who to try first: spouse, children, heirs, family, then neighbors. The
  // same order the outreach list uses, so the two never disagree.
  const priority = outreachRank({ role, relationship: h.relationship, deceased: h.deceased, doNotCall: h.doNotCall });
  const contactStatus = (h.contactStatus || SurplusContactStatus.NOT_CONTACTED) as SurplusContactStatus;

  return {
    id: h.id,
    name: h.name,
    /** Heir by default. Anybody else is a route to the claimant, not a signer. */
    role,
    roleLabel: SURPLUS_PERSON_ROLE_LABEL[role] || role,
    isHeir: role === SurplusPersonRole.HEIR,
    contactStatus,
    contactStatusLabel: SURPLUS_CONTACT_STATUS_LABEL[contactStatus] || contactStatus,
    lastContactedAt: h.lastContactedAt || null,
    /** When this person last gained a phone or email. See surplus-contact-stamp.util.ts. */
    contactInfoUpdatedAt: h.contactInfoUpdatedAt || null,
    relationship: h.relationship,
    priority: priority.rank,
    priorityLabel: priority.label,
    share: h.share,
    street: h.street,
    city: h.city,
    state: h.state,
    zip: h.zip,
    address:
      [h.street, h.city, [h.state, h.zip].filter(Boolean).join(' ').trim()]
        .filter(Boolean)
        .join(', ') || null,
    deceased: h.deceased,
    dateOfDeath: h.dateOfDeath,
    phones,
    emails,
    cleanPhoneCount,
    contactMismatch: h.contactMismatch,
    mismatchedName: h.mismatchedName,
    trace: traceState(h, phones.length + emails.length),
    doNotCall: h.doNotCall,
    callNotes: h.callNotes || '',
    sourceCaseNumber: h.sourceCaseNumber,
    sourceDocument: h.sourceDocument,
    /** When the web was last searched for this person's profiles. */
    socialSearchedAt: h.socialSearchedAt || null,
    /**
     * Reachable AND allowed to be contacted.
     *
     * False for anyone deceased however many numbers are attached. The Spencer
     * filing lists a surviving spouse who died in 2022; a number of hers that
     * still reaches a relative is not a reason to show her as callable, and
     * dialling it means telling somebody's family they have money coming when
     * they do not.
     */
    callable: !h.deceased && !h.doNotCall && cleanPhoneCount > 0,
    /** Worth a credit: alive, no number yet, and an address to submit. */
    traceable: !h.deceased && !h.doNotCall && cleanPhoneCount === 0 && !!h.street,
  };
}

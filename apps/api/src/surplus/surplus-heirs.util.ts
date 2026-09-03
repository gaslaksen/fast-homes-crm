import { traceState } from './surplus-skiptrace.util';

/**
 * One heir as every surface sees it.
 *
 * A pure function rather than a method, so the board payload and the heirs
 * endpoint share one definition of `callable` without SurplusService having to
 * depend on SurplusHeirsService. The two disagreeing is the bug this shape
 * exists to prevent: the card saying an estate is callable while the panel
 * shows nobody to ring.
 */
export function heirRow(h: any) {
  const phones = [1, 2, 3, 4]
    .map((i) => ({ number: h[`phone${i}`], type: h[`phone${i}Type`], dnc: h[`phone${i}Dnc`] }))
    .filter((p) => p.number);
  const emails = [h.email1, h.email2].filter(Boolean);
  const cleanPhoneCount = phones.filter((p) => !p.dnc).length;

  return {
    id: h.id,
    name: h.name,
    relationship: h.relationship,
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

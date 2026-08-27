/**
 * Deciding who to skip trace on a surplus file, and whether to believe what
 * comes back.
 *
 * ── Who we are looking for ──────────────────────────────────────────────────
 *
 * The target is the owner the clerk mailed the Notice of Surplus Funds to. On
 * Duval that notice goes to the owner at the PROPERTY address, which is the
 * address of record from the tax roll. Verified against both readable notices:
 * Dannie Lester Stewart Estate was noticed at 2607 Broadway Ave and Ella Clowers
 * Estate at 2866 W 11th St, each the property that sold.
 *
 * So the property address is the trace input. That is not a convenience, it is
 * the definition of the target: whoever the clerk could not reach is exactly who
 * is owed the money and does not know it.
 *
 * ── Why the answer is so often the wrong person ─────────────────────────────
 *
 * The property SOLD at tax deed auction. Tracing its address today frequently
 * returns whoever is there now, which may be the tax deed purchaser or a new
 * tenant, not the former owner we want. BatchData matches on ADDRESS ONLY and
 * has no idea we are asking about a person who moved out.
 *
 * That is why every returned identity is checked against the claimant by name
 * before a single phone number is attached, and why a failed check discards the
 * contacts rather than storing them. Attaching a stranger's number to a claimant
 * means calling an uninvolved person about someone else's money, which is a
 * wrong-party TCPA problem and a privacy problem at the same time.
 *
 * The clerk's own returned mail predicts this. `mailVerdict: 'undeliverable'`
 * means the owner was already gone when the notice went out, so a trace of that
 * address is very likely to come back a stranger.
 */

/** What a returned identity is, relative to the claimant we asked about. */
export type TraceVerdict =
  /** Given name and surname both line up. Attach the contacts. */
  | 'same_person'
  /** Surname matches, given name does not. A spouse, sibling or adult child.
   *  Worth keeping and worth flagging: they can point you at the claimant. */
  | 'relative'
  /** Nothing usable came back to check. Attach, but say it is unverified. */
  | 'unverified'
  /** Somebody else entirely. Discard the contacts and record why. */
  | 'stranger';

export interface TraceCheck {
  verdict: TraceVerdict;
  /** Shown on the card, so a discarded trace can be audited rather than trusted. */
  reason: string;
}

function tokens(v?: string | null): string[] {
  return String(v || '')
    .toLowerCase()
    // Apostrophes and periods are dropped rather than split on, so O'Brien still
    // matches a vendor that returned OBrien. Spaces and hyphens do split, so
    // Smith-Jones matches Jones.
    .replace(/['’.]/g, '')
    .split(/[^a-z]+/i)
    .map((t) => t.trim())
    .filter(Boolean);
}

const SUFFIX = new Set(['jr', 'sr', 'ii', 'iii', 'iv', 'v']);
const ESTATE_WORDS = new Set(['estate', 'deceased', 'decd', 'the', 'of']);

/**
 * Split a county-style claimant string into given names and a surname.
 *
 * Counties write "DANNIE LESTER STEWART" and "EDGAR CLOWERS, JR." and
 * "RICHARD JONES JR ESTATE". Estate words and generational suffixes are stripped
 * first so the surname is not "ESTATE" and not "JR".
 */
export function splitClaimantName(raw?: string | null): {
  given: string[];
  surname: string;
} {
  const parts = tokens(raw).filter((t) => !ESTATE_WORDS.has(t) && !SUFFIX.has(t));
  if (!parts.length) return { given: [], surname: '' };
  if (parts.length === 1) return { given: [], surname: parts[0] };
  return { given: parts.slice(0, -1), surname: parts[parts.length - 1] };
}

/**
 * Does this returned identity belong to the claimant?
 *
 * Given name and surname are compared SEPARATELY and deliberately. A single
 * token-overlap score is useless here: "Robert Pittard" against "Dorothy
 * Pittard" and "Robert Pittard" against "Robert Stranger" both score 50%, and
 * they are completely different situations. The first is the claimant's
 * household and worth calling. The second is a stranger.
 *
 * Middle names are ignored on both sides. Vendors return them inconsistently and
 * a missing middle name is not evidence of a different person.
 */
export function verifyTracedName(
  claimant?: string | null,
  tracedFirst?: string | null,
  tracedLast?: string | null,
): TraceCheck {
  const traced = splitClaimantName(
    [tracedFirst, tracedLast].filter(Boolean).join(' ') || null,
  );
  const tracedFull = tokens([tracedFirst, tracedLast].join(' '));
  if (!tracedFull.length) {
    return {
      verdict: 'unverified',
      reason: 'The trace returned contacts but no name to check them against.',
    };
  }

  const want = splitClaimantName(claimant);
  if (!want.surname) {
    return {
      verdict: 'unverified',
      reason: 'No claimant surname on file to check the trace against.',
    };
  }

  // Compare the traced surname against the claimant's surname, and also against
  // the claimant's given names. Counties invert names ("HILL TAMMIE LEE"), so a
  // strict positional match would reject a correct hit.
  const claimantAll = [...want.given, want.surname];
  const surnameHit =
    !!traced.surname &&
    (traced.surname === want.surname || claimantAll.includes(traced.surname));
  const givenHit = traced.given.some(
    (g) => want.given.includes(g) || g === want.surname,
  );

  if (surnameHit && givenHit) {
    return { verdict: 'same_person', reason: 'Given name and surname both match the claimant.' };
  }
  if (surnameHit) {
    return {
      verdict: 'relative',
      reason:
        'Surname matches but the given name does not, so this is the claimant’s household rather than the claimant. Often the fastest route to them.',
    };
  }
  // A given-name-only match is the classic false positive: same first name,
  // different family. It is a stranger, not a partial hit.
  return {
    verdict: 'stranger',
    reason: givenHit
      ? 'Only the given name matches, which is a different family, not the claimant.'
      : 'Neither the given name nor the surname matches the claimant.',
  };
}

// ─── Deciding what is worth submitting ──────────────────────────────────────

export interface TraceCandidate {
  street?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
}

export type TraceSkipReason =
  | 'no_address'
  | 'no_house_number'
  | 'placeholder_address'
  | 'zip_state_mismatch'
  | 'entity'
  | 'shared_address'
  | 'property_mail_returned';

export interface TraceEligibility {
  ok: boolean;
  reason?: TraceSkipReason;
  detail?: string;
}

/**
 * Florida ZIP prefixes, 320 through 349. Used only to catch an obviously
 * mismatched state/ZIP pair before it is submitted, not to validate an address.
 */
function zipLooksFlorida(zip: string): boolean {
  const n = Number(zip.slice(0, 3));
  return n >= 320 && n <= 349;
}

/**
 * Is this address worth a credit?
 *
 * Each rejection here is a credit not wasted and, more importantly, a wrong
 * number not attached to a claimant.
 */
export function traceEligibility(
  c: TraceCandidate,
  opts: {
    isEntity?: boolean;
    addressCaseCount?: number;
    /**
     * Set only when this candidate is falling back to the PROPERTY address
     * because no mailing address was recovered. Carries the clerk's own mail
     * verdict for that property.
     */
    propertyFallbackMailVerdict?: string | null;
  } = {},
): TraceEligibility {
  // An entity has no consumer identity to find. 37 of 204 targets on a sampled
  // Lee county pull were entities. They need Sunbiz for the registered agent,
  // and a consumer skip trace on one returns either nothing or a stranger.
  if (opts.isEntity) {
    return {
      ok: false,
      reason: 'entity',
      detail: 'Entity owner. Look up the registered agent on Sunbiz rather than skip tracing a person.',
    };
  }

  const street = String(c.street || '').trim();
  if (!street) {
    return { ok: false, reason: 'no_address', detail: 'No street address on the case.' };
  }

  // BatchData matches on address. A street with no house number cannot match a
  // parcel, and Duval does ship these: case 2026-0004TD lists its property as
  // "BROADWAY AVE, JACKSONVILLE, FL 32254" with no number, even though the
  // mailed notice went to 2607 Broadway Ave. Submitting it burns a credit and
  // returns whoever the vendor decides lives on that street.
  if (!/^\d/.test(street)) {
    return {
      ok: false,
      reason: 'no_house_number',
      detail: `The case lists "${street}" with no house number, so an address match would be a guess. The number is on the mailed notice.`,
    };
  }

  // A leading "0" is the tax roll's placeholder for a parcel with no assigned
  // street number, which is what vacant land looks like. It starts with a digit
  // so the check above waves it through, and it is guaranteed to match nothing.
  // Two of the first three Duval addresses submitted were "0 HARDEE ST" and
  // "0 PLACEDA ST"; both burned a credit, came back a stranger, and then wore a
  // contact-mismatch flag they had not earned.
  if (/^0+\d*(\s|$)/.test(street) && !/^[1-9]/.test(street)) {
    return {
      ok: false,
      reason: 'placeholder_address',
      detail: `"${street}" is a tax roll placeholder for a parcel with no street number, usually vacant land. There is no household here to trace.`,
    };
  }

  const zip = String(c.zip || '').trim().slice(0, 5);
  const state = String(c.state || '').trim().toUpperCase();
  // A mismatched state and ZIP either misses or, worse, matches a stranger in
  // another state. Caught on a real Lee row carrying state AL against a Florida ZIP.
  if (zip && state === 'FL' && !zipLooksFlorida(zip)) {
    return {
      ok: false,
      reason: 'zip_state_mismatch',
      detail: `ZIP ${zip} is not a Florida ZIP but the state says FL. Fix the address before tracing.`,
    };
  }

  // An address appearing on several unrelated cases is a professional address:
  // an attorney, a tax service, a registered agent. Lee's 205 E Joel Blvd shows
  // up on three unrelated cases under four unrelated names. One household comes
  // back and attributing those phones to every claimant is wrong at least twice.
  if ((opts.addressCaseCount || 0) > 1) {
    return {
      ok: false,
      reason: 'shared_address',
      detail: `This address appears on ${opts.addressCaseCount} different cases, so it is almost certainly a professional address rather than a home.`,
    };
  }

  // The clerk already mailed this exact address and it came back. Tracing it
  // returns whoever lives there now, which on a sold tax deed parcel is very
  // often the purchaser. Six of six such submissions came back strangers.
  if (opts.propertyFallbackMailVerdict === 'undeliverable') {
    return {
      ok: false,
      reason: 'property_mail_returned',
      detail:
        'No mailing address recovered from the notice, and the clerk\'s own mail to the property was returned undelivered. Tracing it would return the current occupant. Read the Notice of Surplus Funds for the owner\'s address.',
    };
  }

  return { ok: true };
}

/**
 * Grouping key for one physical address.
 *
 * BatchData matches on address and nothing else, so two co-owners at one
 * property return the identical row twice and the second credit buys nothing.
 * Leads are grouped on this and submitted once, then the response is matched
 * back to each claimant by name.
 */
export function addressKeyOf(c: TraceCandidate): string {
  const norm = (v?: string | null) =>
    String(v || '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();
  return [norm(c.street), norm(c.city), norm(c.zip).slice(0, 5)].filter(Boolean).join('|');
}

/**
 * How many DIFFERENT cases an address appears on, for the shared-address check.
 * Repeats within one case are a household and are fine; repeats across cases are
 * a professional address.
 */
export function addressCaseCounts(
  rows: { addressKey: string; caseNumber?: string | null }[],
): Map<string, number> {
  const byAddress = new Map<string, Set<string>>();
  for (const r of rows) {
    if (!r.addressKey) continue;
    const set = byAddress.get(r.addressKey) || new Set<string>();
    set.add(String(r.caseNumber || ''));
    byAddress.set(r.addressKey, set);
  }
  return new Map([...byAddress].map(([k, v]) => [k, v.size]));
}

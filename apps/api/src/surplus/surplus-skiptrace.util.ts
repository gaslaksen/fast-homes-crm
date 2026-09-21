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

/**
 * Are these the same given name, allowing for how the record was written down?
 *
 * Exact comparison called the real Duval hit a relative rather than the
 * claimant: the county wrote MYRTIS GRIFFIN and the vendor returned
 * "Mertis Griffin", one character apart. The contacts were kept either way,
 * because a surname match is enough for that, but the lead was labelled "not
 * the claimant" when it was plainly her.
 *
 * Two allowances, both narrow:
 *   - an initial against a full name ("R" and "Robert"), which is how counties
 *     abbreviate
 *   - a single character of difference on a name of five or more, which covers
 *     a transcription slip without letting short names collide (Jon and Ron,
 *     Dan and Dana are NOT the same person)
 */
export function sameGivenName(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  // An initial standing in for the full name.
  if (a.length === 1 || b.length === 1) return a[0] === b[0];
  // Too short to risk a fuzzy match on.
  if (a.length < 5 || b.length < 5) return false;
  if (Math.abs(a.length - b.length) > 1) return false;
  return editDistanceWithin1(a, b);
}

/** True when `a` and `b` are at most one substitution, insertion or deletion apart. */
function editDistanceWithin1(a: string, b: string): boolean {
  if (a.length === b.length) {
    let diff = 0;
    for (let i = 0; i < a.length; i += 1) {
      if (a[i] !== b[i] && (diff += 1) > 1) return false;
    }
    return diff === 1;
  }
  const [short, long] = a.length < b.length ? [a, b] : [b, a];
  let i = 0;
  let j = 0;
  let skipped = false;
  while (i < short.length && j < long.length) {
    if (short[i] === long[j]) {
      i += 1;
      j += 1;
      continue;
    }
    if (skipped) return false;
    skipped = true;
    j += 1;
  }
  return true;
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
 * Capacity markers a county appends to say HOW someone holds title, not who
 * they are: trustee/custodian, "and others", "and wife", care-of.
 *
 * Stripped as whole phrases before tokenizing, because tokenizing them first
 * turns "T/C" into the letters t and c and leaves "c" standing as a surname.
 * Duval case 2026-0005TD carries two claimants ending in T/C, so both reduced
 * to the surname "c" and matched each other: one of them was handed the other's
 * notice page, which is the same wrong-address bug that gets the wrong person
 * skip traced. "ET AL" does the same thing through the surname "al".
 */
const CAPACITY =
  /\b(?:t\s*\/\s*c|c\s*\/\s*o|et\s+(?:al|ux|vir)|trustees?|tr|ttee|as\s+tenants?\s+in\s+common)\b/gi;

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
  const parts = tokens(String(raw || '').replace(CAPACITY, ' ')).filter(
    (t) => !ESTATE_WORDS.has(t) && !SUFFIX.has(t),
  );
  // A trailing single letter is an initial, never a surname. Left in place it
  // makes every "JOHN C" and "MARY C" on a docket look like the same family.
  while (parts.length > 1 && parts[parts.length - 1].length === 1) parts.pop();
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
    (g) => want.given.some((w) => sameGivenName(g, w)) || sameGivenName(g, want.surname),
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

/**
 * Whether a death record on the returned person may be recorded against the
 * claimant. Stricter than `same_person`, which accepts an initial for a given
 * name: "Robert Abe" is same_person for "JULIET R ABE" because R is her middle
 * initial. That leniency is tolerable for a phone number, which reaches the
 * household either way. It is not tolerable for a death, which would mark a
 * living widow dead because her husband Robert died. The vendor's own given
 * name must match one the county spelled out.
 */
export function deathIsTheClaimants(
  claimant?: string | null,
  tracedFirst?: string | null,
  tracedLast?: string | null,
): boolean {
  if (verifyTracedName(claimant, tracedFirst, tracedLast).verdict !== 'same_person') return false;
  const traced = splitClaimantName([tracedFirst, tracedLast].filter(Boolean).join(' ') || null);
  const want = splitClaimantName(claimant);
  const spelled = [...want.given, want.surname].filter((w) => w.length > 1 && w !== traced.surname);
  return traced.given.filter((g) => g.length > 1).some((g) => spelled.some((w) => sameGivenName(g, w)));
}

// ─── Whether a claim is worth paying to reach ───────────────────────────────

/** Days from the surplus notice after which no paid lookup is made. */
export const TRACE_MAX_AGE_DAYS = 365;

/**
 * Days from the surplus notice before which no skip trace is bought.
 *
 * Passed by SurplusSkiptraceService, which spends the BatchData and Endato
 * credits. `traceCriteria` itself defaults to no floor.
 *
 * The claim window is 120 days from the mailed notice, and the claimant
 * cannot be approached until it is nearly up. A lookup bought before then is
 * bought early: the claim may be settled by the owner in the meantime, and
 * the numbers go stale while it waits. 110 leaves time to prepare.
 */
export const TRACE_MIN_AGE_DAYS = 110;

export type CriteriaRefusal = 'claim_on_file' | 'closed' | 'over_a_year' | 'too_early' | 'estate';

export interface TraceCriteriaResult {
  ok: boolean;
  /** Why not, as a skipped-count key. Null when ok. */
  reason: CriteriaRefusal | null;
  /** One sentence for the card. Null when ok. */
  detail: string | null;
}

/**
 * The business's criteria for spending a paid lookup (BatchData or Endato)
 * on a claim, in one place so every path asks the same question: the county
 * pull's automatic trace, the Skip trace button, the heir trace and every
 * bulk run.
 *
 *   - A claim by somebody else on file and not yet ruled on: not worth it.
 *     Denied claims and government-lien-only cases ARE worth it (decided
 *     2026-09-15): the money is still there, and a lien takes only a slice.
 *   - Assigned or paid out: closed.
 *   - The surplus notice over a year old (the sale date when no notice is on
 *     file): not worth it. No date at all means the clock has not started.
 *   - The notice under `minAgeDays` old: too early. The claimant cannot be
 *     approached until the 120 day claim window is nearly up, so a paid
 *     lookup waits rather than being bought and going stale. The floor is
 *     off unless a caller passes it, because it belongs to the BatchData and
 *     Endato paths; the social and obituary searches read what is already
 *     published and are not held back by it.
 *   - The county lists the claimant as dead: never trace the dead person. The
 *     estate search looks for their family instead, so estate paths pass
 *     `estate: true`.
 */
export function traceCriteria(
  d: {
    claimStatus?: string | null;
    /** The board stage. "Dead" is a person retiring the claim. */
    stage?: string | null;
    noticeDate?: Date | string | null;
    saleDate?: Date | string | null;
    deceased?: boolean | null;
    heirsRequired?: boolean | null;
  },
  opts: { estate?: boolean; now?: Date; maxAgeDays?: number; minAgeDays?: number } = {},
): TraceCriteriaResult {
  const status = String(d.claimStatus || '').toLowerCase();
  if (status === 'pending') {
    return {
      ok: false,
      reason: 'claim_on_file',
      detail: 'Not traced: somebody else has a claim on file that the clerk has not ruled on.',
    };
  }
  if (status === 'assigned' || status === 'distributed') {
    return { ok: false, reason: 'closed', detail: 'Not traced: the claim is assigned or paid out.' };
  }
  // Somebody on the team retired this claim (unresponsive, below the floor,
  // competing claim). A paid lookup on it is money spent on a decision
  // already made.
  if (String(d.stage || '') === 'Dead') {
    return { ok: false, reason: 'closed', detail: 'Not traced: the claim is marked Dead on the board.' };
  }
  const basis = d.noticeDate || d.saleDate;
  const when = basis ? new Date(basis) : null;
  const maxAge = opts.maxAgeDays ?? TRACE_MAX_AGE_DAYS;
  const minAge = opts.minAgeDays ?? 0;
  if (when && !isNaN(when.getTime())) {
    const days = ((opts.now || new Date()).getTime() - when.getTime()) / 86400000;
    const label = d.noticeDate ? 'surplus notice' : 'sale';
    if (days > maxAge) {
      return {
        ok: false,
        reason: 'over_a_year',
        detail: `Not traced: the ${label} was ${when.toISOString().slice(0, 10)}, over ${maxAge} days ago.`,
      };
    }
    // Too early. The claim window has to be nearly up before the claimant can
    // be approached, so the lookup waits rather than going stale.
    if (days < minAge) {
      return {
        ok: false,
        reason: 'too_early',
        detail: `Not traced yet: the ${label} was ${Math.floor(days)} days ago and these open up at ${minAge} days.`,
      };
    }
  }
  if ((d.deceased || d.heirsRequired) && !opts.estate) {
    return {
      ok: false,
      reason: 'estate',
      detail: 'Not traced: the claimant is dead. The estate search looks for their spouse and children instead.',
    };
  }
  return { ok: true, reason: null, detail: null };
}

/**
 * Whether a vendor-listed relative is a direct inheritor worth a lookup: a
 * spouse, or a family member born 15 to 55 years after the claimant, which is
 * a child. Endato labels relatives only "Spouse" or "Family", so the birth
 * years decide; a sibling, parent, grandchild or anyone undated is filed for
 * the record and not looked up.
 */
export function relativeKind(
  type: string | null | undefined,
  relativeDob: string | null | undefined,
  claimantBirthYear: number | null | undefined,
): 'spouse' | 'child' | 'sibling' | 'parent' | 'grandchild' | 'family' {
  if (/spouse/i.test(type || '')) return 'spouse';
  const y = relativeDob ? Number(String(relativeDob).slice(0, 4)) : NaN;
  if (!Number.isFinite(y) || !claimantBirthYear) return 'family';
  const gap = y - claimantBirthYear;
  if (gap >= 15 && gap <= 55) return 'child';
  if (gap > 55) return 'grandchild';
  if (gap <= -15) return 'parent';
  if (Math.abs(gap) < 15) return 'sibling';
  return 'family';
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
  | 'not_us_address'
  | 'entity'
  | 'shared_address'
  | 'mail_returned';

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
     * The clerk's own verdict on mail to this claimant, from the returned-mail
     * filings on the docket. Applies to WHICHEVER address we are about to
     * submit: the notice went to the owner's mailing address, so a returned
     * verdict condemns that address, not just the property.
     */
    mailVerdict?: string | null;
    /**
     * The claimant has a given name and a surname for the vendor to match
     * on, so a dead mailing address is worked around rather than fatal.
     */
    nameKnown?: boolean;
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

  // BatchData is a US consumer database. An address with no two-letter state
  // or five-digit ZIP is foreign or unparsed (Lee owners in Belgium, Australia
  // and the UK on the first pull), and submitting it either misses or matches
  // whoever the vendor guesses. Those claimants need a name search instead.
  if (!/^[A-Z]{2}$/.test(state) || !/^\d{5}$/.test(zip)) {
    return {
      ok: false,
      reason: 'not_us_address',
      detail: `"${[c.street, c.city, c.state, c.zip].filter(Boolean).join(', ')}" is not a US address the vendor can match. Use the name search.`,
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

  // The clerk already wrote to this claimant and it came back. Whatever address
  // we have for them is the one that bounced, so an ADDRESS-ONLY trace of it
  // returns whoever is there NOW rather than the claimant.
  //
  // The evidence for that was unambiguous under the v1 address-only query:
  // every submission against an address whose mail had already been returned
  // came back a stranger, six of six on the property addresses, then Maxine
  // Fletcher at the Bronx mailing address and Kelli Grimes at the Bradford St
  // one. Not one produced a contact.
  //
  // The v3 query sends the claimant's NAME and the property that sold, and the
  // vendor confirms the person against both. When the name is known the caller
  // submits name plus property and leaves the dead mailing address out, so
  // the gate applies only when there is no name to match on. Polk made this
  // matter: 116 of its 141 properties carry a returned surplus letter, and an
  // address-only rule would have written the whole county off.
  if (opts.mailVerdict === 'undeliverable' && !opts.nameKnown) {
    return {
      ok: false,
      reason: 'mail_returned',
      detail:
        "The clerk's own mail to this address was returned undelivered, so a skip trace of it returns whoever is there now rather than the claimant. Search by NAME instead and confirm against the property address.",
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

/**
 * How a claimant's skip trace stands, in one object the UI can render without
 * interpreting anything.
 *
 * The distinction that matters most is the cheapest one to lose: NEVER TRIED is
 * not a failure. Rows loaded before the automatic trace (2026-09-12), or by
 * hand, may have had nothing attempted on them at all. Shown as "no numbers" that reads as a
 * broken trace, and the reasonable response to a broken trace is to run it
 * again, which costs money and changes nothing.
 *
 * `actionable` says whether re-running the SAME trace could plausibly help. It
 * is true only for a row nothing has been submitted for.
 */
export interface TraceState {
  state: 'never' | 'matched' | 'likely' | 'relative' | 'unverified' | 'mismatch' | 'no_person' | 'no_contact' | 'skipped';
  label: string;
  /** 'good' | 'warn' | 'bad' | 'idle', for the panel to colour from. */
  tone: 'good' | 'warn' | 'bad' | 'idle';
  detail: string;
  at: Date | null;
  actionable: boolean;
}

const TRACE_LABEL: Record<string, { label: string; tone: TraceState['tone'] }> = {
  matched: { label: 'Traced, matched', tone: 'good' },
  likely: { label: 'Traced, likely match', tone: 'warn' },
  relative: { label: 'Traced, relative only', tone: 'warn' },
  unverified: { label: 'Traced, name unconfirmed', tone: 'warn' },
  mismatch: { label: 'Traced, wrong person', tone: 'bad' },
  no_person: { label: 'Traced, nobody found', tone: 'bad' },
  no_contact: { label: 'Traced, no phone or email', tone: 'warn' },
  skipped: { label: 'Not traced, refused', tone: 'idle' },
};

export function traceState(
  d: {
    tracedAt?: Date | null;
    traceOutcome?: string | null;
    traceDetail?: string | null;
    contactMismatch?: boolean | null;
    mismatchedName?: string | null;
  },
  /** Contacts actually on the row. The outcome must not contradict them. */
  contactCount = 0,
): TraceState {
  // Rows traced before the outcome column existed carry only the mismatch flag.
  // Reading it keeps their history rather than showing them as never tried.
  const outcome = d.traceOutcome || (d.contactMismatch ? 'mismatch' : null);
  if (!outcome || !d.tracedAt) {
    return {
      state: 'never',
      label: 'Never skip traced',
      tone: 'idle',
      detail:
        'Nothing has been looked up for this person yet. A county pull traces the claimants it creates, and a relative of a claimant found dead is looked up by the vendor\'s id for them; anyone else is traced from the card.',
      at: null,
      actionable: true,
    };
  }
  // A row holding numbers cannot also be reporting that nothing was found. The
  // migration that backfilled outcomes had to guess from note prose, and it
  // guessed wrong on rows whose notes carried more than one trace line: Calvin
  // Johnson read "nobody found" while holding four numbers. Trust the contacts,
  // which are a fact, over the outcome, which is a reconstruction.
  if (contactCount > 0 && (outcome === 'no_person' || outcome === 'no_contact' || outcome === 'skipped')) {
    return {
      state: 'unverified',
      label: 'Traced, contacts on file',
      tone: 'warn',
      detail:
        'Contacts are attached from an earlier trace, but the recorded outcome does not match them, so how they were verified is not known. Re-trace to establish it.',
      at: d.tracedAt,
      actionable: true,
    };
  }

  const meta = TRACE_LABEL[outcome] || { label: 'Traced', tone: 'idle' as const };
  return {
    state: outcome as TraceState['state'],
    label: meta.label,
    tone: meta.tone,
    detail:
      d.traceDetail ||
      (d.mismatchedName ? `Returned ${d.mismatchedName}, who is not the claimant.` : 'Trace recorded.'),
    at: d.tracedAt,
    // Already submitted. The same address returns the same answer, so the next
    // move is a name search, not another credit.
    actionable: false,
  };
}

/**
 * "ZUMSTEG, ANITA" as the county writes it, turned round to "ANITA ZUMSTEG"
 * so the name matcher and the vendor see the same shape. A name without a
 * comma is returned as is.
 */
export function displayName(raw: string): string {
  const s = String(raw || '').trim();
  const m = /^([^,]+),\s*(.+)$/.exec(s);
  if (!m) return s;
  const [, last, given] = m;
  // "JOHNNY LOVE WILLIAMS, SR" is a suffix, not a surname-first form.
  if (/^(SR|JR|II|III|IV|V|ESQ|ET\s*AL|ETAL|ESTATE\s*OF|DECEASED|TRUSTEE|TR)\.?$/i.test(given.trim())) return s;
  return `${given.trim()} ${last.trim()}`;
}

/**
 * The person inside an estate's name, for a people search. The docket writes
 * "ESTATE OF THERESA MCPARLIN, DECEASED", "JIMMY DON BERGER ESTATE" and, on
 * the Pinellas roll, "MCGRATH, HARRY A III EST"; Endato wants Theresa
 * McParlin.
 */
export function estateName(raw: string): string {
  const s = String(raw || '')
    .replace(/^\s*(?:the\s+)?estate\s+of\s+/i, '')
    .replace(/\(?\b(?:deceased|decd|est|estate)\b\)?\.?/gi, ' ')
    .replace(/\s*,\s*,/g, ',')
    .replace(/[\s,]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return displayName(s);
}

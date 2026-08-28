/**
 * The name-first route to a claimant, for when the address route is exhausted.
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 *
 * BatchData matches on ADDRESS and nothing else. That works while we have a
 * live address and fails completely once the clerk's own mail has been
 * returned, which is the state most surplus claimants are in: every submission
 * against a returned address has come back a stranger, without exception.
 *
 * The Overages Blueprint course teaches the inverse and it is the right shape
 * for this problem:
 *
 *   1. Search by CLAIMANT NAME plus STATE, not by address.
 *   2. Read the results and look for one whose address history includes THE
 *      PROPERTY THAT WAS SOLD. That is the confirmation: this person is tied to
 *      the parcel that generated the surplus.
 *   3. Contact by phone, by mail to their current address, and by email.
 *   4. If only relatives surface, contact them and ask to be passed along.
 *
 * Address is the VERIFIER here, not the query. That is exactly backwards from
 * what we do today, and it is why the two approaches complement rather than
 * duplicate each other.
 *
 * ── Why these are links and not integrations ────────────────────────────────
 *
 * The sources the course recommends (TruePeopleSearch, Cyber Background Checks,
 * Spokeo, Whitepages, Intelius, Instant Checkmate, PeopleFinders, Spyfly,
 * SkipGenie, SkipMax and the rest) are consumer people-search sites. None
 * publishes an API for this, and their terms prohibit automated querying; most
 * sit behind bot detection precisely to enforce that. Scraping them would be a
 * terms violation, would break the first time a layout changed, and several are
 * consumer-reporting-adjacent, which carries its own permissible-purpose
 * problem.
 *
 * So this generates one-click, pre-filled searches and puts the verification
 * step in front of the person doing the looking. The judgement stays human,
 * which is where it belongs: deciding that a returned "Mertis Griffin" in
 * Hartford is the Myrtis Griffin who lost 0 Hardee St is not a lookup, it is an
 * identification.
 */

import { splitClaimantName } from './surplus-skiptrace.util';

export interface NameSearchLink {
  site: string;
  url: string;
  /** Free sites first, since they answer most cases without a subscription. */
  free: boolean;
}

export interface NameSearchPlan {
  /** What to type in: the claimant, and the state to narrow to. */
  query: string;
  state: string | null;
  /**
   * The address to look for in the results. A hit that lists this address in
   * its history is the claimant; one that does not is a different person with
   * the same name.
   */
  verifyAgainst: string | null;
  links: NameSearchLink[];
  /** Why the address route is not available, when it is not. */
  reason?: string;
}

const slug = (v: string) => v.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/**
 * Search URLs for the sites the course recommends.
 *
 * These are the sites' own public search paths, not an API. They can drift when
 * a site redesigns; a stale one lands the user on the site rather than the
 * result, which is a mild inconvenience and not a failure. The free ones lead
 * because they answer most cases without a subscription.
 */
export function nameSearchLinks(name: string, state?: string | null): NameSearchLink[] {
  const n = String(name || '').trim();
  if (!n) return [];
  const st = String(state || '').trim().toUpperCase();
  const enc = encodeURIComponent(n);
  const nameSlug = slug(n);
  const stateSlug = st.toLowerCase();

  return [
    {
      site: 'TruePeopleSearch',
      free: true,
      url: `https://www.truepeoplesearch.com/results?name=${enc}${st ? `&citystatezip=${encodeURIComponent(st)}` : ''}`,
    },
    {
      site: 'FastPeopleSearch',
      free: true,
      url: st
        ? `https://www.fastpeoplesearch.com/name/${nameSlug}_${stateSlug}`
        : `https://www.fastpeoplesearch.com/name/${nameSlug}`,
    },
    {
      site: 'Cyber Background Checks',
      free: true,
      url: st
        ? `https://www.cyberbackgroundchecks.com/people/${nameSlug}/${stateSlug}`
        : `https://www.cyberbackgroundchecks.com/people/${nameSlug}`,
    },
    {
      site: 'Whitepages',
      free: false,
      url: `https://www.whitepages.com/name/${nameSlug}${st ? `/${st}` : ''}`,
    },
    {
      site: 'Spokeo',
      free: false,
      url: `https://www.spokeo.com/${nameSlug}${st ? `/${st}` : ''}`,
    },
  ];
}

/**
 * Build the plan for one claimant.
 *
 * The state searched is the OWNER'S state, not the property's. Myrtis Griffin
 * lost a parcel in Florida and lives in Connecticut; searching Florida finds
 * nothing. The property address is what confirms the hit, and it is the only
 * thing tying a name in another state back to this surplus.
 */
export function nameSearchPlan(input: {
  claimant: string;
  ownerState?: string | null;
  propertyAddress?: string | null;
  propertyCity?: string | null;
  isEntity?: boolean;
  mailVerdict?: string | null;
}): NameSearchPlan | null {
  const claimant = String(input.claimant || '').trim();
  if (!claimant) return null;

  // An entity has no consumer record to find. Sunbiz holds the registered
  // agent, who is the person who can actually sign.
  if (input.isEntity) {
    return {
      query: claimant,
      state: input.ownerState || null,
      verifyAgainst: null,
      reason:
        'Entity claimant. The registered agent on Sunbiz is the person who can sign, not anyone a people search will return.',
      links: [
        {
          site: 'Sunbiz (FL Division of Corporations)',
          free: true,
          url: `https://search.sunbiz.org/Inquiry/CorporationSearch/SearchResults?inquiretype=EntityName&searchNameOrder=${encodeURIComponent(
            claimant.toUpperCase().replace(/[^A-Z0-9]/g, ''),
          )}`,
        },
      ],
    };
  }

  return {
    query: claimant,
    state: input.ownerState || null,
    verifyAgainst: [input.propertyAddress, input.propertyCity].filter(Boolean).join(', ') || null,
    reason:
      input.mailVerdict === 'undeliverable'
        ? "The clerk's mail to this claimant was returned, so no address we hold is live. Name search is the route."
        : undefined,
    links: nameSearchLinks(claimant, input.ownerState),
  };
}

/**
 * What to say to a relative, from the course's script.
 *
 * A surname-only match is not a dead end, it is a referral. The classifier
 * already keeps these rather than discarding them; this is what to do with one.
 * Deliberately does NOT state the amount: that is the claimant's business, and
 * naming a figure to a third party invites someone else to go after it.
 */
export function relativeOutreachScript(claimant: string, relative?: string | null): string {
  const who = String(relative || '').trim();
  return (
    `${who ? `${who} is ` : 'This contact is '}not the claimant, but shares a surname and is very likely family. ` +
    `Say: we have been unable to reach ${claimant}, our research indicates you may be a relative, ` +
    `and ${claimant} has unclaimed funds available. Ask them to pass the message on or to share ` +
    `contact details. Do not name the amount to a third party.`
  );
}


/**
 * Match a claimant to the notice page addressed to THEM.
 *
 * The clerk prints one page per recipient, and co-owners are frequently at
 * different addresses. Applying the first page's address to every claimant on
 * the case gives one of them the other's address and then skip traces them at
 * it, which is how a co-owner ends up with somebody else's phone number.
 *
 * Surname must match; a given-name match then breaks ties between relatives who
 * share one. When nothing matches, returns null rather than guessing: a wrong
 * address is worse than none, because none is visible and wrong is not.
 */
export function matchRecipient<T extends { name?: string | null }>(
  claimant: string,
  recipients: T[],
): T | null {
  if (!recipients?.length) return null;
  const want = splitClaimantName(claimant);
  if (!want.surname) return null;

  let best: { r: T; score: number } | null = null;
  for (const r of recipients) {
    const got = splitClaimantName(r.name);
    if (!got.surname) continue;
    const all = [...want.given, want.surname];
    const surnameHit = got.surname === want.surname || all.includes(got.surname);
    if (!surnameHit) continue;
    const givenHit = got.given.some((g) => want.given.includes(g) || g === want.surname);
    const score = givenHit ? 2 : 1;
    if (!best || score > best.score) best = { r, score };
  }
  return best?.r ?? null;
}

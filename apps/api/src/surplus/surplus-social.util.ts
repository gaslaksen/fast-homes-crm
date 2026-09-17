/**
 * Social media as a route to a claimant.
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 *
 * Half the surplus claimants have no live phone and no live address: the
 * clerk's own mail came back, the address trace returned a stranger, and the
 * name search found a number that rings out. Most of those people still have
 * a Facebook. A profile says where they live now, who their family is, and
 * gives a way to write to them that does not depend on a number being right.
 * The team already does this by hand, one browser tab at a time; this is the
 * shortcut.
 *
 * ── What is and is not possible ─────────────────────────────────────────────
 *
 * There is no API for finding a person on Facebook, Instagram, LinkedIn, X or
 * TikTok. Meta closed people search on the Graph API in 2018 and LinkedIn
 * never opened it; the paid people-data vendors (People Data Labs and the
 * like) are built from professional profiles and miss most of the people on
 * a tax deed docket. Google's Custom Search API, the last official route to
 * site-restricted web results, stopped taking new customers in 2025. So the
 * search here is the same one a person would run, done by Claude with web
 * search over the public web, reading the profile snippets ("Lives in San
 * Antonio, Texas", "Works at All Restoration Remodeling") against what the
 * docket and the skip trace already say about the claimant. What comes back
 * is a CANDIDATE with the evidence beside it. A person confirms it.
 *
 * Messaging is a deep link into the platform's own app, sent by the person,
 * logged here as a touch. Nothing is sent by a bot; the platforms forbid it
 * and it would get the team's accounts closed.
 */

import { SurplusSocialPlatform, SURPLUS_SOCIAL_PLATFORM_LABEL } from '@fast-homes/shared';
import type { NameSearchLink } from './surplus-name-search.util';
import { splitClaimantName } from './surplus-skiptrace.util';

export interface ParsedProfile {
  platform: SurplusSocialPlatform;
  /** Canonical, https, no tracking parameters. */
  url: string;
  /** The vanity name or numeric id, for the message link. Null when unknown. */
  handle: string | null;
}

const HOST_PLATFORM: [RegExp, SurplusSocialPlatform][] = [
  [/(^|\.)facebook\.com$|(^|\.)fb\.com$|(^|\.)m\.me$/, SurplusSocialPlatform.FACEBOOK],
  [/(^|\.)instagram\.com$|(^|\.)ig\.me$/, SurplusSocialPlatform.INSTAGRAM],
  [/(^|\.)linkedin\.com$/, SurplusSocialPlatform.LINKEDIN],
  [/(^|\.)x\.com$|(^|\.)twitter\.com$/, SurplusSocialPlatform.X],
  [/(^|\.)tiktok\.com$/, SurplusSocialPlatform.TIKTOK],
];

/** Facebook paths that are not somebody's profile. */
const FB_NOT_PROFILE = new Set([
  'search', 'people', 'public', 'groups', 'pages', 'events', 'marketplace', 'watch', 'login', 'home.php',
  'friends', 'photo', 'photo.php', 'photos', 'posts', 'share', 'sharer', 'sharer.php', 'l.php', 'help',
  'privacy', 'policies', 'messages', 'stories', 'reel', 'reels', 'hashtag', 'dialog', 'plugins',
]);

/**
 * Read a pasted or found URL into a profile. Null for anything that is not a
 * web address, and platform "other" for a site this does not know, so a
 * profile on a site nobody anticipated is still kept.
 */
export function parseProfileUrl(raw: string): ParsedProfile | null {
  let s = String(raw || '').trim();
  if (!s) return null;
  if (!/^https?:\/\//i.test(s)) s = `https://${s}`;
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    return null;
  }
  // m.me is Messenger's own host, not a mobile prefix on "me".
  const bare = u.hostname.toLowerCase();
  const host = bare === 'm.me' ? bare : bare.replace(/^(www|m|mobile|touch|mbasic|web)\./, '');
  if (!host.includes('.')) return null;
  const platform = HOST_PLATFORM.find(([re]) => re.test(host))?.[1] || SurplusSocialPlatform.OTHER;
  const parts = u.pathname.split('/').filter(Boolean).map((p) => decodeURIComponent(p));

  if (platform === SurplusSocialPlatform.FACEBOOK) {
    // facebook.com/profile.php?id=100012345678901 is the numeric form.
    const id = u.searchParams.get('id');
    if (parts[0] === 'profile.php' && id && /^\d+$/.test(id)) {
      return { platform, url: `https://www.facebook.com/profile.php?id=${id}`, handle: id };
    }
    // m.me/someone is the message link to a vanity profile.
    if (host === 'm.me' && parts[0]) {
      return { platform, url: `https://www.facebook.com/${parts[0]}`, handle: parts[0] };
    }
    // facebook.com/people/Aleric-Clark/100012345678901 is the search-result form.
    if (parts[0] === 'people' && parts[2] && /^\d+$/.test(parts[2])) {
      return { platform, url: `https://www.facebook.com/profile.php?id=${parts[2]}`, handle: parts[2] };
    }
    const first = parts[0] || '';
    if (!first || FB_NOT_PROFILE.has(first.toLowerCase())) {
      return { platform, url: `https://www.facebook.com${u.pathname}${u.search}`, handle: null };
    }
    return { platform, url: `https://www.facebook.com/${first}`, handle: first };
  }
  if (platform === SurplusSocialPlatform.INSTAGRAM) {
    const h = host === 'ig.me' && parts[0] === 'm' ? parts[1] : parts[0];
    if (!h || ['explore', 'p', 'reel', 'reels', 'stories', 'accounts', 'direct'].includes(h.toLowerCase())) {
      return { platform, url: `https://www.instagram.com${u.pathname}`, handle: null };
    }
    return { platform, url: `https://www.instagram.com/${h}/`, handle: h };
  }
  if (platform === SurplusSocialPlatform.LINKEDIN) {
    if (parts[0] === 'in' && parts[1]) return { platform, url: `https://www.linkedin.com/in/${parts[1]}/`, handle: parts[1] };
    return { platform, url: `https://www.linkedin.com${u.pathname}`, handle: null };
  }
  if (platform === SurplusSocialPlatform.X) {
    const h = parts[0] || '';
    if (!h || ['search', 'i', 'home', 'explore', 'messages', 'hashtag', 'intent', 'settings'].includes(h.toLowerCase())) {
      return { platform, url: `https://x.com${u.pathname}${u.search}`, handle: null };
    }
    return { platform, url: `https://x.com/${h}`, handle: h };
  }
  if (platform === SurplusSocialPlatform.TIKTOK) {
    const h = parts.find((p) => p.startsWith('@'));
    if (h) return { platform, url: `https://www.tiktok.com/${h}`, handle: h.slice(1) };
    return { platform, url: `https://www.tiktok.com${u.pathname}`, handle: null };
  }
  return { platform, url: `${u.protocol}//${u.hostname}${u.pathname}${u.search}`, handle: null };
}

/**
 * The link that opens a message to the profile in the platform's own app,
 * or null where the platform has no such link and the profile itself is
 * where to write from. Facebook's m.me takes a vanity name; a numeric id
 * goes through the messages inbox. Instagram's ig.me opens the DM.
 */
export function messageUrl(p: { platform: string; handle: string | null; url: string }): string | null {
  if (!p.handle) return null;
  switch (p.platform) {
    case SurplusSocialPlatform.FACEBOOK:
      return /^\d+$/.test(p.handle) ? `https://www.facebook.com/messages/t/${p.handle}` : `https://m.me/${p.handle}`;
    case SurplusSocialPlatform.INSTAGRAM:
      return `https://ig.me/m/${p.handle}`;
    default:
      return null;
  }
}

export function platformLabel(platform: string): string {
  return SURPLUS_SOCIAL_PLATFORM_LABEL[platform as SurplusSocialPlatform] || 'Profile';
}

/**
 * One-click searches on each platform for a name, narrowed by where the
 * person is known to be. These are the sites' own search pages, the same
 * ones a person would type into; opening one is the search and the buttons
 * beside it log the result. The Google one is restricted to the social
 * sites, which is what the sites' own search often does worst.
 */
const STATE_NAMES: Record<string, string> = {
  AL: 'Alabama',
  AK: 'Alaska',
  AZ: 'Arizona',
  AR: 'Arkansas',
  CA: 'California',
  CO: 'Colorado',
  CT: 'Connecticut',
  DE: 'Delaware',
  DC: 'Washington DC',
  FL: 'Florida',
  GA: 'Georgia',
  HI: 'Hawaii',
  ID: 'Idaho',
  IL: 'Illinois',
  IN: 'Indiana',
  IA: 'Iowa',
  KS: 'Kansas',
  KY: 'Kentucky',
  LA: 'Louisiana',
  ME: 'Maine',
  MD: 'Maryland',
  MA: 'Massachusetts',
  MI: 'Michigan',
  MN: 'Minnesota',
  MS: 'Mississippi',
  MO: 'Missouri',
  MT: 'Montana',
  NE: 'Nebraska',
  NV: 'Nevada',
  NH: 'New Hampshire',
  NJ: 'New Jersey',
  NM: 'New Mexico',
  NY: 'New York',
  NC: 'North Carolina',
  ND: 'North Dakota',
  OH: 'Ohio',
  OK: 'Oklahoma',
  OR: 'Oregon',
  PA: 'Pennsylvania',
  PR: 'Puerto Rico',
  RI: 'Rhode Island',
  SC: 'South Carolina',
  SD: 'South Dakota',
  TN: 'Tennessee',
  TX: 'Texas',
  UT: 'Utah',
  VT: 'Vermont',
  VA: 'Virginia',
  WA: 'Washington',
  WV: 'West Virginia',
  WI: 'Wisconsin',
  WY: 'Wyoming',
};

/** "FL" as "Florida", the way a person types it. Anything unknown is returned as it came. */
export function stateName(code?: string | null): string {
  const c = String(code || '').trim();
  return STATE_NAMES[c.toUpperCase()] || c;
}

/**
 * `city` is the person's OWN town (the clerk's mailing address, an heir's
 * address on a filing) and never the town the property sold in: people leave,
 * which is how the property came to be sold for taxes. The searches narrow by
 * STATE, spelled out. Narrowing by town returned nothing at all for most
 * claimants (2026-09-17: "Rosemary Clark" "Leesburg" found nobody), while
 * "Rosemary Clark Florida" lists every one of them to pick from. Where the
 * person's own town is known it gets a second Facebook button, because that
 * is what found Aleric Clark in San Antonio.
 */
export function socialSearchLinks(name: string, city?: string | null, state?: string | null): NameSearchLink[] {
  const n = searchName(name);
  if (!n) return [];
  const town = titleCase(String(city || '').trim());
  const st = stateName(state);
  const withPlace = st ? `${n} ${st}` : n;
  const google =
    `"${n}"` +
    (st ? ` "${st}"` : '') +
    ' (site:facebook.com OR site:instagram.com OR site:linkedin.com OR site:x.com OR site:tiktok.com)';
  return [
    { site: 'Facebook', free: true, url: facebookSearchUrl('people', withPlace) },
    ...(town ? [{ site: `Facebook ${town}`, free: true, url: facebookSearchUrl('people', `${n} ${town}`) }] : []),
    { site: 'Google social', free: true, url: `https://www.google.com/search?q=${encodeURIComponent(google)}` },
    { site: 'Instagram', free: true, url: `https://www.instagram.com/explore/search/keyword/?q=${encodeURIComponent(n)}` },
    { site: 'LinkedIn', free: true, url: `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(withPlace)}` },
    { site: 'X', free: true, url: `https://x.com/search?q=${encodeURIComponent(`"${n}"`)}&f=user` },
    { site: 'TikTok', free: true, url: `https://www.tiktok.com/search/user?q=${encodeURIComponent(n)}` },
  ];
}

/**
 * A Facebook search that survives a browser that is not signed in.
 *
 * Signed out, Facebook answers every /search/ address with a bare nine-byte
 * "Not Found" page and no way forward, which is what the team saw on every
 * button on 2026-09-17. Its sign-in page takes the search as `next`: signed
 * in, it passes straight through to the results; signed out, it asks for the
 * sign-in and then shows them. Measured the same day: the search address
 * alone returned 404, and the sign-in address carrying it returned the page.
 */
export function facebookSearchUrl(scope: 'people' | 'top', q: string): string {
  const search = `https://www.facebook.com/search/${scope}/?q=${encodeURIComponent(q.trim())}`;
  return `https://www.facebook.com/login/?next=${encodeURIComponent(search)}`;
}

/**
 * A name the way a person types it into a social site: first name and
 * surname, in that order, in ordinary case. The docket's "CLARK, ALERIC T."
 * or "ALERIC T. CLARK JR" matches almost nothing on Facebook, whose people
 * search wants "Aleric Clark". Measured 2026-09-17 on that very claimant:
 * the docket spelling found nobody and the plain one found him first.
 */
export function searchName(raw: string): string {
  let s = String(raw || '').replace(/\s+/g, ' ').trim();
  // "CLARK, ALERIC T" is surname first. "WILLIAMS, SR" is a suffix, not that.
  const m = /^([^,]+),\s*(.+)$/.exec(s);
  if (m && !/^(SR|JR|II|III|IV|V|ESQ|ET\s*AL|ETAL|DECEASED|TRUSTEE|TR)\.?$/i.test(m[2].trim())) s = `${m[2]} ${m[1]}`;
  const { given, surname } = splitClaimantName(s);
  if (!surname) return '';
  // The first given name that is more than an initial, else whatever is there.
  const first = given.find((g) => g.length > 1) || given[0] || '';
  return titleCase([first, surname].filter(Boolean).join(' '));
}

function titleCase(v: string): string {
  return v
    .toLowerCase()
    .replace(/(^|[\s'-])([a-z])/g, (_, a, b) => `${a}${b.toUpperCase()}`)
    .replace(/\bMc([a-z])/g, (_, c) => `Mc${c.toUpperCase()}`);
}

/**
 * A search link for one lead the research turned up. A person (a spouse, a
 * relative, another name they go by) is searched for as themselves in the
 * claimant's city; an employer, a business, a school or a team is searched
 * together with the claimant's name, which is how a common name is told
 * apart from its namesakes.
 */
export function leadSearchUrl(
  lead: { kind: string; value: string },
  claimant: string,
  city?: string | null,
  state?: string | null,
): string | null {
  // A parenthetical is commentary, not something to type into a search box.
  const v = String(lead.value || '').replace(/\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim();
  if (!v) return null;
  // An age, a birth date or a loose note tells a person which profile is
  // theirs. It is not a search: "Aleric Clark Born 02/12/1980" finds nothing.
  if (lead.kind === 'age' || lead.kind === 'other' || /\d{2}/.test(v)) return null;
  const me = searchName(claimant);
  const town = titleCase(String(city || '').trim());
  if (lead.kind === 'city') {
    // The town alone: "San Antonio, TX" and "Brevard County, FL" lose the state.
    const place = titleCase(v.split(',')[0].trim());
    return place && place.toLowerCase() !== town.toLowerCase() ? facebookSearchUrl('people', `${me} ${place}`) : null;
  }
  if (['spouse', 'relative', 'alias'].includes(lead.kind)) {
    const them = searchName(v) || v;
    // Another spelling that comes out as the same search is the button above.
    if (lead.kind === 'alias' && them === me) return null;
    // By state, as the main search is: a spouse may not live where the claimant does.
    return facebookSearchUrl('people', [them, stateName(state) || town].filter(Boolean).join(' '));
  }
  return facebookSearchUrl('top', `${me} ${v}`);
}

// ─── The search itself ──────────────────────────────────────────────────────

export interface SocialCandidate {
  platform: SurplusSocialPlatform;
  url: string;
  handle: string | null;
  displayName: string | null;
  confidence: 'strong' | 'possible';
  evidence: string;
}

/** Something about the person that is not a profile but leads to one. */
export interface SocialLead {
  /** 'spouse' | 'relative' | 'alias' | 'employer' | 'business' | 'school' | 'team' | 'city' | 'age' | 'other' */
  kind: string;
  value: string;
  /** Where it came from and what it says, in a few words. */
  detail: string | null;
}

export const SOCIAL_LEAD_KINDS = ['spouse', 'relative', 'alias', 'employer', 'business', 'school', 'team', 'city', 'age', 'other'];

export interface SocialVerdict {
  profiles: SocialCandidate[];
  /** Spouse, employer, business, school: what tells this person from a namesake. */
  leads: SocialLead[];
  /** What was searched, in a sentence, so a miss says what it looked for. */
  searched: string;
  note: string | null;
}

export const SOCIAL_SYSTEM = `You find a person's public social media profiles by searching the web, and you judge whether each one is THIS person and not a namesake.

You are given a person's name, the places they are known to be tied to, sometimes their age and known relatives, and sometimes an employer. Search the public web for their profiles on Facebook, Instagram, LinkedIn, X (Twitter) and TikTok, and return the ones that are plausibly them, with the evidence.

Know the limit before you start. Facebook keeps most personal profiles out of search engines, so a person with an active Facebook often cannot be found this way at all. A colleague who is logged in to Facebook will search there by hand afterwards, and what they need from you is whatever tells THIS person from the namesakes: a spouse's name, an employer, a business they own, a school, a team they played for or coach, a nickname, the city they live in now. People-search listings, business registrations, news stories, team rosters, LinkedIn and obituaries of relatives carry these. Collect them as leads whether or not you find a profile. A search that finds no profile and three good leads is a good search.

How to search:
1. Search the full name with the word facebook and each listed city or state, for example "Aleric Clark" facebook "San Antonio". Search result snippets for Facebook profiles usually carry a "Lives in", "From" or "Works at" line and the friend count; read those.
2. Search the full name with "site:facebook.com", then "site:linkedin.com/in", then "site:instagram.com". Add the state if the name is common.
3. If a middle name or initial is given, search with and without it. Married women may use a maiden name, which the known relatives sometimes reveal.
4. Open a profile page only if the snippets leave the match undecided; many profiles will not load without a login, and that is fine. The snippets and the search result title are usually enough.
5. Do not search more than about six times. This is a shortcut for a person, not an investigation.

Evidence that ties a profile to the person:
- the name matches, including a middle name or initial when both give one, or a known nickname of the given name
- the profile says the person lives in, is from, or works in a listed city or county, or a town next to one
- a relative named in the known relatives appears on the profile, in the name (a shared unusual surname), or in the snippet
- an employer or a school on the profile fits a listed one
- the profile's photo or posts mention the property's town or the county

Confidence:
- "strong": the name matches AND a place ties it AND at least one more tie from the list. A rare full name with a place tie also counts.
- "possible": the name matches and the profile is in a listed state or the profile gives no place at all, and nothing contradicts the person (a different middle name, an age that cannot fit, a city far away with no link).
- Leave out profiles that are clearly other people, and anything that is not a personal profile (a page, a group, a post, a business).

Common names produce many profiles for other people. Offer at most five, best first. When in doubt between strong and possible, choose possible. Never invent a URL: every URL must come from a search result or a page you opened.

Finish with ONLY a JSON object, no prose after it:
{"profiles":[{"platform":"facebook|instagram|linkedin|x|tiktok|other","url":string,"displayName":string|null,"confidence":"strong|possible","evidence":"one or two sentences on what ties it to this person"}],"leads":[{"kind":"spouse|relative|alias|employer|business|school|team|city|age|other","value":"the name alone, for example Yvette Hinojosa or Devonwood Enterprizes Inc","detail":"a few words on where it came from and how sure it is"}],"searched":"one sentence on what was searched","note":string|null}
An empty profiles list is a good answer when nothing fits, as long as the leads are there. Give at most eight leads, the most identifying first. The value is what a person would type into a search box: one name per lead, never two people joined by a slash, no parentheses, no commentary (that belongs in detail). A city is the town alone, for example San Antonio. An age or a year of birth is kind "age", for example "about 45, born 1980". Do not repeat the person's own name as an alias unless it is genuinely a different name (a nickname, a maiden name). Never put a phone number, an email or a street address in a lead: those come from a verified trace, not from a listing.`;

/** Per million tokens. Cache reads are charged at the input price here, which errs high. */
const PRICES: Record<string, { in: number; out: number }> = {
  'claude-opus-5': { in: 5, out: 25 },
  'claude-sonnet-5': { in: 2, out: 10 },
};
const WEB_SEARCH_PRICE = 0.01;

export function socialSearchCost(
  usage: { input: number; output: number; searches: number },
  model: string,
): number {
  const p = PRICES[model] || PRICES['claude-opus-5'];
  return (usage.input * p.in + usage.output * p.out) / 1e6 + usage.searches * WEB_SEARCH_PRICE;
}

/**
 * The verdict out of the reply. Anything unreadable is an empty list, never
 * a guess, and a URL that does not parse as a profile is dropped: the model
 * is told never to invent one, and this is the check on that.
 */
export function parseSocialVerdict(text: string): SocialVerdict {
  const none: SocialVerdict = { profiles: [], leads: [], searched: 'The search returned nothing readable.', note: null };
  const raw = String(text || '');
  const start = raw.lastIndexOf('{"profiles"') >= 0 ? raw.lastIndexOf('{"profiles"') : raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) return none;
  let o: any;
  try {
    o = JSON.parse(raw.slice(start, end + 1));
  } catch {
    return none;
  }
  const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
  const seen = new Set<string>();
  const profiles: SocialCandidate[] = [];
  for (const p of Array.isArray(o?.profiles) ? o.profiles : []) {
    const parsed = parseProfileUrl(String(p?.url || ''));
    if (!parsed || !parsed.handle || seen.has(parsed.url)) continue;
    const confidence = p?.confidence === 'strong' ? 'strong' : p?.confidence === 'possible' ? 'possible' : null;
    if (!confidence) continue;
    seen.add(parsed.url);
    profiles.push({
      platform: parsed.platform,
      url: parsed.url,
      handle: parsed.handle,
      displayName: str(p?.displayName),
      confidence,
      evidence: str(p?.evidence) || '',
    });
    if (profiles.length >= 5) break;
  }
  const leads: SocialLead[] = [];
  const seenLead = new Set<string>();
  for (const l of Array.isArray(o?.leads) ? o.leads : []) {
    const raw = str(l?.value);
    if (!raw || raw.length > 120) continue;
    // A listing's phone, email or street address is not a lead. The trace verifies those.
    if (/@|\d{3}[\s.)-]*\d{3}[\s.-]*\d{4}|^\d+\s+\w+/.test(raw)) continue;
    const kind = SOCIAL_LEAD_KINDS.includes(l?.kind) ? l.kind : 'other';
    // "Charina Clark / Charito Clark" is two people, and each is its own search.
    const values = ['spouse', 'relative', 'alias'].includes(kind) ? raw.split(/\s+(?:\/|or)\s+/i) : [raw];
    for (const value of values.map((x: string) => x.trim()).filter(Boolean)) {
      const key = `${kind}|${value.toLowerCase()}`;
      if (seenLead.has(key) || leads.length >= 8) continue;
      seenLead.add(key);
      leads.push({ kind, value, detail: str(l?.detail) });
    }
    if (leads.length >= 8) break;
  }
  return { profiles, leads, searched: str(o?.searched) || 'Searched the public web.', note: str(o?.note) };
}

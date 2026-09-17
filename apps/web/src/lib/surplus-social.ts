/**
 * Social profiles on a surplus claim. Mirrors SurplusSocialPlatform and
 * SurplusSocialProfileStatus in packages/shared/src/types.ts, duplicated for
 * the same reason as surplus-calls.ts (Vercel builds the web app without the
 * shared dist).
 */
export const SURPLUS_SOCIAL_PLATFORMS: [string, string][] = [
  ['facebook', 'Facebook'],
  ['instagram', 'Instagram'],
  ['linkedin', 'LinkedIn'],
  ['x', 'X'],
  ['tiktok', 'TikTok'],
  ['other', 'Other'],
];

export function socialPlatformLabel(platform: string): string {
  return SURPLUS_SOCIAL_PLATFORMS.find(([k]) => k === platform)?.[1] || 'Profile';
}

export interface SocialProfile {
  id: string;
  /** Set when the profile belongs to an heir or an associate rather than the claimant. */
  heirId: string | null;
  personName: string | null;
  platform: string;
  platformLabel: string;
  url: string;
  handle: string | null;
  displayName: string | null;
  /** 'candidate' | 'confirmed' | 'rejected' */
  status: string;
  /** 'strong' | 'possible' when the search offered it; null when added by hand. */
  confidence: string | null;
  evidence: string | null;
  /** 'manual' | 'search' */
  foundBy: string;
  messageCount: number;
  lastMessagedAt: string | null;
  /** Opens a message in the platform's own app, where the platform has such a link. */
  messageUrl: string | null;
}

/**
 * The opener for a first message through a profile. Short, because a
 * message request from a stranger is read on a phone in one glance, and
 * it says who is writing before it says why. Deliberately does NOT state
 * the amount or the county: the fund source is not disclosed before the
 * agreement, and a stranger's inbox is the last place to name a figure.
 */
export function socialOpener(claimant: string, sender: string, company: string, phone: string | null): string {
  const first = claimant.split(/\s+/)[0] || claimant;
  const who = first.charAt(0).toUpperCase() + first.slice(1).toLowerCase();
  return (
    `Hi ${who}, my name is ${sender} with ${company}. ` +
    `We help people recover money that is being held for them by a county after a property sale, and our research shows some may be owed to you. ` +
    `There is no cost to find out. ` +
    (phone ? `Call or text me at ${phone}, or reply here, and I will explain.` : `Reply here and I will explain.`)
  );
}

/**
 * One-click searches for a person, the same ones the API builds for the
 * claimant, for the people around them whose rows load separately.
 */
export function socialSearchLinks(name: string, city?: string | null, state?: string | null): { site: string; url: string }[] {
  const n = searchName(name);
  if (!n) return [];
  // The city alone: Facebook ranks a state abbreviation against names.
  const town = titleCase(String(city || '').trim());
  const withPlace = town ? `${n} ${town}` : state ? `${n} ${String(state).trim()}` : n;
  const google =
    `"${n}"` +
    (town ? ` "${town}"` : state ? ` ${String(state).trim()}` : '') +
    ' (site:facebook.com OR site:instagram.com OR site:linkedin.com OR site:x.com OR site:tiktok.com)';
  return [
    { site: 'Facebook', url: `https://www.facebook.com/search/people/?q=${encodeURIComponent(withPlace)}` },
    { site: 'Google social', url: `https://www.google.com/search?q=${encodeURIComponent(google)}` },
    { site: 'Instagram', url: `https://www.instagram.com/explore/search/keyword/?q=${encodeURIComponent(n)}` },
    { site: 'LinkedIn', url: `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(withPlace)}` },
  ];
}

function titleCase(v: string): string {
  return v
    .toLowerCase()
    .replace(/(^|[\s'-])([a-z])/g, (_, a, b) => `${a}${b.toUpperCase()}`)
    .replace(/\bMc([a-z])/g, (_, c) => `Mc${c.toUpperCase()}`);
}

const NAME_NOISE = new Set(['ESTATE', 'OF', 'THE', 'DECEASED', 'DECD', 'EST', 'SR', 'JR', 'II', 'III', 'IV', 'ESQ', 'ET', 'AL', 'ETAL', 'TRUSTEE', 'TR']);

/**
 * A name the way a person types it into a social site: first name and
 * surname, ordinary case. Mirrors searchName in the API's
 * surplus-social.util.ts. "ALERIC T. CLARK" finds nobody on Facebook and
 * "Aleric Clark" finds him first.
 */
export function searchName(raw: string): string {
  let s = String(raw || '').replace(/\s+/g, ' ').trim();
  const m = /^([^,]+),\s*(.+)$/.exec(s);
  if (m && !NAME_NOISE.has(m[2].replace(/[^A-Za-z]/g, '').toUpperCase())) s = `${m[2]} ${m[1]}`;
  const parts = s
    .replace(/\([^)]*\)/g, ' ')
    .split(/[^A-Za-z'-]+/)
    .filter((t) => t && !NAME_NOISE.has(t.toUpperCase()));
  while (parts.length > 1 && parts[parts.length - 1].length === 1) parts.pop();
  if (!parts.length) return '';
  if (parts.length === 1) return titleCase(parts[0]);
  const given = parts.slice(0, -1);
  const first = given.find((g) => g.length > 1) || given[0];
  return titleCase(`${first} ${parts[parts.length - 1]}`);
}

export const SOCIAL_LEAD_LABEL: Record<string, string> = {
  spouse: 'Spouse',
  relative: 'Relative',
  alias: 'Also known as',
  employer: 'Employer',
  business: 'Business',
  school: 'School',
  team: 'Team',
  city: 'City',
  other: 'Lead',
};

// ─── Save to Dealcore: the bookmarklet and the card it saves to ─────────────

/**
 * Which card a profile found in another tab belongs to. Written whenever
 * somebody works the "online" block on a card, read by the attach page the
 * bookmarklet opens. Per browser, which is right: it is that person's search.
 */
export interface SocialTarget {
  leadId: string;
  heirId: string | null;
  /** Who the profile would be attached to. */
  label: string;
  /** County and case, so a wrong card is caught before it is saved to. */
  sub: string | null;
  at: string;
}

const TARGET_KEY = 'dc_social_target';

export function rememberSocialTarget(t: Omit<SocialTarget, 'at'>): void {
  try {
    localStorage.setItem(TARGET_KEY, JSON.stringify({ ...t, at: new Date().toISOString() }));
  } catch {
    // Private mode or a full store: the attach page falls back to a search.
  }
}

/** The remembered card, unless it is more than a day old. */
export function readSocialTarget(): SocialTarget | null {
  try {
    const t = JSON.parse(localStorage.getItem(TARGET_KEY) || 'null');
    if (!t?.leadId || !t?.at) return null;
    if (Date.now() - new Date(t.at).getTime() > 24 * 3600 * 1000) return null;
    return t as SocialTarget;
  } catch {
    return null;
  }
}

/**
 * The bookmarklet. Clicked on somebody's profile page, it opens a small
 * Dealcore window carrying that page's address and title. It reads nothing
 * else from the page and sends nothing to anybody but Dealcore.
 */
export function saveToDealcoreBookmarklet(origin: string): string {
  const base = `${origin}/surplus-funds/attach-profile`;
  return (
    'javascript:(function(){' +
    `var u='${base}?url='+encodeURIComponent(location.href)+'&title='+encodeURIComponent(document.title);` +
    "var w=window.open(u,'dcattach','width=520,height=680');if(!w){location.href=u;}" +
    '})();'
  );
}

/** "(3) Aleric Clark | Facebook" as "Aleric Clark". */
export function nameFromPageTitle(title: string): string | null {
  const t = String(title || '')
    .replace(/^\(\d+\+?\)\s*/, '')
    .replace(/\s*[|•·-]\s*(Facebook|Instagram|LinkedIn|X|TikTok).*$/i, '')
    .replace(/\s*\(@[^)]+\).*$/, '')
    .trim();
  return t && t.length <= 80 && !/^(facebook|instagram|linkedin|log in|sign up)/i.test(t) ? t : null;
}

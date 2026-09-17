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
  const n = String(name || '').replace(/\s+/g, ' ').trim();
  if (!n) return [];
  const where = [city, state].map((v) => String(v || '').trim()).filter(Boolean).join(' ');
  const withPlace = where ? `${n} ${where}` : n;
  const google =
    `"${n}"` +
    (city ? ` "${String(city).trim()}"` : state ? ` ${String(state).trim()}` : '') +
    ' (site:facebook.com OR site:instagram.com OR site:linkedin.com OR site:x.com OR site:tiktok.com)';
  return [
    { site: 'Facebook', url: `https://www.facebook.com/search/people/?q=${encodeURIComponent(withPlace)}` },
    { site: 'Google social', url: `https://www.google.com/search?q=${encodeURIComponent(google)}` },
    { site: 'Instagram', url: `https://www.instagram.com/explore/search/keyword/?q=${encodeURIComponent(n)}` },
    { site: 'LinkedIn', url: `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(withPlace)}` },
  ];
}

import { facebookSearchUrl, leadSearchUrl, messageUrl, parseProfileUrl, parseSocialVerdict, searchName, socialSearchCost, socialSearchLinks } from './surplus-social.util';

/**
 * Profile links as people paste them and as search results carry them. The
 * parser decides the platform, the canonical URL (which is the dedupe key)
 * and the handle the message link is built from, so a sloppy paste and a
 * clean one must land on the same row.
 */
describe('parseProfileUrl', () => {
  it('reads a Facebook vanity profile in every form it is pasted', () => {
    for (const raw of [
      'https://www.facebook.com/aleric.clark',
      'facebook.com/aleric.clark/',
      'https://m.facebook.com/aleric.clark?mibextid=ZbWKwL',
      'https://m.me/aleric.clark',
    ]) {
      expect(parseProfileUrl(raw)).toEqual({ platform: 'facebook', url: 'https://www.facebook.com/aleric.clark', handle: 'aleric.clark' });
    }
  });
  it('reads the numeric Facebook forms to one URL', () => {
    const want = { platform: 'facebook', url: 'https://www.facebook.com/profile.php?id=100012345678901', handle: '100012345678901' };
    expect(parseProfileUrl('https://www.facebook.com/profile.php?id=100012345678901&sk=about')).toEqual(want);
    expect(parseProfileUrl('https://www.facebook.com/people/Aleric-Clark/100012345678901/')).toEqual(want);
  });
  it('a Facebook search or group page is kept but has no handle to message', () => {
    expect(parseProfileUrl('https://www.facebook.com/search/people/?q=aleric')?.handle).toBeNull();
    expect(parseProfileUrl('https://www.facebook.com/groups/12345')?.handle).toBeNull();
  });
  it('reads Instagram, LinkedIn, X and TikTok', () => {
    expect(parseProfileUrl('https://www.instagram.com/presley.clark/?hl=en')).toEqual({ platform: 'instagram', url: 'https://www.instagram.com/presley.clark/', handle: 'presley.clark' });
    expect(parseProfileUrl('https://ig.me/m/presley.clark')?.handle).toBe('presley.clark');
    expect(parseProfileUrl('https://www.linkedin.com/in/aleric-clark-1a2b3c/')).toEqual({ platform: 'linkedin', url: 'https://www.linkedin.com/in/aleric-clark-1a2b3c/', handle: 'aleric-clark-1a2b3c' });
    expect(parseProfileUrl('https://twitter.com/aclark')).toEqual({ platform: 'x', url: 'https://x.com/aclark', handle: 'aclark' });
    expect(parseProfileUrl('https://www.tiktok.com/@aclark?lang=en')).toEqual({ platform: 'tiktok', url: 'https://www.tiktok.com/@aclark', handle: 'aclark' });
  });
  it('keeps an unknown site as other, and refuses what is not an address', () => {
    expect(parseProfileUrl('https://www.nextdoor.com/profile/123')?.platform).toBe('other');
    expect(parseProfileUrl('')).toBeNull();
    expect(parseProfileUrl('aleric clark')).toBeNull();
    expect(parseProfileUrl('not a url at all')).toBeNull();
  });
});

describe('messageUrl', () => {
  it('a vanity Facebook profile messages through m.me, a numeric one through the inbox', () => {
    expect(messageUrl({ platform: 'facebook', handle: 'aleric.clark', url: '' })).toBe('https://m.me/aleric.clark');
    expect(messageUrl({ platform: 'facebook', handle: '100012345678901', url: '' })).toBe('https://www.facebook.com/messages/t/100012345678901');
    expect(messageUrl({ platform: 'instagram', handle: 'presley.clark', url: '' })).toBe('https://ig.me/m/presley.clark');
  });
  it('LinkedIn, X and TikTok have no message link: the profile is where to write from', () => {
    expect(messageUrl({ platform: 'linkedin', handle: 'x', url: '' })).toBeNull();
    expect(messageUrl({ platform: 'facebook', handle: null, url: '' })).toBeNull();
  });
});

/** The search a Facebook link lands on, out of the sign-in address that carries it. */
function fb(url: string): string {
  const next = new URL(url).searchParams.get('next');
  return decodeURIComponent(next || '');
}

describe('facebookSearchUrl', () => {
  it('goes through the sign-in page, because a signed-out search is a bare Not Found', () => {
    const u = facebookSearchUrl('people', ' Aleric Clark San Antonio ');
    expect(u.startsWith('https://www.facebook.com/login/?next=https%3A%2F%2Fwww.facebook.com%2Fsearch%2Fpeople%2F')).toBe(true);
    expect(fb(u)).toBe('https://www.facebook.com/search/people/?q=Aleric Clark San Antonio');
  });
});

describe('socialSearchLinks', () => {
  it('searches every platform, narrowed by the city where one is known', () => {
    const links = socialSearchLinks('ALERIC T. CLARK', 'SAN ANTONIO', 'TX');
    expect(links.map((l) => l.site)).toEqual(['Facebook', 'Facebook San Antonio', 'Google social', 'Instagram', 'LinkedIn', 'X', 'TikTok']);
    // By state, spelled out, so every namesake in it is listed to pick from.
    expect(fb(links[0].url)).toBe('https://www.facebook.com/search/people/?q=Aleric Clark Texas');
    // His own town, off the clerk's mailing address: what found him by hand.
    expect(fb(links[1].url)).toBe('https://www.facebook.com/search/people/?q=Aleric Clark San Antonio');
    expect(decodeURIComponent(links[2].url)).toContain('"Aleric Clark" "Texas" (site:facebook.com');
  });
  it('with no town of their own, the state alone: never the town the property sold in', () => {
    // "Rosemary Clark" "Leesburg" found nobody on 2026-09-17.
    const links = socialSearchLinks('ROSEMARY CLARK', null, 'FL');
    expect(links.map((l) => l.site)).toEqual(['Facebook', 'Google social', 'Instagram', 'LinkedIn', 'X', 'TikTok']);
    expect(fb(links[0].url)).toBe('https://www.facebook.com/search/people/?q=Rosemary Clark Florida');
    expect(decodeURIComponent(links[1].url)).toContain('"Rosemary Clark" "Florida" (site:facebook.com');
    expect(decodeURIComponent(links[3].url)).toContain('keywords=Rosemary Clark Florida');
    expect(links.every((l) => l.free)).toBe(true);
  });
  it('nothing for no name', () => {
    expect(socialSearchLinks('')).toEqual([]);
  });
});

describe('searchName', () => {
  it('is the first name and the surname, the way a person types it', () => {
    expect(searchName('ALERIC T. CLARK')).toBe('Aleric Clark');
    expect(searchName('CLARK, ALERIC T')).toBe('Aleric Clark');
    expect(searchName('JOHNNY LOVE WILLIAMS, SR')).toBe('Johnny Williams');
    expect(searchName('Estate of Odessa Rainwater')).toBe('Odessa Rainwater');
    expect(searchName('J ROBERT MCDONALD')).toBe('Robert McDonald');
    expect(searchName('')).toBe('');
  });
});

describe('leadSearchUrl', () => {
  it('a spouse is searched as themselves in the city, an employer with the claimant', () => {
    expect(fb(leadSearchUrl({ kind: 'spouse', value: 'Yvette Hinojosa' }, 'ALERIC T. CLARK', 'SAN ANTONIO', 'TX')!)).toBe(
      'https://www.facebook.com/search/people/?q=Yvette Hinojosa Texas',
    );
    expect(fb(leadSearchUrl({ kind: 'spouse', value: 'Yvette Hinojosa' }, 'ALERIC T. CLARK', 'SAN ANTONIO')!)).toBe(
      'https://www.facebook.com/search/people/?q=Yvette Hinojosa San Antonio',
    );
    expect(fb(leadSearchUrl({ kind: 'business', value: 'Devonwood Enterprizes Inc' }, 'ALERIC T. CLARK', 'SAN ANTONIO')!)).toBe(
      'https://www.facebook.com/search/top/?q=Aleric Clark Devonwood Enterprizes Inc',
    );
    expect(leadSearchUrl({ kind: 'other', value: ' ' }, 'X Y')).toBeNull();
  });
  it('the leads from the first live search: no button for a birth date, a repeat of his own name, or his own city', () => {
    const me = 'ALERIC T. CLARK';
    expect(leadSearchUrl({ kind: 'other', value: 'Born 02/12/1980 (age ~45)' }, me, 'SAN ANTONIO')).toBeNull();
    expect(leadSearchUrl({ kind: 'age', value: 'about 45' }, me, 'SAN ANTONIO')).toBeNull();
    expect(leadSearchUrl({ kind: 'alias', value: 'Aleric T Clark' }, me, 'SAN ANTONIO')).toBeNull();
    expect(leadSearchUrl({ kind: 'city', value: 'San Antonio, TX (78253, far west side / Sweetwater Way)' }, me, 'SAN ANTONIO')).toBeNull();
    expect(fb(leadSearchUrl({ kind: 'city', value: 'Brevard County, FL' }, me, 'SAN ANTONIO')!)).toBe(
      'https://www.facebook.com/search/people/?q=Aleric Clark Brevard County',
    );
    expect(fb(leadSearchUrl({ kind: 'alias', value: 'Al Clark' }, me, 'SAN ANTONIO')!)).toContain('q=Al Clark San Antonio');
  });
});

describe('parseSocialVerdict', () => {
  const found = {
    profiles: [
      { platform: 'facebook', url: 'https://www.facebook.com/aleric.clark', displayName: 'Aleric Clark', confidence: 'strong', evidence: 'Lives in San Antonio, Texas; works at All Restoration Remodeling.' },
      { platform: 'facebook', url: 'https://www.facebook.com/aleric.clark/', displayName: 'Aleric Clark', confidence: 'strong', evidence: 'duplicate' },
      { platform: 'instagram', url: 'https://www.instagram.com/presley.clark/', displayName: 'Presley', confidence: 'possible', evidence: 'Shares the surname.' },
      { platform: 'facebook', url: 'https://www.facebook.com/search/people/?q=aleric', confidence: 'strong', evidence: 'a search page, not a profile' },
      { platform: 'facebook', url: 'https://www.facebook.com/somebody', confidence: 'maybe', evidence: 'bad confidence' },
    ],
    leads: [
      { kind: 'spouse', value: 'Yvette Hinojosa', detail: 'people-search listing' },
      { kind: 'spouse', value: 'yvette hinojosa', detail: 'duplicate' },
      { kind: 'business', value: 'Devonwood Enterprizes Inc', detail: 'listed as president' },
      { kind: 'nonsense', value: 'Texas Wild Hogs', detail: null },
      { kind: 'relative', value: 'Charina Clark / Charito Clark', detail: 'family' },
      { kind: 'other', value: '(210) 371-9175', detail: 'a phone is not a lead' },
      { kind: 'other', value: '12 Oak Ln', detail: 'nor is an address' },
    ],
    searched: 'Searched Facebook and Instagram for Aleric Clark in San Antonio.',
    note: null,
  };
  it('keeps the leads, deduped, and drops a phone or a street address', () => {
    const v = parseSocialVerdict(JSON.stringify({ ...found, profiles: [] }));
    expect(v.profiles).toEqual([]);
    expect(v.leads).toEqual([
      { kind: 'spouse', value: 'Yvette Hinojosa', detail: 'people-search listing' },
      { kind: 'business', value: 'Devonwood Enterprizes Inc', detail: 'listed as president' },
      { kind: 'other', value: 'Texas Wild Hogs', detail: null },
      { kind: 'relative', value: 'Charina Clark', detail: 'family' },
      { kind: 'relative', value: 'Charito Clark', detail: 'family' },
    ]);
  });
  it('reads the JSON after the prose, dedupes by canonical URL, drops pages and bad confidence', () => {
    const v = parseSocialVerdict(`I searched.\n${JSON.stringify(found)}`);
    expect(v.profiles.map((p) => p.url)).toEqual(['https://www.facebook.com/aleric.clark', 'https://www.instagram.com/presley.clark/']);
    expect(v.profiles[0]).toMatchObject({ handle: 'aleric.clark', confidence: 'strong', displayName: 'Aleric Clark' });
    expect(v.searched).toContain('Searched Facebook');
  });
  it('anything unreadable is an empty list, never a guess', () => {
    expect(parseSocialVerdict('no json here').profiles).toEqual([]);
    expect(parseSocialVerdict('no json here').leads).toEqual([]);
    expect(parseSocialVerdict('{"profiles":"nope"}').profiles).toEqual([]);
    expect(parseSocialVerdict('{"profiles":[]}').searched).toBe('Searched the public web.');
  });
});

describe('socialSearchCost', () => {
  it('prices tokens by model and adds the searches', () => {
    expect(socialSearchCost({ input: 40000, output: 1000, searches: 6 }, 'claude-opus-5')).toBeCloseTo(0.285, 3);
    expect(socialSearchCost({ input: 40000, output: 1000, searches: 6 }, 'claude-sonnet-5')).toBeCloseTo(0.15, 3);
  });
});

import { messageUrl, parseProfileUrl, parseSocialVerdict, socialSearchCost, socialSearchLinks } from './surplus-social.util';

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

describe('socialSearchLinks', () => {
  it('searches every platform, narrowed by the city where one is known', () => {
    const links = socialSearchLinks('Aleric T Clark', 'San Antonio', 'TX');
    expect(links.map((l) => l.site)).toEqual(['Facebook', 'Google social', 'Instagram', 'LinkedIn', 'X', 'TikTok']);
    expect(links[0].url).toContain(encodeURIComponent('Aleric T Clark San Antonio TX'));
    expect(decodeURIComponent(links[1].url)).toContain('"Aleric T Clark" "San Antonio" (site:facebook.com');
    expect(links.every((l) => l.free)).toBe(true);
  });
  it('nothing for no name', () => {
    expect(socialSearchLinks('')).toEqual([]);
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
    searched: 'Searched Facebook and Instagram for Aleric Clark in San Antonio.',
    note: null,
  };
  it('reads the JSON after the prose, dedupes by canonical URL, drops pages and bad confidence', () => {
    const v = parseSocialVerdict(`I searched.\n${JSON.stringify(found)}`);
    expect(v.profiles.map((p) => p.url)).toEqual(['https://www.facebook.com/aleric.clark', 'https://www.instagram.com/presley.clark/']);
    expect(v.profiles[0]).toMatchObject({ handle: 'aleric.clark', confidence: 'strong', displayName: 'Aleric Clark' });
    expect(v.searched).toContain('Searched Facebook');
  });
  it('anything unreadable is an empty list, never a guess', () => {
    expect(parseSocialVerdict('no json here').profiles).toEqual([]);
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

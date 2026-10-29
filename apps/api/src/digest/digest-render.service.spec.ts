import { DigestRenderService } from './digest-render.service';
import { DigestBrief } from './digest.types';

/**
 * The renderer is pure, so a hand-written brief pins what each section puts
 * in front of the reader. The brief is a surplus action email: these pin the
 * sections that carry it and the wholesale line that replaced four sections.
 */
function brief(over: Partial<DigestBrief> = {}): DigestBrief {
  return {
    organizationId: 'org1',
    generatedAt: new Date('2026-10-13T11:00:00Z'),
    dateLabel: 'Tuesday, October 13, 2026',
    timeLabel: '7:00 AM ET',
    greetingName: 'Geoff',
    greetingPrefix: 'Good morning',
    subject: 'Dealcore Daily: test',
    preheader: '',
    bigThing: null,
    scorecard: [],
    calls: [],
    callsTotal: 0,
    promises: [],
    promisesTotal: 0,
    needsTrace: null,
    inFlight: [],
    inFlightTotal: 0,
    inFlightFees: '$0',
    surplusIngestNote: null,
    surplusOpeningSoonNote: null,
    feedProblems: [],
    feedSummary: null,
    countyListsDue: [],
    touchesDue: null,
    wholesale: null,
    appUrl: 'https://mydealcore.com',
    isEmpty: false,
    ...over,
  };
}

describe('DigestRenderService', () => {
  const render = new DigestRenderService();

  it('leads with the big thing and never prints "Why it matters"', () => {
    const b = brief({
      bigThing: {
        key: 'surplus-person:brevard|douglas garcia',
        short: 'Call Douglas Garcia ($16.4K, 2 cases)',
        headline: 'Douglas Garcia is owed $16,414 across 2 Brevard County cases and nobody has called.',
        lines: ['2480 KEEGAN CIR SW, PALM BAY · case 250809 · $8,738', 'Open, nothing filed on either. 2 clean numbers.'],
        flag: null,
        repeatNote: 'Led the previous brief too and still has not been called.',
        ctaLabel: 'Open claimant',
        ctaUrl: 'https://mydealcore.com/leads/a',
        phone: '(321) 555-0142',
      },
    });
    const html = render.renderHtml(b);
    expect(html).toContain('1 big thing');
    expect(html).toContain('Douglas Garcia is owed $16,414');
    expect(html).toContain('case 250809');
    expect(html).toContain('Led the previous brief too');
    expect(html).toContain('tel:3215550142');
    expect(html).not.toContain('Why it matters');

    const text = render.renderText(b);
    expect(text).toContain('1 BIG THING');
    expect(text).toContain('Call (321) 555-0142');
    expect(text).not.toContain('Why it matters');
  });

  it('flags an unconfirmed match on the big thing and the call list', () => {
    const flag = 'Likely match, not confirmed: confirm who you are speaking to first.';
    const b = brief({
      bigThing: {
        key: 'surplus-person:citrus|a burpee priscilla',
        short: 'Call Priscilla A Burpee ($36.2K)',
        headline: 'Priscilla A Burpee is owed $36,194 by Citrus County and nobody has called.',
        lines: [],
        flag,
        repeatNote: null,
        ctaLabel: 'Open claimant',
        ctaUrl: 'https://mydealcore.com/leads/p',
      },
      calls: [
        { name: 'Janet Acuna', amount: '$8,738', detail: 'Brevard County case 250809.', flag, phone: null, url: 'https://mydealcore.com/leads/j', urgency: 'warn' },
      ],
      callsTotal: 3,
    });
    const html = render.renderHtml(b);
    expect(html.split(flag).length - 1).toBe(2);
    expect(html).toContain('Then call these');
    expect(html).toContain('1. Janet Acuna &middot; $8,738');
    expect(html).toContain('Open the full call list (3)');
  });

  it('lists promises owed with how late each one is', () => {
    const b = brief({
      promises: [
        { title: 'Check for a reply to the letter to DAVID G KELLY', detail: null, when: '5 days late · Ian', url: 'https://mydealcore.com/leads/k', urgency: 'critical' },
      ],
      promisesTotal: 11,
    });
    const html = render.renderHtml(b);
    expect(html).toContain('Promises due');
    expect(html).toContain('11 owed to claimants');
    expect(html).toContain('5 days late · Ian');
    expect(html).toContain('10 more on the board.');
    expect(render.renderText(b)).toContain('PROMISES DUE (11)');
  });

  it('surfaces the claimants nobody has traced', () => {
    const b = brief({ needsTrace: { total: 42, byCounty: 'Citrus 28 · Alachua 10 · Lee 2 · Santa Rosa 2' } });
    const html = render.renderHtml(b);
    expect(html).toContain('42 live claimants have never been traced');
    expect(html).toContain('Citrus 28');
    expect(render.renderText(b)).toContain('NEEDS A SKIP TRACE');
  });

  it('shows stuck claims in flight, or one line when nothing is stuck', () => {
    const stuck = render.renderHtml(brief({
      inFlightTotal: 3,
      inFlightFees: '$12.4K',
      inFlight: [
        { claimant: 'Mary Surdi', stage: 'Claim Filed', note: 'Filed 38 days ago, the county has not acknowledged it', fee: '$4,100', url: 'https://mydealcore.com/leads/m', urgency: 'warn' },
      ],
    }));
    expect(stuck).toContain('Claims in flight');
    expect(stuck).toContain('3 claims · $12.4K in fees · 1 stuck');
    expect(stuck).toContain('Filed 38 days ago');

    const moving = render.renderHtml(brief({ inFlightTotal: 2, inFlightFees: '$8.0K' }));
    expect(moving).toContain('Nothing stuck. Every signed claim is moving.');
  });

  it('collapses healthy feeds to one line and keeps a failed one in red', () => {
    const b = brief({
      feedSummary: '11 other county feeds healthy: 6,442 scanned, 42 new on their last pulls.',
      feedProblems: [
        { label: 'Lee County', schedule: 'weekly, Monday 4:30am ET', detail: 'Did not run this morning. Last ran Mon 10/5 at 4:30am.', urgency: 'critical' },
      ],
    });
    const html = render.renderHtml(b);
    expect(html).toContain('Coming up');
    expect(html).toContain('11 other county feeds healthy');
    expect(html).toMatch(/color:#dc2626;">Did not run this morning/);
    expect(html).not.toContain('Duval County');

    const text = render.renderText(b);
    expect(text).toContain('Lee County (weekly, Monday 4:30am ET): Did not run this morning.');
  });

  it('lists a county whose list is due under Coming up, even on a quiet day', () => {
    const b = brief({
      countyListsDue: [
        { label: 'Marion list', schedule: 'monthly, by email', detail: 'UPDATE DUE Sun 10/25, 4 days late. Never asked.', urgency: 'warn' },
      ],
    });
    const html = render.renderHtml(b);
    expect(html).toContain('Coming up');
    expect(html).toContain('Marion list');
    expect(html).toContain('UPDATE DUE Sun 10/25');
    expect(render.renderText(b)).toContain('Marion list (monthly, by email): UPDATE DUE Sun 10/25, 4 days late. Never asked.');
  });

  it('shows the touches due today with a link to the outreach list', () => {
    const b = brief({ touchesDue: { people: 3, cases: 2, line: '3 people on 2 files with nothing tried in 7 days or more.' } });
    const html = render.renderHtml(b);
    expect(html).toContain('Touches due today');
    expect(html).toContain('/surplus-funds/outreach?due=1');
    expect(render.renderText(b)).toContain('TOUCHES DUE TODAY\n  3 people on 2 files with nothing tried in 7 days or more.');
  });

  it('puts wholesaling on one line at the bottom', () => {
    const b = brief({ wholesale: '1 reply waiting (oldest 7d 16h) · 4 contracts past close date' });
    const html = render.renderHtml(b);
    expect(html).toContain('Wholesale, parked:');
    expect(html).toContain('4 contracts past close date');
    expect(render.renderText(b)).toContain('Wholesale, parked: 1 reply waiting (oldest 7d 16h) · 4 contracts past close date.');
  });

  it('drops every section when there is nothing to say', () => {
    const html = render.renderHtml(brief());
    for (const label of ['1 big thing', 'Surplus scorecard', 'Call these', 'Promises due', 'Needs a skip trace', 'Claims in flight', 'Coming up', 'Wholesale, parked']) {
      expect(html).not.toContain(label);
    }
  });
});

import { DigestRenderService } from './digest-render.service';
import { DigestBrief } from './digest.types';

/**
 * The renderer is pure, so a hand-written brief pins what the new sections
 * put in front of the reader. These exist because the Daily Brief had no
 * surplus content at all and no way to tell whether a county pull ran.
 */
function brief(over: Partial<DigestBrief> = {}): DigestBrief {
  return {
    organizationId: 'org1',
    generatedAt: new Date('2026-09-07T11:00:00Z'),
    dateLabel: 'Monday, September 7, 2026',
    timeLabel: '7:00 AM ET',
    greetingName: 'Geoff',
    greetingPrefix: 'Good morning',
    marketLabel: null,
    subject: 'Dealcore Daily: test',
    preheader: '',
    bigThing: null,
    board: [],
    actions: [],
    waiting: [],
    waitingTotal: 0,
    dealsInMotion: [],
    dealsTotalFee: '$0',
    foreclosures: [],
    foreclosureIngestNote: null,
    foreclosureTooLateNote: null,
    foreclosureOpenTotal: 0,
    newOvernight: [],
    newOvernightTotal: 0,
    surplus: [],
    surplusOpenTotal: 0,
    surplusCallableTotal: 0,
    surplusIngestNote: null,
    surplusOverdue: [],
    surplusOverdueTotal: 0,
    feeds: [],
    yesterday: [],
    news: [],
    appUrl: 'https://mydealcore.com',
    isEmpty: false,
    ...over,
  };
}

describe('DigestRenderService, surplus and county feeds', () => {
  const render = new DigestRenderService();

  it('lists surplus claimants worth calling, with the board link', () => {
    const b = brief({
      surplus: [
        {
          claimant: 'ROBERT E PITTARD',
          property: '2502 34TH ST SW, LEHIGH ACRES',
          facts: 'Lee County · case 2025002173 · $32,054 surplus · Open, nothing filed',
          status: 'Never contacted. Open, nothing filed, 3 callable numbers',
          url: 'https://mydealcore.com/leads/abc',
          urgency: 'critical',
        },
      ],
      surplusOpenTotal: 238,
      surplusCallableTotal: 57,
      surplusIngestNote: '24 claimants landed from Lee, $312.4K of surplus between them.',
    });
    const html = render.renderHtml(b);
    expect(html).toContain('Surplus funds');
    expect(html).toContain('ROBERT E PITTARD');
    expect(html).toContain('3 callable numbers');
    expect(html).toContain('57 of 238 open claimants have a live number');
    expect(html).toContain('24 claimants landed from Lee');
    expect(html).toContain('https://mydealcore.com/surplus-funds');

    const text = render.renderText(b);
    expect(text).toContain('SURPLUS FUNDS');
    expect(text).toContain('ROBERT E PITTARD - 2502 34TH ST SW, LEHIGH ACRES');
    expect(text).toContain('Overnight: 24 claimants landed from Lee');
  });

  it('reports every county feed, and a failed one in red', () => {
    const b = brief({
      feeds: [
        { label: 'Duval County', schedule: 'daily, 5:45am ET', detail: 'Ran 5:45am in under a minute: 441 scanned · 0 new · 71 updated · 21 retired.', urgency: 'neutral' },
        { label: 'Lee County', schedule: 'weekly, Monday 4:30am ET', detail: 'Did not run this morning. Last ran Mon 8/31 at 4:30am.', urgency: 'critical' },
      ],
    });
    const html = render.renderHtml(b);
    expect(html).toContain('County feeds');
    expect(html).toContain('Duval County');
    expect(html).toContain('Did not run this morning');
    // The failed line takes the critical accent colour so it cannot be skimmed past.
    expect(html).toMatch(/color:#dc2626;line-height:1\.5;">Did not run this morning/);

    const text = render.renderText(b);
    expect(text).toContain('COUNTY FEEDS');
    expect(text).toContain('Lee County (weekly, Monday 4:30am ET): Did not run this morning.');
  });

  it('keeps the surplus totals on a day with nobody new to call', () => {
    // The board still holds work; a section that vanishes reads as none.
    const html = render.renderHtml(brief({ surplusOpenTotal: 238, surplusCallableTotal: 57 }));
    expect(html).toContain('Surplus funds');
    expect(html).toContain('57 of 238 open claimants have a live number');
  });

  it('drops both sections when there is nothing to say', () => {
    const html = render.renderHtml(brief());
    expect(html).not.toContain('Surplus funds');
    expect(html).not.toContain('County feeds');
  });
});

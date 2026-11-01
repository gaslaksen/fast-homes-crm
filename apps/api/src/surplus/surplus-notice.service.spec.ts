import { ConfigService } from '@nestjs/config';
import sharp from 'sharp';
import {
  SurplusNoticeService,
  dropBlankPages,
  isClerkAddress,
  isNearBlank,
  noticeReadCost,
  usageOf,
} from './surplus-notice.service';

/** A prisma with just the meter, recording every upsert. */
function meter(row: { calls: number; spend: number } | null = null) {
  const upserts: any[] = [];
  const prisma: any = {
    vendorUsage: {
      findUnique: jest.fn().mockResolvedValue(row),
      upsert: jest.fn(async (a: any) => { upserts.push(a); return {}; }),
    },
  };
  return { prisma, upserts };
}

const svc = () => new SurplusNoticeService({ get: () => undefined } as unknown as ConfigService, meter().prisma);

/**
 * A live service with the API behind a fake NoticeReaderClient. `reply` is
 * what the model says; `usage` what the API bills.
 */
function live(
  env: Record<string, string> = {},
  reply: any = { text: '{"recipients":[]}', usage: { inputTokens: 10000, outputTokens: 500 } },
  row: { calls: number; spend: number } | null = null,
) {
  const vars: Record<string, string> = { ANTHROPIC_API_KEY: 'test', ...env };
  const { prisma, upserts } = meter(row);
  const s = new SurplusNoticeService({ get: (k: string) => vars[k] } as any, prisma);
  const read = typeof reply === 'function' ? jest.fn(reply) : jest.fn().mockResolvedValue(reply);
  (s as any).client = { model: s.model, read };
  return { s, read, prisma, upserts };
}

/**
 * The golden fixture: exactly what Duval document 85553 says. Read off the page
 * by hand so the parser is pinned to a real notice rather than an invented one.
 * The property on this case is a vacant lot in Jacksonville; the owner is in
 * Connecticut, which is the entire reason this extraction exists.
 */
const MYRTIS_GRIFFIN = JSON.stringify({
  recipient: 'MYRTIS GRIFFIN',
  street: '72 SMITH DRIVE',
  city: 'HARTFORD',
  state: 'CT',
  zip: '06118',
  noticeDate: '2025-07-01',
  saleDate: '2025-06-11',
  surplusAtNotice: 8752.78,
  certificateNumber: '06672',
  taxDeedNumber: '250024',
  realEstateNumber: '050871-0000',
});

describe('SurplusNoticeService.parse', () => {
  it('reads the real Duval notice for case 2025-0023TD', () => {
    const r = svc().parse(MYRTIS_GRIFFIN)!;
    expect(r.recipient).toBe('MYRTIS GRIFFIN');
    expect(r.street).toBe('72 SMITH DRIVE');
    expect(r.city).toBe('HARTFORD');
    expect(r.state).toBe('CT');
    expect(r.zip).toBe('06118');
    // The clock we were previously estimating from the sale date. The estimate
    // would have been 20 days early.
    expect(r.noticeDate).toBe('2025-07-01');
    expect(r.saleDate).toBe('2025-06-11');
    // Against $8,611.05 posted on the case today.
    expect(r.surplusAtNotice).toBe(8752.78);
  });

  it('survives a code fence and surrounding prose', () => {
    const r = svc().parse('Here you go:\n```json\n' + MYRTIS_GRIFFIN + '\n```\nHope that helps.');
    expect(r?.city).toBe('HARTFORD');
  });

  it('accepts the US date format if the model echoes the page verbatim', () => {
    const r = svc().parse(JSON.stringify({ noticeDate: '7/1/2025', saleDate: '6/11/2025' }))!;
    expect(r.noticeDate).toBe('2025-07-01');
    expect(r.saleDate).toBe('2025-06-11');
  });

  it('normalises money written with a symbol and commas', () => {
    expect(svc().parse(JSON.stringify({ surplusAtNotice: '$8,752.78' }))!.surplusAtNotice)
      .toBe(8752.78);
  });

  it('keeps a five digit ZIP and drops a plus four', () => {
    const r = svc().parse(
      JSON.stringify({ recipients: [{ name: 'ELLA CLOWERS ESTATE', street: '2866 W 11TH ST', zip: '32254-1923' }] }),
    )!;
    expect(r.zip).toBe('32254');
  });

  it('turns a string "null" into a real null rather than the word', () => {
    const r = svc().parse(JSON.stringify({ recipient: 'null', street: '', city: null }))!;
    expect(r.recipient).toBeNull();
    expect(r.street).toBeNull();
    expect(r.city).toBeNull();
  });

  it('rejects a date it cannot parse instead of inventing one', () => {
    expect(svc().parse(JSON.stringify({ noticeDate: 'July 1st' }))!.noticeDate).toBeNull();
  });

  it('returns null for a reply with no JSON at all', () => {
    expect(svc().parse('I could not read this document.')).toBeNull();
    expect(svc().parse('')).toBeNull();
  });

  it('returns null for malformed JSON rather than throwing', () => {
    expect(svc().parse('{ "recipient": "X", ')).toBeNull();
  });

  describe('the one wrong answer the layout invites', () => {
    it('discards the clerk letterhead if it comes back as the addressee', () => {
      // The clerk's block sits at the top of the page, larger than the
      // addressee block. It is a perfectly valid address, so a wrong read here
      // fails silently and would send every lead to the courthouse.
      const r = svc().parse(
        JSON.stringify({
          recipient: 'JODY PHILLIPS',
          street: '501 W ADAMS ST, ROOM 1046',
          city: 'JACKSONVILLE',
          state: 'FL',
          zip: '32202',
          surplusAtNotice: 8752.78,
        }),
      )!;
      expect(r.street).toBeNull();
      expect(r.recipient).toBeNull();
      // Non-address fields on the same read are still trustworthy.
      expect(r.surplusAtNotice).toBe(8752.78);
    });

    it('does not discard a genuine owner address in Jacksonville', () => {
      // Plenty of owners really are in Jacksonville, including on the two
      // notices where the mailing address IS the property.
      const r = svc().parse(
        JSON.stringify({
          recipient: 'ELLA CLOWERS ESTATE',
          street: '2866 W 11TH ST',
          city: 'JACKSONVILLE',
          state: 'FL',
          zip: '32254',
        }),
      )!;
      expect(r.street).toBe('2866 W 11TH ST');
    });
  });
});

describe('isClerkAddress', () => {
  it('matches the Duval clerk in either spelling', () => {
    expect(isClerkAddress('501 W ADAMS ST', 'JACKSONVILLE')).toBe(true);
    expect(isClerkAddress('501 WEST ADAMS STREET', 'Jacksonville')).toBe(true);
    expect(isClerkAddress('501 W Adams St, Room 1046', null)).toBe(true);
  });

  it('matches the Charlotte clerk, whose letterhead tops the notice', () => {
    expect(isClerkAddress('350 E. MARION AVE', 'PUNTA GORDA')).toBe(true);
    expect(isClerkAddress('350 East Marion Avenue', 'Punta Gorda')).toBe(true);
    expect(isClerkAddress('350 E MARION AVE', null)).toBe(true);
  });

  it('does not match an unrelated address', () => {
    expect(isClerkAddress('72 SMITH DRIVE', 'HARTFORD')).toBe(false);
    expect(isClerkAddress('1350 E MARION AVE', 'PUNTA GORDA')).toBe(false);
    expect(isClerkAddress('2866 W 11TH ST', 'JACKSONVILLE')).toBe(false);
    expect(isClerkAddress('', '')).toBe(false);
  });
});

describe('one page per recipient', () => {
  /**
   * Duval document 103369, verbatim. Case 2026-0006TD is co-owned and the
   * clerk printed a page each for Richard Minton and Cecelia W Harris. Reading
   * only the first and applying it to the whole property gives one claimant the
   * other's address, and then skip traces them at it.
   */
  const BESSENT = JSON.stringify({
    recipients: [
      { name: 'RICHARD MINTON', street: '4027 BESSENT ROAD', city: 'JACKSONVILLE', state: 'FL', zip: '32218' },
      { name: 'CECELIA W HARRIS', street: '4027 BESSENT ROAD', city: 'JACKSONVILLE', state: 'FL', zip: '32218' },
    ],
    noticeDate: '2026-06-25',
    saleDate: '2026-06-10',
    surplusAtNotice: 105670.33,
  });

  it('returns every addressee, not just the first', () => {
    const r = svc().parse(BESSENT)!;
    expect(r.recipients.map((x) => x.name)).toEqual(['RICHARD MINTON', 'CECELIA W HARRIS']);
  });

  it('keeps both when co-owners share one address', () => {
    // They are still two claimants filing two claims.
    const r = svc().parse(BESSENT)!;
    expect(r.recipients).toHaveLength(2);
  });

  it('keeps co-owners at DIFFERENT addresses apart', () => {
    const r = svc().parse(
      JSON.stringify({
        recipients: [
          { name: 'HOWARD MARTIN', street: '1228 ADEE AVENUE', city: 'BRONX', state: 'NY', zip: '10469' },
          { name: 'RAYMOND SOLOMON', street: '90 MAIN ST', city: 'ALBANY', state: 'NY', zip: '12207' },
        ],
      }),
    )!;
    expect(r.recipients[0].city).toBe('BRONX');
    expect(r.recipients[1].city).toBe('ALBANY');
  });

  it('drops a page that only carries the clerk letterhead', () => {
    const r = svc().parse(
      JSON.stringify({
        recipients: [
          { name: 'JODY PHILLIPS', street: '501 W ADAMS ST', city: 'JACKSONVILLE', state: 'FL', zip: '32202' },
          { name: 'RICHARD MINTON', street: '4027 BESSENT ROAD', city: 'JACKSONVILLE', state: 'FL', zip: '32218' },
        ],
      }),
    )!;
    expect(r.recipients).toHaveLength(1);
    expect(r.recipients[0].name).toBe('RICHARD MINTON');
  });

  it('still reads an older single-recipient reply', () => {
    const r = svc().parse(
      JSON.stringify({ recipient: 'MYRTIS GRIFFIN', street: '72 SMITH DRIVE', city: 'HARTFORD', state: 'CT', zip: '06118' }),
    )!;
    expect(r.recipients).toHaveLength(1);
    expect(r.street).toBe('72 SMITH DRIVE');
  });
});

describe('Charlotte notices', () => {
  it('reads 25-0952, one owner noticed at two Ontario addresses, without inventing ZIPs', () => {
    // Read off the 4-page TIFF by hand: notice, proof of claim, notice, proof of claim.
    const r = svc().parse(
      JSON.stringify({
        recipients: [
          { name: 'PICCIOLO, GIUSEPPE', street: '1500 STEELES AVENUE WEST UNIT 614', city: 'THORNHILL', state: 'ONTARIO', zip: 'L4J 4H6' },
          { name: 'PICCIOLO, GIUSEPPE', street: '3431 DORCAS STREET', city: 'MISSISSAUGA', state: 'ONTARIO', zip: 'L4T 1M9' },
        ],
        noticeDate: '2026-01-29',
        saleDate: '2026-01-27',
        surplusAtNotice: 5905.69,
        certificateNumber: '202-2718',
        taxDeedNumber: '25-0952',
      }),
    )!;
    expect(r.recipients).toHaveLength(2);
    expect(r.recipients.map((x) => x.city)).toEqual(['THORNHILL', 'MISSISSAUGA']);
    // Kept as printed and marked Canadian. Digits stripped out of "L4T 1M9"
    // would be "419", and "ONTARIO" cut to two letters is "ON".
    expect(r.recipients.map((x) => [x.state, x.zip, x.country])).toEqual([
      ['ONTARIO', 'L4J 4H6', 'CANADA'],
      ['ONTARIO', 'L4T 1M9', 'CANADA'],
    ]);
    expect(r.country).toBe('CANADA');
    expect(r.noticeDate).toBe('2026-01-29');
  });

  it('never files France as a US state when the reader names the country', () => {
    const r = svc().parse(
      JSON.stringify({
        recipients: [{ name: 'GROLL, PASCAL', street: '12 CHEMIN X', city: 'MALAUCENE', state: null, zip: '84440', country: 'FRANCE' }],
      }),
    )!;
    expect(r.recipients[0]).toMatchObject({ state: null, zip: '84440', country: 'FRANCE' });
  });

  it('sends a scanned TIFF as one PNG per page, since the API takes no TIFF', async () => {
    // Two PRINTED pages: a white page would be dropped as blank, rightly.
    const svg = Buffer.from('<svg width="850" height="1100" xmlns="http://www.w3.org/2000/svg"><rect x="80" y="120" width="690" height="400" fill="#000"/></svg>');
    const page = () => sharp({ create: { width: 850, height: 1100, channels: 3, background: '#ffffff' } }).composite([{ input: svg }]).png().toBuffer();
    const tiff = await sharp([await page(), await page()], { join: { animated: true } }).tiff().toBuffer();
    const { s, read } = live();

    await s.readNoticeFile({ data: tiff, contentType: 'image/tiff' }, 'test');

    const content = read.mock.calls[0][0];
    const images = content.filter((b: any) => b.type === 'image');
    expect(images).toHaveLength(2);
    expect(images[0].source.media_type).toBe('image/png');
    expect(content.some((b: any) => b.type === 'document')).toBe(false);
  });

  it('counts a billed reply with no JSON as a read that named nobody', async () => {
    // Null would mean "try again next poll", and this reply was paid for.
    const { s } = live({}, { text: 'I could not read this document.', usage: { inputTokens: 10000, outputTokens: 50 } });

    const r = await s.readNoticeFile({ data: Buffer.from('%PDF-1.4 test'), contentType: 'application/pdf' }, 'test');

    expect(r).not.toBeNull();
    expect(r!.recipients).toEqual([]);
    expect(r!.street).toBeNull();
  });

  it('returns null when the API call itself fails, so it is tried again', async () => {
    const { s, upserts } = live({}, () => Promise.reject(new Error('overloaded')));

    const r = await s.readNoticeFile({ data: Buffer.from('%PDF-1.4 test'), contentType: 'application/pdf' }, 'test');

    expect(r).toBeNull();
    // And nothing was billed, so nothing is metered.
    expect(upserts).toHaveLength(0);
  });

  it('still sends a PDF as a document', async () => {
    const { s, read } = live();

    await s.readNoticeFile({ data: Buffer.from('%PDF-1.4 test'), contentType: 'application/octet-stream' }, 'test');

    const content = read.mock.calls[0][0];
    expect(content[0].type).toBe('document');
    expect(content[0].source.media_type).toBe('application/pdf');
  });
});

/**
 * Fewer pixels. A duplex scan's empty backs carry no addressee, so they are
 * dropped before upload. A printed page, even a blank Proof of Claim FORM,
 * carries ink and is kept: the prompt's one-page-per-recipient rule needs it.
 */
describe('dropping near-blank pages', () => {
  const W = 850;
  const H = 1100;
  const white = () => sharp({ create: { width: W, height: H, channels: 3, background: '#ffffff' } }).png().toBuffer();
  /** Eight black bars across the page, the way lines of text read to a scanner. */
  const printed = async () => {
    const bars = Array.from({ length: 8 }, (_, i) => `<rect x="80" y="${120 + i * 60}" width="690" height="14" fill="#000"/>`);
    const svg = Buffer.from(`<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">${bars.join('')}</svg>`);
    return sharp(await white()).composite([{ input: svg }]).png().toBuffer();
  };
  /** A speck of dust on an otherwise empty page. */
  const smudged = async () => {
    const svg = Buffer.from(`<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg"><rect x="400" y="500" width="6" height="6" fill="#000"/></svg>`);
    return sharp(await white()).composite([{ input: svg }]).png().toBuffer();
  };

  it('tells a blank page from a printed one by its greyscale statistics', async () => {
    expect(await isNearBlank(await white())).toBe(true);
    expect(await isNearBlank(await smudged())).toBe(true);
    expect(await isNearBlank(await printed())).toBe(false);
  });

  it('drops the blank pages and keeps the printed ones in order', async () => {
    const pages = [await printed(), await white(), await printed(), await smudged()];

    const { kept, dropped } = await dropBlankPages(pages);

    expect(dropped).toBe(2);
    expect(kept).toEqual([pages[0], pages[2]]);
  });

  it('always keeps at least one page, so an all-blank scan is still a billed read that is not bought again', async () => {
    const pages = [await white(), await white()];

    const { kept, dropped } = await dropBlankPages(pages);

    expect(kept).toHaveLength(1);
    expect(dropped).toBe(1);
  });

  it('sends only the printed pages of a scanned TIFF', async () => {
    const tiff = await sharp([await printed(), await white(), await printed()], { join: { animated: true } }).tiff().toBuffer();
    const { s, read } = live();

    await s.readNoticeFile({ data: tiff, contentType: 'image/tiff' }, 'test');

    expect(read.mock.calls[0][0].filter((b: any) => b.type === 'image')).toHaveLength(2);
  });
});

/**
 * Metering. Every read is a call and its dollars on vendor_usage, costed from
 * the tokens the API reports at the configured per-million prices.
 */
describe('metering a read', () => {
  it('prices a read from its tokens', () => {
    expect(noticeReadCost({ inputTokens: 1_000_000, outputTokens: 0 }, { input: 5, output: 25 })).toBe(5);
    expect(noticeReadCost({ inputTokens: 20000, outputTokens: 400 }, { input: 5, output: 25 })).toBeCloseTo(0.11, 6);
  });

  it('bills cache writes and reads as input, erring high', () => {
    expect(usageOf({ input_tokens: 100, cache_creation_input_tokens: 50, cache_read_input_tokens: 25, output_tokens: 7 }))
      .toEqual({ inputTokens: 175, outputTokens: 7 });
    expect(usageOf(undefined)).toEqual({ inputTokens: 0, outputTokens: 0 });
  });

  it('records every read under vendor "notice" with its cost at the default prices', async () => {
    const { s, upserts } = live({}, { text: '{"recipients":[]}', usage: { inputTokens: 20000, outputTokens: 400 } });

    await s.readNoticeFile({ data: Buffer.from('%PDF-1.4 test'), contentType: 'application/pdf' }, 'test');

    expect(upserts).toHaveLength(1);
    expect(upserts[0].where.vendor_period.vendor).toBe('notice');
    expect(upserts[0].create.calls).toBe(1);
    expect(upserts[0].create.spend).toBeCloseTo(0.11, 6);
    expect(upserts[0].update.spend.increment).toBeCloseTo(0.11, 6);
  });

  it('takes the per-million prices from the environment', async () => {
    const { s, upserts } = live(
      { SURPLUS_NOTICE_INPUT_PRICE: '4', SURPLUS_NOTICE_OUTPUT_PRICE: '20' },
      { text: '{"recipients":[]}', usage: { inputTokens: 1_000_000, outputTokens: 100_000 } },
    );

    await s.readNoticeFile({ data: Buffer.from('%PDF-1.4 test'), contentType: 'application/pdf' }, 'test');

    expect(upserts[0].create.spend).toBeCloseTo(6, 6);
  });

  it('still counts a billed reply that named nobody', async () => {
    const { s, upserts } = live({}, { text: 'Sorry.', usage: { inputTokens: 5000, outputTokens: 10 } });

    await s.readNoticeFile({ data: Buffer.from('%PDF-1.4 test'), contentType: 'application/pdf' }, 'test');

    expect(upserts).toHaveLength(1);
  });

  it('reports the month in the shape the obituary search does', async () => {
    const { s } = live({}, undefined, { calls: 12, spend: 1.2345 });

    const u = await s.usage();

    expect(u).toMatchObject({ checks: 12, spent: 1.23, budget: 0, paused: false, left: null });
    expect(u.period).toMatch(/^\d{4}-\d{2}$/);
  });
});

/**
 * The monthly budget. Unset means no cap, which is how the reader always ran.
 * Set, it pauses reads when the month cannot cover one more at the worst case.
 */
describe('the monthly budget', () => {
  it('reads without limit when no budget is set', async () => {
    const { s, read } = live({}, undefined, { calls: 500, spend: 900 });

    await s.readNoticeFile({ data: Buffer.from('%PDF-1.4 test'), contentType: 'application/pdf' }, 'test');

    expect(read).toHaveBeenCalledTimes(1);
    expect(await s.canSpend()).toEqual({ ok: true });
  });

  it('pauses, without calling the API, when the month cannot cover one more read', async () => {
    const { s, read, upserts } = live({ SURPLUS_NOTICE_MONTHLY_BUDGET: '20' }, undefined, { calls: 90, spend: 19.9 });

    const r = await s.readNoticeFile({ data: Buffer.from('%PDF-1.4 test'), contentType: 'application/pdf' }, 'test');

    expect(r).toBeNull();
    expect(read).not.toHaveBeenCalled();
    expect(upserts).toHaveLength(0);
    const check = await s.canSpend();
    expect(check.ok).toBe(false);
    expect(check.reason).toMatch(/paused.*\$19\.9 of the \$20/);
    expect((await s.usage()).paused).toBe(true);
    expect((await s.usage()).left).toBeCloseTo(0.1, 6);
  });

  it('reads while the month has room', async () => {
    const { s, read } = live({ SURPLUS_NOTICE_MONTHLY_BUDGET: '20' }, undefined, { calls: 10, spend: 2 });

    await s.readNoticeFile({ data: Buffer.from('%PDF-1.4 test'), contentType: 'application/pdf' }, 'test');

    expect(read).toHaveBeenCalledTimes(1);
    expect((await s.usage()).paused).toBe(false);
  });

  it('says why when the key is missing', async () => {
    const check = await svc().canSpend();
    expect(check.ok).toBe(false);
    expect(check.reason).toMatch(/ANTHROPIC_API_KEY/);
  });
});

describe('settings', () => {
  it('reads claude-opus-5 unless SURPLUS_NOTICE_MODEL says otherwise', () => {
    expect(live().s.model).toBe('claude-opus-5');
    expect(live({ SURPLUS_NOTICE_MODEL: 'claude-opus-5-5' }).s.model).toBe('claude-opus-5-5');
  });

  it('reads at estimated day 95 unless SURPLUS_NOTICE_READ_DAY says otherwise', () => {
    expect(live().s.readDay).toBe(95);
    expect(live({ SURPLUS_NOTICE_READ_DAY: '80' }).s.readDay).toBe(80);
    expect(live({ SURPLUS_NOTICE_READ_DAY: 'soon' }).s.readDay).toBe(95);
  });

  it('prices at the claude-opus-5 list prices unless told otherwise', () => {
    expect(live().s.prices).toEqual({ input: 5, output: 25 });
    expect(live({ SURPLUS_NOTICE_INPUT_PRICE: '0', SURPLUS_NOTICE_OUTPUT_PRICE: '-1' }).s.prices).toEqual({ input: 5, output: 25 });
  });
});

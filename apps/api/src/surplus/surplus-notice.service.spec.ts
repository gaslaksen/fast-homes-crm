import { ConfigService } from '@nestjs/config';
import sharp from 'sharp';
import { SurplusNoticeService, isClerkAddress } from './surplus-notice.service';

const svc = () => new SurplusNoticeService({ get: () => undefined } as unknown as ConfigService);

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
    // Digits stripped out of "L4T 1M9" would be "419".
    expect(r.recipients.map((x) => x.zip)).toEqual([null, null]);
    expect(r.noticeDate).toBe('2026-01-29');
  });

  it('sends a scanned TIFF as one PNG per page, since the API takes no TIFF', async () => {
    const page = () => sharp({ create: { width: 850, height: 1100, channels: 3, background: '#ffffff' } }).png().toBuffer();
    const tiff = await sharp([await page(), await page()], { join: { animated: true } }).tiff().toBuffer();
    const create = jest.fn().mockResolvedValue({ content: [{ type: 'text', text: '{"recipients":[]}' }] });
    const s = new SurplusNoticeService({ get: (k: string) => (k === 'ANTHROPIC_API_KEY' ? 'test' : undefined) } as any);
    (s as any).anthropic = { messages: { create } };

    await s.readNoticeFile({ data: tiff, contentType: 'image/tiff' }, 'test');

    const content = create.mock.calls[0][0].messages[0].content;
    const images = content.filter((b: any) => b.type === 'image');
    expect(images).toHaveLength(2);
    expect(images[0].source.media_type).toBe('image/png');
    expect(content.some((b: any) => b.type === 'document')).toBe(false);
  });

  it('still sends a PDF as a document', async () => {
    const create = jest.fn().mockResolvedValue({ content: [{ type: 'text', text: '{"recipients":[]}' }] });
    const s = new SurplusNoticeService({ get: (k: string) => (k === 'ANTHROPIC_API_KEY' ? 'test' : undefined) } as any);
    (s as any).anthropic = { messages: { create } };

    await s.readNoticeFile({ data: Buffer.from('%PDF-1.4 test'), contentType: 'application/octet-stream' }, 'test');

    const content = create.mock.calls[0][0].messages[0].content;
    expect(content[0].type).toBe('document');
    expect(content[0].source.media_type).toBe('application/pdf');
  });
});

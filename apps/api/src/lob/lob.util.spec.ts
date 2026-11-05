import { createHmac } from 'crypto';
import {
  LOB_HTML_MAX,
  lobAddressFrom,
  lobLetterEvent,
  lobErrorMessage,
  lobLetterHtml,
  lobModeOf,
  lobReturnAddress,
  verifyLobSignature,
} from './lob.util';
import { DIG_DEEPER_BRAND } from '../common/company.constants';

describe('lobModeOf', () => {
  it('reads the environment off a secret key and refuses a publishable one', () => {
    expect(lobModeOf('test_abc')).toBe('test');
    expect(lobModeOf('live_abc')).toBe('live');
    expect(lobModeOf('test_pub_abc')).toBeNull();
    expect(lobModeOf('live_pub_abc')).toBeNull();
    expect(lobModeOf('')).toBeNull();
    expect(lobModeOf(undefined)).toBeNull();
  });
});

describe('lobAddressFrom', () => {
  it('splits a one-line US address, a unit after a comma going on line two', () => {
    const r = lobAddressFrom('Jane Doe', '12 Oak St, Apt 4, Tampa, FL 33602');
    expect(r).toEqual({
      address: {
        name: 'Jane Doe',
        address_line1: '12 Oak St',
        address_line2: 'Apt 4',
        address_city: 'Tampa',
        address_state: 'FL',
        address_zip: '33602',
        address_country: 'US',
      },
    });
  });

  it('drops a trailing USA and keeps a long name to 40 characters', () => {
    const r: any = lobAddressFrom('A'.repeat(50), '9 Elm Rd, Ocala, FL 34470, USA');
    expect(r.address.address_city).toBe('Ocala');
    expect(r.address.name).toHaveLength(40);
  });

  it('says why a foreign or partial address cannot go', () => {
    expect(lobAddressFrom('X', '1 Main St')).toEqual({ reason: expect.stringMatching(/not a US/) });
    expect(lobAddressFrom('X', '10 Rue X, Paris, 75001, FRANCE')).toEqual({ reason: expect.any(String) });
    expect(lobAddressFrom('', '12 Oak St, Tampa, FL 33602')).toEqual({ reason: 'no name to address it to' });
    expect(lobAddressFrom('X', `${'9'.repeat(51)} Oak St, Tampa, FL 33602`)).toEqual({ reason: expect.stringMatching(/50 characters/) });
  });
});

describe('lobReturnAddress', () => {
  it('reads the company address with the state written out', () => {
    expect(lobReturnAddress(DIG_DEEPER_BRAND.companyName, DIG_DEEPER_BRAND.address)).toEqual({
      name: 'D.I.G. Deeper LLC',
      address_line1: '7901 4th St N',
      address_line2: 'Suite 300',
      address_city: 'St. Petersburg',
      address_state: 'FL',
      address_zip: '33702',
      address_country: 'US',
    });
  });
});

describe('lobLetterHtml', () => {
  it('escapes the text and keeps the address area at the top empty', () => {
    const html = lobLetterHtml({ companyName: 'D.I.G. Deeper LLC', phone: '(904) 595-9620', body: 'Dear <Jane> & co', propertyAddress: '1 Main St' });
    expect(html).toContain('Dear &lt;Jane&gt; &amp; co');
    // 0.75in repeating top row plus 2.45in on the first page: text starts 3.2in down.
    expect(html).toContain('.top{height:0.75in}');
    expect(html).toContain('.first{height:2.45in}');
    expect(html).toContain('Re: 1 Main St');
    expect(html.length).toBeLessThan(LOB_HTML_MAX);
  });
});

describe('verifyLobSignature', () => {
  const body = '{"id":"evt_1"}';
  const ts = '1730800000000';
  const sig = createHmac('sha256', 'whsec').update(`${ts}.${body}`).digest('hex');
  it('accepts Lob\'s HMAC of the timestamp and the raw body', () => {
    expect(verifyLobSignature('whsec', ts, Buffer.from(body), sig)).toBe(true);
  });
  it('refuses a different body, secret, timestamp or a missing header', () => {
    expect(verifyLobSignature('whsec', ts, '{"id":"evt_2"}', sig)).toBe(false);
    expect(verifyLobSignature('other', ts, body, sig)).toBe(false);
    expect(verifyLobSignature('whsec', '1', body, sig)).toBe(false);
    expect(verifyLobSignature('whsec', ts, body, undefined)).toBe(false);
  });
});

describe('lobLetterEvent', () => {
  it('maps the letter steps and ignores everything else', () => {
    expect(lobLetterEvent('letter.in_transit')).toEqual({ step: 'in_transit', event: { kind: 'status', status: 'in_transit' } });
    expect(lobLetterEvent('letter.delivered').event.kind).toBe('delivered');
    expect(lobLetterEvent('letter.certified.delivered').event.kind).toBe('delivered');
    expect(lobLetterEvent('letter.returned_to_sender').event.kind).toBe('returned');
    expect(lobLetterEvent('letter.deleted').event.kind).toBe('cancelled');
    expect(lobLetterEvent('letter.return_envelope.in_transit').event.kind).toBe('ignore');
    expect(lobLetterEvent('postcard.delivered').event.kind).toBe('ignore');
    expect(lobLetterEvent(undefined).event.kind).toBe('ignore');
  });
});

describe('lobLetterHtml layout', () => {
  it('puts the margins in the page, since Lob ignores @page margins', () => {
    const html = lobLetterHtml({ companyName: 'X', phone: '1', body: 'a' });
    expect(html).toContain('@page{size:8.5in 11in;margin:0}');
    expect(html).toContain('td{padding:0 1in;');
    expect(html).toMatch(/<thead>.*class="top".*<\/thead><tfoot>.*class="bot".*<\/tfoot>/);
  });

  it('makes each paragraph a row and keeps line breaks inside one', () => {
    const html = lobLetterHtml({ companyName: 'X', phone: '1', body: 'Nov 5\n\nJane Doe\n12 Oak St\n\n\nDear Jane,\r\n\r\nThanks.\n' });
    const paras = [...html.matchAll(/<div class="p">([\s\S]*?)<\/div>/g)].map((m) => m[1]);
    expect(paras).toEqual(['Nov 5', 'Jane Doe\n12 Oak St', 'Dear Jane,', 'Thanks.']);
  });
});

describe('lobErrorMessage', () => {
  it('turns a strictness refusal into what to do, and leaves other errors alone', () => {
    expect(lobErrorMessage("The 'to' address does not meet your minimum deliverability strictness.", null)).toMatch(/^USPS does not list this as a deliverable address/);
    expect(lobErrorMessage('anything', 'FAILED_DELIVERABILITY_STRICTNESS')).toMatch(/vacant lot/);
    expect(lobErrorMessage('Unauthorized', null)).toBe('Unauthorized');
  });
});

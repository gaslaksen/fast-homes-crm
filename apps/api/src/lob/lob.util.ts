import { createHmac, timingSafeEqual } from 'crypto';
import { splitOneLineUsAddress, usStateCode } from '../surplus/surplus-address.util';

/**
 * Lob, the mail house. These are the pure pieces: the address Lob wants,
 * the HTML page it prints, the webhook signature, and what an event means.
 * LobService does the calls.
 */

export type LobMode = 'test' | 'live';

/** A secret key's environment, from its prefix. A publishable key cannot create letters. */
export function lobModeOf(key?: string | null): LobMode | null {
  const k = String(key || '').trim();
  if (/^test_pub/i.test(k) || /^live_pub/i.test(k)) return null;
  if (/^test_/i.test(k)) return 'test';
  if (/^live_/i.test(k)) return 'live';
  return null;
}

export interface LobAddress {
  name: string;
  address_line1: string;
  address_line2?: string;
  address_city: string;
  address_state: string;
  address_zip: string;
  address_country: 'US';
}

/** Lob's limits: a name of 40 characters, the two street lines 50 together. */
export const LOB_NAME_MAX = 40;
export const LOB_STREET_MAX = 50;

const US_SUFFIX = /,?\s*(USA|U\.S\.A\.|US|U\.S\.|UNITED STATES(?: OF AMERICA)?)\s*$/i;

/**
 * One line ("12 Oak St, Apt 4, Tampa, FL 33602") as the address Lob prints,
 * or why it cannot go. Lob is US mail here: a foreign address stays on paper.
 */
export function lobAddressFrom(name: string, line: string): { address: LobAddress } | { reason: string } {
  const who = String(name || '').replace(/\s+/g, ' ').trim();
  if (!who) return { reason: 'no name to address it to' };
  const raw = String(line || '').replace(/\s+/g, ' ').trim().replace(US_SUFFIX, '');
  if (!raw) return { reason: 'no address' };
  const parts = splitOneLineUsAddress(raw);
  if (!parts) return { reason: 'the address is not a US street, city, state and ZIP' };
  // A street that came in with a unit after a comma goes on two lines.
  let line1 = parts.street;
  let line2 = '';
  const comma = parts.street.lastIndexOf(',');
  if (comma > 0) {
    line1 = parts.street.slice(0, comma).trim();
    line2 = parts.street.slice(comma + 1).trim();
  }
  if (line1.length + line2.length > LOB_STREET_MAX) {
    return { reason: `the street is longer than the ${LOB_STREET_MAX} characters Lob allows` };
  }
  return {
    address: {
      name: who.length > LOB_NAME_MAX ? who.slice(0, LOB_NAME_MAX).trim() : who,
      address_line1: line1,
      ...(line2 ? { address_line2: line2 } : {}),
      address_city: parts.city,
      address_state: parts.state,
      address_zip: parts.zip,
      address_country: 'US',
    },
  };
}

/** The company's own address ("7901 4th St N, Suite 300, St. Petersburg, Florida 33702") as the return address. */
export function lobReturnAddress(companyName: string, line?: string | null): LobAddress | null {
  const raw = String(line || '').trim();
  // The brand writes the state out; the splitter wants a code.
  const m = /^(.*),\s*([A-Za-z .]+?)\s+(\d{5}(?:-\d{4})?)$/.exec(raw);
  if (!m) return null;
  const state = usStateCode(m[2].split(',').pop() || '');
  const head = m[1];
  const lastComma = head.lastIndexOf(',');
  if (!state || lastComma < 0) return null;
  const r = lobAddressFrom(companyName, `${head.slice(0, lastComma)}, ${head.slice(lastComma + 1).trim()}, ${state} ${m[3].slice(0, 5)}`);
  return 'address' in r ? r.address : null;
}

function esc(s: string): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Lob's letter template (8.5 x 11, #10 double window envelope) prints a
 * white box 3.15in wide and 2in high, 0.6in from the left and 0.84in from
 * the top, over whatever is there, and the window shows 0.63in to 4.63in
 * across down to 2.71in. So the first page keeps its top 3.2in empty on the
 * left, the letterhead sits to the right of the window, and the text starts
 * below it. A 0.5in box in the bottom left corner carries Lob's barcode,
 * with a serial number strip running up the left edge above it.
 *
 * Lob prints the page edge to edge and ignores @page margins (the first
 * proof on 2026-11-05 ran the text from the left edge of the paper into
 * the serial strip). So every margin is in the page itself: the text sits
 * in a table whose cells are padded 1in each side, and an empty header and
 * footer row, which a browser repeats on every printed page, give a second
 * page its top and bottom margin. Each paragraph is its own row so a long
 * letter breaks between paragraphs.
 */
export const LOB_BODY_TOP_IN = 3.2;
export const LOB_SIDE_IN = 1;
export const LOB_PAGE_TOP_IN = 0.75;
export const LOB_PAGE_BOTTOM_IN = 0.9;

export interface LobLetterInput {
  companyName: string;
  phone: string;
  website?: string | null;
  propertyAddress?: string | null;
  body: string;
}

export function lobLetterHtml(l: LobLetterInput): string {
  const contact = [l.phone, l.website].filter(Boolean).map((s) => esc(String(s))).join(' &middot; ');
  // Paragraphs on blank lines; single line breaks inside one (an address block) stay.
  const paragraphs = String(l.body ?? '')
    .replace(/\r\n?/g, '\n')
    .split(/\n[ \t]*\n+/)
    .map((p) => p.replace(/^\n+|\n+$/g, ''))
    .filter((p) => p.trim().length > 0);
  const rows = paragraphs.map((p) => `<tr><td><div class="p">${esc(p)}</div></td></tr>`).join('');
  return `<html><head><meta charset="UTF-8"><style>
@page{size:8.5in 11in;margin:0}
html,body{margin:0;padding:0}
body{position:relative;width:8.5in;font-family:Georgia,'Times New Roman',serif;font-size:11.5pt;line-height:1.45;color:#111}
.lh{position:absolute;top:0.6in;right:${LOB_SIDE_IN}in;width:2.6in;text-align:right}
.co{font-size:14pt;font-weight:bold}
.sm{font-size:9pt;color:#444}
.re{font-size:9pt;color:#444;margin-top:0.12in}
table{width:8.5in;border-collapse:collapse;table-layout:fixed}
td{padding:0 ${LOB_SIDE_IN}in;vertical-align:top}
tr{page-break-inside:avoid;break-inside:avoid}
.top{height:${LOB_PAGE_TOP_IN}in}
.bot{height:${LOB_PAGE_BOTTOM_IN}in}
.first{height:${Math.round((LOB_BODY_TOP_IN - LOB_PAGE_TOP_IN) * 100) / 100}in}
.p{white-space:pre-wrap;margin:0 0 0.16in 0}
</style></head><body><div class="lh"><div class="co">${esc(l.companyName)}</div><div class="sm">${contact}</div>${
    l.propertyAddress ? `<div class="re">Re: ${esc(l.propertyAddress)}</div>` : ''
  }</div><table><thead><tr><td><div class="top"></div></td></tr></thead><tfoot><tr><td><div class="bot"></div></td></tr></tfoot><tbody><tr><td><div class="first"></div></td></tr>${rows}</tbody></table></body></html>`;
}

/**
 * Lob's refusal, in words the team can act on. An address below the
 * account's deliverability strictness is one USPS does not list as a place
 * it delivers: in the tax deed counties that is usually a vacant lot.
 */
export function lobErrorMessage(message: string, code?: string | null): string {
  const text = `${code || ''} ${message || ''}`;
  if (/deliverability/i.test(text)) {
    return 'USPS does not list this as a deliverable address (Lob checked it). It is often a vacant lot or a missing unit number. Find a better address for this person.';
  }
  return message;
}

/** Lob's limit on an inline HTML file. Past it the letter is refused before the call. */
export const LOB_HTML_MAX = 10_000;

/**
 * Lob signs a webhook as HMAC-SHA256, hex, over the timestamp header, a
 * dot, and the raw body, keyed with that webhook's secret.
 */
export function verifyLobSignature(
  secret: string,
  timestamp: string | undefined,
  rawBody: Buffer | string | undefined,
  signature: string | undefined,
): boolean {
  if (!secret || !timestamp || !signature || rawBody === undefined || rawBody === null) return false;
  const body = Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : String(rawBody);
  const expected = createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(String(signature).trim().toLowerCase(), 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * What a letter event means for the letter history. Lob names them
 * letter.<step> (letter.certified.<step> for certified mail), so the step is
 * the last part.
 */
export type LobLetterEvent =
  | { kind: 'status'; status: string }
  | { kind: 'delivered' }
  | { kind: 'returned' }
  | { kind: 'cancelled' }
  | { kind: 'failed' }
  | { kind: 'ignore' };

const STATUS_LABEL: Record<string, string> = {
  created: 'Created',
  rendered_pdf: 'Created',
  rendered_thumbnails: 'Created',
  mailed: 'Mailed',
  in_transit: 'In transit',
  in_local_area: 'In local area',
  processed_for_delivery: 'Out for delivery',
  're-routed': 'Re-routed',
  delivered: 'Delivered',
  returned_to_sender: 'Returned to sender',
  failed: 'Failed at Lob',
  deleted: 'Cancelled at Lob',
};

export function lobStatusLabel(step?: string | null): string | null {
  if (!step) return null;
  return STATUS_LABEL[step] || step.replace(/_/g, ' ');
}

export function lobLetterEvent(eventTypeId?: string | null): { step: string | null; event: LobLetterEvent } {
  const id = String(eventTypeId || '');
  if (!id.startsWith('letter.') || id.startsWith('letter.return_envelope')) return { step: null, event: { kind: 'ignore' } };
  const step = id.split('.').pop() || '';
  if (step === 'delivered') return { step, event: { kind: 'delivered' } };
  if (step === 'returned_to_sender') return { step, event: { kind: 'returned' } };
  if (step === 'deleted') return { step, event: { kind: 'cancelled' } };
  if (step === 'failed') return { step, event: { kind: 'failed' } };
  if (STATUS_LABEL[step]) return { step, event: { kind: 'status', status: step } };
  return { step, event: { kind: 'ignore' } };
}

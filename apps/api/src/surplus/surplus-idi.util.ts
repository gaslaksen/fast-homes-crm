/**
 * IDI (idiCORE) batch skip trace: the file we upload and the file it returns.
 *
 * IDI runs batches over SFTP. We drop a CSV in its six column Batch Template
 * (name and address only, no id of ours rides along) and the results come
 * back in a profile's `out` folder as one row per input row. The profile in
 * use is NRphones_Email: a deceased flag, up to five phones and emails with
 * first and last seen dates, and up to five relatives with their own address,
 * age, phones and emails. It does NOT return the subject's own current
 * address.
 *
 * Because nothing of ours survives the round trip, a returned row is matched
 * back to a claimant by the name and address it echoes. That matching is
 * here, pure, so it can be tested against the real file.
 */
import * as XLSX from 'xlsx';
import { normalizePhoneDigits } from '../foreclosures/foreclosure-scoring.util';
import { sameGivenName, splitClaimantName, verifyTracedName } from './surplus-skiptrace.util';

/** IDI's Batch Template header, exactly as their template file has it. */
export const IDI_BATCH_HEADER = [
  'First Name(Including Middle Initial)',
  'Last Name',
  'Address',
  'City',
  'State',
  'Zip',
];

export interface IdiBatchRow {
  first: string;
  last: string;
  street: string;
  city: string;
  state: string;
  zip: string;
}

export interface IdiPhone {
  num: string;
  type: string | null;
  firstSeen: string | null;
  lastSeen: string | null;
}

export interface IdiEmail {
  email: string;
  firstSeen: string | null;
  lastSeen: string | null;
}

export interface IdiRelative {
  name: string;
  first: string;
  last: string;
  street: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  age: number | null;
  phones: string[];
  emails: string[];
  /** As IDI printed it: "SPOUSE - WIDOWED", "CHILD", "IN-LAW". */
  relationship: string | null;
}

export interface IdiResultRow {
  /** Zero based position in the file, so a preview choice can name the row. */
  index: number;
  input: IdiBatchRow;
  /** Y, N or U as returned. U on every hit flag means IDI found nobody. */
  deceased: 'Y' | 'N' | 'U';
  phones: IdiPhone[];
  emails: IdiEmail[];
  relatives: IdiRelative[];
  /** False when every hit flag came back U: IDI could not place the person. */
  matched: boolean;
}

// ─── Writing the upload ─────────────────────────────────────────────────────

/**
 * "MARY THERESE" becomes "MARY T": the template asks for the first name with
 * a middle INITIAL, and a spelled out middle name is one more thing for their
 * matcher to disagree with.
 */
export function idiFirstName(raw: string | null | undefined): string {
  const parts = String(raw || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length <= 1) return parts[0] || '';
  return [parts[0], ...parts.slice(1).map((p) => p.replace(/[^A-Za-z]/g, '').charAt(0)).filter(Boolean)].join(' ');
}

function csvCell(v: string): string {
  const s = String(v ?? '');
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** The upload file, CRLF line endings and no BOM, as IDI's own template is. */
export function buildIdiBatchCsv(rows: IdiBatchRow[]): string {
  const lines = [IDI_BATCH_HEADER, ...rows.map((r) => [r.first, r.last, r.street, r.city, r.state, r.zip])];
  return lines.map((cells) => cells.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

// ─── Reading the results ────────────────────────────────────────────────────

/**
 * RFC 4180 CSV. Our own parser rather than the spreadsheet library, which
 * reads "01234" as the number 1234 and drops the leading zero from New
 * England ZIP codes.
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  const s = text.replace(/^﻿/, '');
  for (let i = 0; i < s.length; i += 1) {
    const ch = s[i];
    if (quoted) {
      if (ch === '"') {
        if (s[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else quoted = false;
      } else cell += ch;
      continue;
    }
    if (ch === '"') quoted = true;
    else if (ch === ',') {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && s[i + 1] === '\n') i += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += ch;
  }
  if (cell !== '' || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

/** CSV through our parser; a workbook somebody re-saved in Excel through the library. */
export function readIdiTable(buffer: Buffer, fileName?: string): string[][] {
  const looksXlsx = /\.xlsx?$/i.test(fileName || '') || (buffer[0] === 0x50 && buffer[1] === 0x4b);
  if (!looksXlsx) return parseCsv(buffer.toString('utf8'));
  const wb = XLSX.read(buffer, { type: 'buffer' });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const data: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: false });
  return data.map((r) => r.map((c) => String(c ?? ''))).filter((r) => r.some((c) => c.trim() !== ''));
}

/** "04/06/2001" to "2001-04-06". Anything else is dropped rather than guessed. */
export function idiDate(raw: string | null | undefined): string | null {
  const m = String(raw || '').trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  return `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
}

function flag(v: string | undefined): 'Y' | 'N' | 'U' {
  const c = String(v || '').trim().toUpperCase();
  return c === 'Y' || c === 'N' ? c : 'U';
}

function zip5(v: string | undefined): string {
  const d = String(v || '').replace(/[^0-9]/g, '');
  if (!d) return '';
  return d.length < 5 ? d.padStart(5, '0') : d.slice(0, 5);
}

function clean(v: string | undefined): string | null {
  const s = String(v ?? '').replace(/\s+/g, ' ').trim();
  return s || null;
}

/**
 * Parse IDI's results file. Columns are found by header, not position, so a
 * profile that adds or drops a block still reads. Throws when the file is not
 * an IDI results file at all, which is the mistake worth catching: somebody
 * uploading the batch we SENT rather than the one that came back.
 */
export function parseIdiResults(table: string[][]): IdiResultRow[] {
  if (table.length < 1) throw new Error('The file is empty.');
  const headers = table[0].map((h) => h.trim().toUpperCase());
  const col = (name: string) => headers.indexOf(name.toUpperCase());
  const need = ['INPUT: First Name', 'INPUT: Last Name', 'INPUT: Address 1'];
  if (need.some((n) => col(n) < 0)) {
    throw new Error(
      'This is not an IDI results file: it has no "INPUT: First Name" column. Upload the file from the out folder, not the batch that was sent.',
    );
  }
  const at = (row: string[], name: string): string => {
    const i = col(name);
    return i < 0 ? '' : String(row[i] ?? '');
  };

  return table.slice(1).map((row, index) => {
    const input: IdiBatchRow = {
      first: clean(at(row, 'INPUT: First Name')) || '',
      last: clean(at(row, 'INPUT: Last Name')) || '',
      street: clean(at(row, 'INPUT: Address 1')) || '',
      city: clean(at(row, 'INPUT: City')) || '',
      state: (clean(at(row, 'INPUT: State')) || '').toUpperCase(),
      zip: zip5(at(row, 'INPUT: Zip Code')),
    };

    const phones: IdiPhone[] = [];
    for (let n = 1; n <= 10; n += 1) {
      if (col(`PH: Phone${n}`) < 0) break;
      const num = normalizePhoneDigits(at(row, `PH: Phone${n}`));
      if (!num || phones.some((p) => p.num === num)) continue;
      phones.push({
        num,
        type: clean(at(row, `PH: Phone${n} Type`)),
        firstSeen: idiDate(at(row, `PH: Phone${n} First Seen`)),
        lastSeen: idiDate(at(row, `PH: Phone${n} Last Seen`)),
      });
    }

    const emails: IdiEmail[] = [];
    for (let n = 1; n <= 10; n += 1) {
      if (col(`EMAIL: Email${n}`) < 0) break;
      const email = clean(at(row, `EMAIL: Email${n}`))?.toLowerCase();
      if (!email || !email.includes('@') || emails.some((e) => e.email === email)) continue;
      emails.push({
        email,
        firstSeen: idiDate(at(row, `EMAIL: Email${n} First Seen`)),
        lastSeen: idiDate(at(row, `EMAIL: Email${n} Last Seen`)),
      });
    }

    const relatives: IdiRelative[] = [];
    for (let n = 1; n <= 10; n += 1) {
      if (col(`REL${n}: First Name`) < 0) break;
      const first = clean(at(row, `REL${n}: First Name`)) || '';
      const last = clean(at(row, `REL${n}: Last Name`)) || '';
      const full = clean(at(row, `REL${n}: Full Name`)) || [first, clean(at(row, `REL${n}: Middle Name`)), last, clean(at(row, `REL${n}: Suffix`))].filter(Boolean).join(' ');
      if (!full) continue;
      const age = Number(at(row, `REL${n}: Age`));
      relatives.push({
        name: full,
        first,
        last,
        street: clean(at(row, `REL${n}: Address`)),
        city: clean(at(row, `REL${n}: City`)),
        state: clean(at(row, `REL${n}: State`)),
        zip: zip5(at(row, `REL${n}: Zip`)) || null,
        age: Number.isFinite(age) && age > 0 ? age : null,
        phones: [1, 2, 3]
          .map((k) => normalizePhoneDigits(at(row, `REL${n}: Phone ${k}`)))
          .filter((p, i, a): p is string => !!p && a.indexOf(p) === i),
        emails: [1, 2, 3]
          .map((k) => clean(at(row, `REL${n}: Email ${k}`))?.toLowerCase())
          .filter((e, i, a): e is string => !!e && e.includes('@') && a.indexOf(e) === i),
        relationship: clean(at(row, `REL${n}: Likely Relationship`)),
      });
    }

    const deceased = flag(at(row, 'DEC: Deceased (Y/N/U)'));
    const hits = [deceased, flag(at(row, 'PH: Phone (Y/N/U)')), flag(at(row, 'EMAIL: Hit (Y/N/U)')), flag(at(row, 'REL: Hit (Y/N/U)'))];
    return {
      index,
      input,
      deceased,
      phones,
      emails,
      relatives,
      matched: hits.some((h) => h !== 'U') || phones.length > 0 || emails.length > 0 || relatives.length > 0,
    };
  });
}

/** "SPOUSE - WIDOWED" to "Spouse (widowed)", "IN-LAW" to "In-law". */
export function idiRelationshipLabel(raw: string | null | undefined): string {
  const s = String(raw || '').trim().toUpperCase();
  if (!s) return 'Relative';
  const [head, ...rest] = s.split(/\s+-\s+/);
  const word = head.toLowerCase().replace(/^\w/, (c) => c.toUpperCase());
  return rest.length ? `${word} (${rest.join(', ').toLowerCase()})` : word;
}

// ─── Matching a returned row to a claimant ──────────────────────────────────

/**
 * House number plus the first word of the street name: "1313 TORGERSON RD SE"
 * and "1313 Torgerson Road SE" are one address. Unit numbers and suffixes are
 * where two sources disagree, so they are not compared.
 */
export function streetKey(street: string | null | undefined): string | null {
  const t = String(street || '')
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
  if (t.length < 2 || !/^\d/.test(t[0])) return null;
  const DIRECTIONAL = new Set(['N', 'S', 'E', 'W', 'NE', 'NW', 'SE', 'SW', 'NORTH', 'SOUTH', 'EAST', 'WEST']);
  const name = t.slice(1).find((w) => !DIRECTIONAL.has(w)) || t[1];
  return `${t[0]} ${name}`;
}

export interface IdiMatchCandidate {
  leadId: string;
  detailId: string;
  claimant: string;
  county: string | null;
  caseNumber: string | null;
  streets: (string | null | undefined)[];
}

export type IdiMatchConfidence = 'name_and_address' | 'name_only' | 'ambiguous' | 'none';

export interface IdiMatch {
  confidence: IdiMatchConfidence;
  /** The claimant the row is filed against, when one could be chosen. */
  pick: IdiMatchCandidate | null;
  /** Every claimant whose name fits, for a person to choose between. */
  options: { candidate: IdiMatchCandidate; addressMatch: boolean }[];
}

/**
 * Which claimant a returned row belongs to. The name must be the claimant's
 * (given name and surname both, the same test a vendor's result has to pass),
 * and the address breaks a tie: the row echoes the address we sent, which was
 * either the clerk's notice address or the property.
 */
export function matchIdiRow(row: IdiResultRow, candidates: IdiMatchCandidate[]): IdiMatch {
  const key = streetKey(row.input.street);
  const options = candidates
    .filter((c) => verifyTracedName(c.claimant, row.input.first, row.input.last).verdict === 'same_person')
    .map((candidate) => ({
      candidate,
      addressMatch: !!key && candidate.streets.some((s) => streetKey(s) === key),
    }));
  if (!options.length) return { confidence: 'none', pick: null, options };
  // The name test lets an initial stand for a whole name, and checks given
  // names against the surname too, for counties that write surname first.
  // Between spouses at one address that is a tie: "EMMELENE M MYERS" passes
  // against "PAUL G MYERS" because her M meets his surname. A spelled out
  // first name that agrees breaks the tie; nothing else does.
  const firstAgrees = (o: { candidate: IdiMatchCandidate }) => sameFirstName(row.input.first, o.candidate.claimant);
  const decide = (pool: typeof options): IdiMatchCandidate | null => {
    if (pool.length === 1) return pool[0].candidate;
    const strong = pool.filter(firstAgrees);
    return strong.length === 1 ? strong[0].candidate : null;
  };
  const atAddress = options.filter((o) => o.addressMatch);
  if (atAddress.length) {
    const pick = decide(atAddress);
    return pick ? { confidence: 'name_and_address', pick, options } : { confidence: 'ambiguous', pick: null, options };
  }
  const pick = decide(options);
  return pick ? { confidence: 'name_only', pick, options } : { confidence: 'ambiguous', pick: null, options };
}

/** The first given name on each side, spelled out (two letters or more), and the same. */
function sameFirstName(inputFirst: string, claimant: string): boolean {
  const mine =
    String(inputFirst || '')
      .toLowerCase()
      .replace(/['’.]/g, '')
      .split(/[^a-z]+/)
      .filter(Boolean)[0] || '';
  const theirs = splitClaimantName(claimant).given[0] || '';
  return mine.length > 1 && theirs.length > 1 && sameGivenName(mine, theirs);
}

/**
 * A claimant string that names more than one person ("GLENN A & MARIA C
 * LAWSON"). One person's death record must not mark the whole lead dead.
 */
export function namesSeveralPeople(claimant: string | null | undefined): boolean {
  return /&|\bAND\b|;|\//i.test(String(claimant || ''));
}

/** Surname for the candidate query, the same split the name check uses. */
export function idiSurname(row: IdiResultRow): string {
  return splitClaimantName(`${row.input.first} ${row.input.last}`).surname || row.input.last.toLowerCase();
}

// ─── Merging contacts ───────────────────────────────────────────────────────

export interface SlotPhone {
  num: string;
  type: string | null;
  /** DncRegistry, carried with the number so a flag never lands on another one. */
  dnc: string | null;
  lastSeen?: string | null;
  fromIdi?: boolean;
}

/** A number IDI last saw more than two years ago is ranked below what we already hold. */
export const IDI_FRESH_DAYS = 730;

function isFresh(lastSeen: string | null | undefined, now: Date): boolean {
  if (!lastSeen) return false;
  const t = new Date(`${lastSeen}T12:00:00Z`).getTime();
  return Number.isFinite(t) && now.getTime() - t <= IDI_FRESH_DAYS * 86_400_000;
}

function byLastSeenDesc<T extends { lastSeen?: string | null }>(a: T, b: T): number {
  return String(b.lastSeen || '').localeCompare(String(a.lastSeen || ''));
}

/**
 * Merge IDI's numbers into the four slots we hold, newest first.
 *
 * Order: IDI numbers seen in the last two years, most recent first; then the
 * numbers already on file that IDI did not return, in their existing order;
 * then IDI's older numbers. A number already on file keeps its DNC flag and
 * takes IDI's position and date. What does not fit in four slots is
 * returned as dropped so the note can say so.
 */
export function mergePhones(
  existing: SlotPhone[],
  idi: IdiPhone[],
  now = new Date(),
  slots = 4,
): { phones: SlotPhone[]; dropped: SlotPhone[]; added: number } {
  const have = new Map(existing.filter((p) => p.num).map((p) => [p.num, p]));
  const fromIdi: SlotPhone[] = idi.map((p) => ({
    num: p.num,
    type: p.type || have.get(p.num)?.type || null,
    dnc: have.get(p.num)?.dnc || null,
    lastSeen: p.lastSeen,
    fromIdi: true,
  }));
  const idiNums = new Set(fromIdi.map((p) => p.num));
  const fresh = fromIdi.filter((p) => isFresh(p.lastSeen, now)).sort(byLastSeenDesc);
  const stale = fromIdi.filter((p) => !isFresh(p.lastSeen, now)).sort(byLastSeenDesc);
  const kept = existing.filter((p) => p.num && !idiNums.has(p.num));
  const all = [...fresh, ...kept, ...stale];
  return {
    phones: all.slice(0, slots),
    dropped: all.slice(slots),
    added: all.slice(0, slots).filter((p) => p.fromIdi && !have.has(p.num)).length,
  };
}

/** The same rule for the two email slots. */
export function mergeEmails(
  existing: string[],
  idi: IdiEmail[],
  now = new Date(),
  slots = 2,
): { emails: string[]; added: number } {
  const have = existing.map((e) => e.toLowerCase()).filter(Boolean);
  const idiSet = new Set(idi.map((e) => e.email));
  const fresh = idi.filter((e) => isFresh(e.lastSeen, now)).sort(byLastSeenDesc).map((e) => e.email);
  // An email IDI gave no dates for is ranked with the stale ones: no evidence it is current.
  const stale = idi.filter((e) => !isFresh(e.lastSeen, now)).sort(byLastSeenDesc).map((e) => e.email);
  const kept = have.filter((e) => !idiSet.has(e));
  const all = [...fresh, ...kept, ...stale].filter((e, i, a) => a.indexOf(e) === i).slice(0, slots);
  return { emails: all, added: all.filter((e) => !have.includes(e)).length };
}

/** "(262) 352-4675" for notes. */
export function prettyPhone(num: string): string {
  return num.length === 10 ? `(${num.slice(0, 3)}) ${num.slice(3, 6)}-${num.slice(6)}` : num;
}

/** "2026-09-11" to "9/11/2026" for notes. */
export function shortDate(iso: string | null | undefined): string | null {
  const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${Number(m[2])}/${Number(m[3])}/${m[1]}` : null;
}

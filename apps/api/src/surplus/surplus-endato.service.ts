/**
 * Endato (EnformionGO) Person Search: the name-first rung of the skip trace.
 *
 * BatchData answers "who is associated with this address?" and that is the
 * wrong question on most of Polk and Brevard, where the parcel is a lot nobody
 * lived on and the address of record died years ago. It found 6 people out
 * of 132 there. Endato answers "where is this person now?": a name plus a last
 * known city and state in, candidate people with dated address history,
 * phones, relatives and death records out.
 *
 * Tested 2026-09-11 on the ten highest-dollar Brevard claimants BatchData had
 * missed: 5 of 7 people verified, 4 with phones.
 *
 * The verification is the surplus course's rule and it is not optional: a
 * candidate is the claimant only when their address history contains the
 * property that sold or the clerk's mailing address. Common names come back
 * five at a time (James Sims, John Kish) and none of those verified. A hit on
 * the name alone is never taken.
 *
 * Credentials are an access profile name and password. They live in
 * ENDATO_AP_NAME and ENDATO_AP_PASSWORD and are never logged.
 */

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { normalizePhoneDigits } from '../foreclosures/foreclosure-scoring.util';

const ENDATO_URL = 'https://devapi.enformion.com/PersonSearch';
const RESULTS_PER_SEARCH = 5;

export interface EndatoAddress {
  street: string;
  city: string | null;
  state: string | null;
  zip: string | null;
  /** ISO-ish date string as the vendor gives it, for "current address" ordering. */
  lastSeen: string | null;
  /** The full street line with suffix and unit, for an envelope. */
  line?: string | null;
}

export interface EndatoPhone {
  num: string;
  type: string | null;
  connected: boolean;
}

export interface EndatoPerson {
  first: string | null;
  last: string | null;
  age: number | null;
  akas: { first: string | null; last: string | null }[];
  addresses: EndatoAddress[];
  phones: EndatoPhone[];
  emails: string[];
  deceased: boolean;
  /** YYYY-MM-DD. A day the vendor masks ("3/XX/2021") becomes the first. */
  dateOfDeath: string | null;
  relatives: EndatoRelative[];
}

export interface EndatoRelative {
  /**
   * Endato's own id for this relative ("tahoeId"). A Person Search on it
   * returns exactly this person, so looking a relative up needs no name
   * matching and cannot land on a namesake.
   */
  id: string | null;
  name: string;
  /** YYYY-MM-DD, the day often masked to the first. */
  dob: string | null;
  /** "Spouse", "Family". */
  type: string | null;
  deceased: boolean;
  city: string | null;
  state: string | null;
}

export interface EndatoQuery {
  first: string;
  last: string;
  /** Last known city and state. Narrows namesakes; the state is the one that matters. */
  city?: string | null;
  state?: string | null;
}

/**
 * A loose key for "the same street address", tolerant of the vendor
 * abbreviating and the county not: the county lists "256 TREU TER NW" and the
 * vendor holds house number 256 on street "Treu". House number plus the first
 * word of the street plus the five-digit ZIP (or the city when there is none).
 */
export function historyKey(street: string | null | undefined, city: string | null | undefined, zip: string | null | undefined): string | null {
  const s = String(street || '').toUpperCase().replace(/[^A-Z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
  const m = /^(\d+[A-Z]?)\s+([A-Z0-9]+)/.exec(s);
  if (!m) return null;
  const z = String(zip || '').replace(/[^0-9]/g, '').slice(0, 5);
  const place = z || String(city || '').toUpperCase().replace(/[^A-Z]/g, '');
  return place ? `${m[1]} ${m[2]}|${place}` : null;
}

/** Endato's own numeric date strings sort as text badly; normalise M/D/YYYY to YYYY-MM-DD. */
function isoish(v: unknown): string | null {
  const s = String(v || '').trim();
  if (!s) return null;
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(s);
  if (m) return `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
  return s.slice(0, 10);
}

/**
 * A vendor date of death as YYYY-MM-DD. Endato writes M/D/YYYY and masks the
 * day on some records ("11/XX/1961" is how it prints a relative's birth), so
 * a masked day becomes the first of the month rather than no date at all.
 */
export function endatoDate(v: unknown): string | null {
  const s = String(v || '').trim();
  const m = /^(\d{1,2})\/(\d{1,2}|XX)\/(\d{4})/i.exec(s);
  if (m) {
    const day = /^\d+$/.test(m[2]) ? m[2].padStart(2, '0') : '01';
    return `${m[3]}-${m[1].padStart(2, '0')}-${day}`;
  }
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null;
}

/**
 * "6021 Massey Rd", "30 Post St Apt 4B". Endato's `fullAddress` is
 * "6021 Massey Rd; Spotsylvania, VA 22551-6141", so the street line is the
 * part before the semicolon; built from the parts when that is absent.
 */
function addressLine(a: any, g: (o: any, ...k: string[]) => any): string | null {
  const full = String(g(a, 'fullAddress', 'FullAddress') || '');
  if (full.includes(';')) return full.split(';')[0].trim() || null;
  const line = [
    g(a, 'houseNumber', 'HouseNumber'),
    g(a, 'streetPreDirection', 'StreetPreDirection'),
    g(a, 'streetName', 'StreetName'),
    g(a, 'streetType', 'StreetType'),
    g(a, 'streetPostDirection', 'StreetPostDirection'),
    g(a, 'unitType', 'UnitType'),
    g(a, 'unit', 'Unit'),
  ]
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
  return line || null;
}

/** One vendor person, whichever casing the vendor used for the keys. */
export function parseEndatoPerson(p: any): EndatoPerson {
  const g = (o: any, ...keys: string[]) => {
    for (const k of keys) if (o && o[k] != null) return o[k];
    return undefined;
  };
  const name = g(p, 'name', 'Name') || {};
  const seen = new Set<string>();
  const phones: EndatoPhone[] = ((g(p, 'phoneNumbers', 'PhoneNumbers') || []) as any[])
    .map((ph) => ({
      num: normalizePhoneDigits(g(ph, 'phoneNumber', 'PhoneNumber')),
      type: g(ph, 'phoneType', 'PhoneType') || null,
      connected: !!g(ph, 'isConnected', 'IsConnected'),
    }))
    .filter((ph) => ph.num && !seen.has(ph.num) && seen.add(ph.num));
  const addresses: EndatoAddress[] = ((g(p, 'addresses', 'Addresses') || []) as any[])
    .map((a) => ({
      street: `${g(a, 'houseNumber', 'HouseNumber') || ''} ${g(a, 'streetName', 'StreetName') || ''}`.replace(/\s+/g, ' ').trim(),
      city: g(a, 'city', 'City') || null,
      state: g(a, 'state', 'State') || null,
      zip: g(a, 'zip', 'Zip') || null,
      lastSeen: isoish(g(a, 'lastReportedDate', 'LastReportedDate')),
      // The whole street line, suffix and unit included, for an envelope.
      // "street" stays house number plus name because the address-history
      // key is built from it.
      line: addressLine(a, g),
    }))
    .filter((a) => a.street);
  // The death record. The live response carries it as a top-level `dod` and a
  // `datesOfDeath` list (Juliet Abe, Brevard 250921: dod "3/22/2021"). The
  // parser used to read `deathRecords.isDeceased`, which the response does not
  // have, so every death Endato reported was dropped and the claimant was
  // filed under Call now. The old key is still honoured in case a plan returns
  // it.
  const dates = ((g(p, 'datesOfDeath', 'DatesOfDeath') || []) as any[])
    .map((d) => endatoDate(typeof d === 'string' ? d : g(d, 'dod', 'Dod')))
    .filter(Boolean) as string[];
  const dateOfDeath = endatoDate(g(p, 'dod', 'Dod')) || dates.sort().pop() || null;
  const legacy = g(p, 'deathRecords', 'DeathRecords') || {};
  return {
    first: g(name, 'firstName', 'FirstName') || null,
    last: g(name, 'lastName', 'LastName') || null,
    age: Number(g(p, 'age', 'Age')) || null,
    akas: ((g(p, 'akas', 'Akas') || []) as any[]).map((a) => ({
      first: g(a, 'firstName', 'FirstName') || null,
      last: g(a, 'lastName', 'LastName') || null,
    })),
    addresses,
    phones,
    emails: Array.from(
      new Set(
        ((g(p, 'emailAddresses', 'EmailAddresses') || []) as any[])
          .map((e) => (typeof e === 'string' ? e : g(e, 'emailAddress', 'EmailAddress')))
          .filter(Boolean),
      ),
    ) as string[],
    deceased: !!dateOfDeath || !!g(legacy, 'isDeceased', 'IsDeceased'),
    dateOfDeath,
    relatives: ((g(p, 'relativesSummary', 'RelativesSummary') || []) as any[])
      .map((r) => ({
        id: g(r, 'tahoeId', 'TahoeId') || null,
        name: [g(r, 'firstName', 'FirstName'), g(r, 'middleName', 'MiddleName'), g(r, 'lastName', 'LastName')]
          .filter(Boolean)
          .join(' '),
        dob: endatoDate(g(r, 'dob', 'Dob')),
        type: g(r, 'relativeType', 'RelativeType') || null,
        deceased: !!g(r, 'isDeceased', 'IsDeceased'),
        city: g(r, 'city', 'City') || null,
        state: g(r, 'state', 'State') || null,
      }))
      .filter((r) => r.name),
  };
}

/**
 * Which of our two known addresses this person's history contains, if any.
 * 'property' is the parcel that generated the surplus; 'mailing' is where the
 * clerk wrote to them. Either ties the person to this case.
 */
export function verifiedVia(
  person: EndatoPerson,
  keys: { property: string | null; mailing: string | null },
): 'property' | 'mailing' | null {
  const have = new Set(person.addresses.map((a) => historyKey(a.street, a.city, a.zip)).filter(Boolean));
  if (keys.property && have.has(keys.property)) return 'property';
  if (keys.mailing && have.has(keys.mailing)) return 'mailing';
  return null;
}

/** The most recently reported address, for the note. */
export function currentAddress(person: EndatoPerson): EndatoAddress | null {
  return [...person.addresses].sort((a, b) => String(b.lastSeen || '').localeCompare(String(a.lastSeen || '')))[0] || null;
}

@Injectable()
export class SurplusEndatoService {
  private readonly logger = new Logger(SurplusEndatoService.name);
  private readonly apName?: string;
  private readonly apPassword?: string;

  constructor(private config: ConfigService) {
    this.apName = this.config.get<string>('ENDATO_AP_NAME');
    this.apPassword = this.config.get<string>('ENDATO_AP_PASSWORD');
  }

  get available(): boolean {
    return !!(this.apName && this.apPassword);
  }

  /** The vendor's per-search price, for the attempt log. Null when unset. */
  get costPerSearch(): number | null {
    return Number(this.config.get<string>('ENDATO_COST_PER_SEARCH') || 0) || null;
  }

  /**
   * One search. Throws on auth or quota failures with a message the caller can
   * act on, so a run that fails on every name stops after the first.
   */
  async search(q: EndatoQuery): Promise<EndatoPerson[]> {
    if (!this.available) return [];
    const hint = q.city && q.state ? `${q.city}, ${q.state}` : q.state || null;
    return this.request({
      FirstName: q.first,
      LastName: q.last,
      Addresses: hint ? [{ AddressLine2: hint }] : [],
      Includes: ['Addresses', 'PhoneNumbers', 'RelativesSummary', 'DeathRecords', 'Akas'],
      Page: 1,
      ResultsPerPage: RESULTS_PER_SEARCH,
    });
  }

  /**
   * One person by Endato's own id, as a relative's summary carries it. Tested
   * 2026-09-14 on a relative of James Connolly (Brevard 250054): one result,
   * the right person, a current Pennsylvania address and two connected
   * numbers, for one search. Null when Endato returns nobody, which is what a
   * person who opted out of people-search listings looks like.
   */
  async lookup(id: string): Promise<EndatoPerson | null> {
    if (!this.available || !id) return null;
    const found = await this.request({
      TahoeId: id,
      Includes: ['Addresses', 'PhoneNumbers', 'EmailAddresses', 'DeathRecords'],
      ResultsPerPage: 1,
    });
    return found[0] || null;
  }

  private async request(body: Record<string, unknown>): Promise<EndatoPerson[]> {
    let resp;
    try {
      resp = await axios.post(ENDATO_URL, body, {
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'galaxy-ap-name': this.apName!,
          'galaxy-ap-password': this.apPassword!,
          'galaxy-search-type': 'Person',
        },
        timeout: 20000,
      });
    } catch (err: any) {
      const status = err?.response?.status;
      if (status === 401 || status === 403) {
        throw new Error(`Endato auth ${status}: check ENDATO_AP_NAME and ENDATO_AP_PASSWORD`);
      }
      if (status === 402 || status === 429) throw new Error(`Endato ${status}: out of searches or rate limited`);
      const data = err?.response?.data;
      throw new Error(
        `Endato ${status || 'request failed'}: ${typeof data === 'string' ? data.slice(0, 200) : data ? JSON.stringify(data).slice(0, 200) : err.message}`,
      );
    }
    const persons: any[] = resp.data?.persons || resp.data?.Persons || [];
    return persons.map(parseEndatoPerson);
  }
}

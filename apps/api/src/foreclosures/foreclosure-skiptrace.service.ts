import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { PrismaService } from '../prisma/prisma.service';
import { LeadSource } from '@fast-homes/shared';
import {
  MECK_CITIES,
  normalizePhoneDigits,
  ownerOccupiedFrom,
  scoreOf,
  daysToSale,
} from './foreclosure-scoring.util';

const NC_PARCELS_URL =
  'https://services.nconemap.gov/secure/rest/services/NC1Map_Parcels/MapServer/1/query';
const MECK_MASTER_ADDRESS_URL =
  'https://gis.charlottenc.gov/arcgis/rest/services/CountyData/MasterAddress/MapServer/0/query';
// Same default + BATCHDATA_API_BASE_URL override as comps/batchdata.service.ts,
// so sandbox vs production is decided in one place (the env), not per caller.
const BATCHDATA_DEFAULT_BASE_URL = 'https://api.batchdata.com/api/v1';

const STREET_SUFFIXES = new Set([
  'RD', 'ROAD', 'DR', 'DRIVE', 'LN', 'LANE', 'CT', 'COURT', 'ST', 'STREET',
  'PL', 'PLACE', 'WAY', 'CIR', 'CIRCLE', 'AVE', 'AVENUE', 'BLVD', 'BOULEVARD',
  'TRL', 'TRAIL', 'PKWY', 'PARKWAY', 'TER', 'TERRACE', 'LOOP', 'RUN', 'XING', 'CROSSING',
]);

/**
 * Just the street line. NC OneMap's siteadd is a FULL address ("10990 PRINCETON
 * VILLAGE DR CHARLOTTE NC"), so passing it through as `street` repeated the
 * city and state that travel in their own fields. Trims whichever of those is
 * hanging off the end, leaving the rest untouched when neither is.
 */
export function streetLineOf(siteAddress: string, city?: string, state?: string): string {
  let out = String(siteAddress || '').trim();
  for (const part of [state, city]) {
    const p = String(part || '').trim();
    if (!p) continue;
    const re = new RegExp(`[\\s,]+${p.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')}$`, 'i');
    out = out.replace(re, '').trim();
  }
  return out;
}

interface ParcelAttrs {
  ownname?: string; ownname2?: string; mailadd?: string; munit?: string;
  mcity?: string; mstate?: string; mzip?: string; siteadd?: string;
  scity?: string; szip?: string; parval?: number | string; cntyname?: string;
}

@Injectable()
export class ForeclosureSkiptraceService {
  private readonly logger = new Logger(ForeclosureSkiptraceService.name);
  private readonly batchKey?: string;
  private readonly batchBaseUrl: string;

  constructor(private prisma: PrismaService, private config: ConfigService) {
    this.batchKey = this.config.get<string>('BATCHDATA_API_KEY');
    this.batchBaseUrl = (
      this.config.get<string>('BATCHDATA_API_BASE_URL') || BATCHDATA_DEFAULT_BASE_URL
    ).replace(/\/$/, '');
  }

  /**
   * Enrich one foreclosure lead in place: county owner + mailing + assessed +
   * owner-occupied (free NC OneMap), exact Mecklenburg parcel id where possible,
   * then phones/email (paid BatchData, only when a key is configured).
   * Recomputes the lead score afterward. Returns the updated detail summary.
   *
   * Every exit logs. This runs fire-and-forget off ingestion, so without a line
   * per outcome a lead that was never enriched and one enriched with nothing to
   * show look identical from the logs.
   *
   * onlyIfMissingContact is for the automatic callers: re-running a lead that
   * already has a number spends a BatchData credit to learn what we know. The
   * manual and bulk buttons leave it off, since the point of pressing them is
   * to look again.
   */
  async enrichLead(
    leadId: string,
    organizationId?: string,
    opts: { onlyIfMissingContact?: boolean } = {},
  ) {
    const lead = await this.prisma.lead.findFirst({
      where: { id: leadId, source: LeadSource.FORECLOSURE, ...(organizationId ? { organizationId } : {}) },
      include: { foreclosureDetail: true },
    });
    if (!lead || !lead.foreclosureDetail) {
      this.logger.warn(`Skip trace ${leadId}: no foreclosure lead found, nothing enriched`);
      return { updated: false, reason: 'not found' };
    }

    if (opts.onlyIfMissingContact) {
      const d0 = lead.foreclosureDetail;
      const hasPhone = [lead.sellerPhone, d0.phone2, d0.phone3, d0.phone4].some((p) =>
        normalizePhoneDigits(p),
      );
      if (hasPhone) {
        this.logger.log(`Skip trace ${leadId}: already has a phone, left alone`);
        return { updated: false, reason: 'already has contact' };
      }
    }

    const address = lead.propertyAddress;
    const detailPatch: any = {};
    const leadPatch: any = {};

    // Tier 1 - NC OneMap parcel record (free, address only).
    let parcel: ParcelAttrs | null = null;
    try {
      parcel = await this.lookupParcel(address);
    } catch (e: any) {
      this.logger.warn(`NC OneMap lookup failed for "${address}": ${e.message}`);
    }

    if (parcel) {
      // ownname2 comes back as a single space on parcels with one owner, which
      // is truthy, so filtering on Boolean alone left a trailing "; ".
      const countyOwner = [parcel.ownname, parcel.ownname2]
        .map((n) => String(n || '').trim())
        .filter(Boolean)
        .join('; ');
      const mail = [parcel.mailadd, parcel.munit].filter(Boolean).join(' ').trim();
      if (countyOwner) detailPatch.countyOwner = countyOwner;
      if (mail) detailPatch.mailingAddress = mail;
      if (parcel.mcity) detailPatch.mailCity = parcel.mcity;
      if (parcel.mstate) detailPatch.mailState = parcel.mstate;
      if (parcel.mzip) detailPatch.mailZip = parcel.mzip;
      if (parcel.parval != null && parcel.parval !== '') {
        detailPatch.assessedValue = Number(parcel.parval) || null;
      }
      // The parcel record always has both addresses, so an unknown here means
      // absentee rather than "cannot tell".
      detailPatch.ownerOccupied = ownerOccupiedFrom(parcel.mailadd, parcel.siteadd) || 'N';
      detailPatch.skipStatus = detailPatch.skipStatus || 'OK';

      // Backfill the seller name on the Lead when the notice had no owner.
      if (countyOwner && !lead.sellerFirstName && !lead.sellerLastName) {
        const first = countyOwner.split(';')[0].trim().split(/\s+/);
        leadPatch.sellerFirstName = first[0] || '';
        leadPatch.sellerLastName = first.slice(1).join(' ');
      }
    } else {
      detailPatch.skipStatus = 'NO MATCH';
    }

    // Exact Mecklenburg parcel id (better link than the address search).
    const cityU = (lead.propertyCity || '').toUpperCase().trim();
    if ((MECK_CITIES.has(cityU) || !lead.propertyCity) && address && address.indexOf(',') < 0) {
      try {
        const pid = await this.meckPID(address);
        if (pid) {
          detailPatch.parcelId = pid;
          detailPatch.parcelType = 'exact';
          detailPatch.parcelLabel = `PID ${pid}`;
          detailPatch.parcelUrl = `https://property.spatialest.com/nc/mecklenburg#/search/?term=${encodeURIComponent(pid)}&page=1`;
        }
      } catch {
        // non-fatal; keep the existing search link
      }
    }

    // Tier 2 - BatchData phones/email (paid, opt-in via key). Attaches up to
    // 4 phones (phone1 on the Lead, phone2-4 on the detail) and 2 emails.
    // Name the unconfigured key explicitly: a missing BATCHDATA_API_KEY reads
    // as "skip trace found no phones" on the card, which is not the same thing.
    // Nor is "BatchData has no record of this owner" the same as "it has a
    // record with no numbers on it" - the fix differs, so they log differently.
    let tier2 = 'BATCHDATA_API_KEY not set, no phone lookup';
    if (this.batchKey) {
      try {
        const contact = await this.batchSkipTrace(
          parcel,
          address,
          lead.propertyCity,
          lead.propertyZip,
          lead.propertyState,
        );
        tier2 = contact
          ? `${contact.phones.length} phone(s), ${contact.emails.length} email(s)`
          : 'BatchData no match';
        if (contact) {
          const [p1, p2, p3, p4] = contact.phones;
          if (p1) { leadPatch.sellerPhone = p1.num; detailPatch.phone1Type = p1.type || null; }
          if (p2) { detailPatch.phone2 = p2.num; detailPatch.phone2Type = p2.type || null; }
          if (p3) { detailPatch.phone3 = p3.num; detailPatch.phone3Type = p3.type || null; }
          if (p4) { detailPatch.phone4 = p4.num; detailPatch.phone4Type = p4.type || null; }
          const [e1, e2] = contact.emails;
          if (e1 && !lead.sellerEmail) leadPatch.sellerEmail = e1;
          if (e2) detailPatch.email2 = e2;
        }
      } catch (e: any) {
        this.logger.warn(`BatchData skip-trace failed for "${address}": ${e.message}`);
        tier2 = `BatchData failed: ${e.message}`;
      }
    }

    // Recompute score with any newly found equity/contactability signals.
    const d = lead.foreclosureDetail;
    const assessed = detailPatch.assessedValue ?? d.assessedValue;
    const phone1 = leadPatch.sellerPhone ?? lead.sellerPhone;
    const phoneCount = [phone1, detailPatch.phone2 ?? d.phone2].filter((p) => normalizePhoneDigits(p)).length;
    const saleIso = d.saleDate ? new Date(d.saleDate).toISOString().slice(0, 10) : null;
    detailPatch.leadScore = scoreOf({
      priority: d.priority || 'LOW',
      equityPct: d.equityPct ?? null,
      ownerOccupied: detailPatch.ownerOccupied ?? d.ownerOccupied,
      phoneCount,
      hasEmail: !!(leadPatch.sellerEmail ?? lead.sellerEmail),
      daysToSale: saleIso ? daysToSale(saleIso) : null,
      loanDateIso: d.loanDate ? new Date(d.loanDate).toISOString().slice(0, 10) : null,
      skipStatus: detailPatch.skipStatus ?? d.skipStatus,
      dead: d.workStatus === 'DEAD',
    });
    // Skip trace must not undo what the rules engine suppressed. A newly found
    // assessed value on a reverse mortgage or an HOA lien would otherwise write
    // a spread straight back over the deliberate blank.
    if (assessed != null && d.loanAmount != null && d.debtFigureReliable !== false) {
      detailPatch.equitySpread = Math.round(assessed - d.loanAmount);
    }

    await this.prisma.lead.update({
      where: { id: leadId },
      data: { ...leadPatch, foreclosureDetail: { update: detailPatch } },
    });

    this.logger.log(
      `Skip trace ${leadId} "${address}": parcel ${parcel ? 'matched' : 'no match'}, ` +
        `${tier2}, status ${detailPatch.skipStatus}`,
    );

    return { updated: true, skipStatus: detailPatch.skipStatus, parcelId: detailPatch.parcelId };
  }

  /**
   * Kick off skip-trace for many leads. Runs in the background with pacing
   * (each lead makes 1-3 external calls), so the HTTP request returns
   * immediately; results land on the cards as each lead finishes.
   */
  async enrichMany(ids: string[], organizationId?: string): Promise<{ queued: number }> {
    const unique = Array.from(new Set(ids)).slice(0, 200);
    void this.processMany(unique, organizationId);
    return { queued: unique.length };
  }

  private async processMany(ids: string[], organizationId?: string) {
    let ok = 0;
    for (const id of ids) {
      try {
        const res = await this.enrichLead(id, organizationId);
        if (res.updated) ok++;
      } catch (e: any) {
        this.logger.warn(`Bulk skip-trace failed for ${id}: ${e.message}`);
      }
      // Be polite to the free NC OneMap endpoint (mirrors the old Apps Script).
      await new Promise((r) => setTimeout(r, 500));
    }
    this.logger.log(`Bulk skip-trace done: ${ok}/${ids.length} leads enriched`);
  }

  /** Query NC OneMap parcels by site address. Returns first match attrs or null. */
  private async lookupParcel(address: string): Promise<ParcelAttrs | null> {
    const clean = address.toUpperCase().replace(/[^A-Z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
    let tokens = clean.split(' ');
    const unitIdx = tokens.findIndex((t) => ['UNIT', 'APT', 'STE', 'LOT', '#'].includes(t));
    if (unitIdx > -1) tokens = tokens.slice(0, unitIdx);
    if (tokens.length > 2 && STREET_SUFFIXES.has(tokens[tokens.length - 1])) tokens = tokens.slice(0, -1);
    if (tokens.length < 2) return null;

    const pattern = tokens.join(' ').replace(/'/g, "''") + '%';
    const params = new URLSearchParams({
      where: `UPPER(siteadd) LIKE '${pattern}'`,
      outFields: 'ownname,ownname2,mailadd,munit,mcity,mstate,mzip,siteadd,scity,szip,parval,cntyname',
      returnGeometry: 'false',
      f: 'json',
    });
    const resp = await axios.get(`${NC_PARCELS_URL}?${params.toString()}`, { timeout: 15000 });
    const json = resp.data;
    if (json.error || !json.features || json.features.length === 0) return null;
    return json.features[0].attributes as ParcelAttrs;
  }

  /** Mecklenburg exact parcel id via the Charlotte MasterAddress GIS. */
  private async meckPID(address: string): Promise<string> {
    const hnm = address.match(/^(\d+)/);
    if (!hnm) return '';
    const hn = hnm[1];
    let a = address.toUpperCase().replace(/^\d+[A-Z]?\s+/, '').replace(/\s+(UNIT|APT|STE|#).*$/, '');
    a = a.replace(
      /\s+(RD|ROAD|DR|DRIVE|LN|LANE|CT|COURT|ST|STREET|AVE|AVENUE|PL|PLACE|WAY|CIR|CIRCLE|BLVD|PKWY|TER|TERRACE|HWY|CV|COVE|TRL|TRAIL|RDG|RIDGE|PT|POINT)\b.*$/,
      '',
    ).trim();
    const tok = a.split(' ')[0] || '';
    if (!tok) return '';
    const where = `HouseNumber=${hn} AND StreetName LIKE '${tok.replace(/'/g, "''")}%'`;
    const params = new URLSearchParams({
      where,
      outFields: 'ParcelID,StreetName',
      returnGeometry: 'false',
      f: 'json',
    });
    const resp = await axios.get(`${MECK_MASTER_ADDRESS_URL}?${params.toString()}`, { timeout: 15000 });
    const fs = resp.data?.features || [];
    if (!fs.length) return '';
    let best = fs.find((f: any) => (f.attributes.StreetName || '').toUpperCase() === a);
    if (!best) best = fs.find((f: any) => {
      const sn = (f.attributes.StreetName || '').toUpperCase();
      return sn.startsWith(a) || a.startsWith(sn);
    });
    if (!best) best = fs[0];
    return best.attributes.ParcelID || '';
  }

  /** BatchData skip-trace: up to 4 phones + 2 emails, or null on no match. */
  private async batchSkipTrace(
    parcel: ParcelAttrs | null,
    fallbackStreet: string,
    city?: string,
    zip?: string,
    state?: string,
  ): Promise<{ phones: { num: string; type: string | null }[]; emails: string[] } | null> {
    if (!this.batchKey) return null;
    const street = parcel?.siteadd || fallbackStreet;
    if (!street) return null;

    // Every part of this has to describe the PROPERTY. mstate is the owner's
    // MAILING state, so using it here paired an NC street, city and zip with an
    // absentee owner's out-of-state code and BatchData matched nothing. The
    // parcel record carries no site-state field because NC OneMap only covers
    // NC, which is why the mailing one was reachable and the right one was not.
    const propertyAddress: any = { street: streetLineOf(street, parcel?.scity, state) };
    propertyAddress.state = state || 'NC';
    if (parcel?.scity || city) propertyAddress.city = String(parcel?.scity || city);
    // The lead's zip comes from the notice itself; szip is the county's "Site
    // Address Zip", which has been observed holding the owner's out-of-state
    // MAILING zip instead (a Charlotte parcel carrying 79924, El Paso). Trust
    // the notice first and keep szip only as a fallback.
    const z = zip || parcel?.szip;
    if (z) propertyAddress.zip = String(z).slice(0, 5);
    this.logger.debug(`BatchData query: ${JSON.stringify(propertyAddress)}`);

    let resp;
    try {
      resp = await axios.post(
        `${this.batchBaseUrl}/property/skip-trace`,
        { requests: [{ propertyAddress }] },
        {
          headers: {
            Authorization: `Bearer ${this.batchKey}`,
            Accept: 'application/json',
            'Content-Type': 'application/json',
          },
          timeout: 20000,
        },
      );
    } catch (err: any) {
      const status = err?.response?.status;
      if (status === 401 || status === 403) {
        // 401 = bad key; 403 = key valid but no access to the skip-trace
        // product (not on the plan, or sandbox key against production URL).
        throw new Error(
          `BatchData auth ${status}: check that BATCHDATA_API_KEY has the ` +
          `Property Skip Trace product enabled and matches BATCHDATA_API_BASE_URL ` +
          `(${this.batchBaseUrl})`,
        );
      }
      if (status === 402) throw new Error('BatchData: out of skip-trace credits');
      throw err;
    }
    const persons = resp.data?.results?.persons;
    if (!persons || persons.length === 0 || !persons[0]?.meta?.matched) return null;

    const p = persons[0];
    // Dedupe by number; mobiles are already prioritized first by BatchData.
    const seen = new Set<string>();
    const phones = (p.phoneNumbers || [])
      .map((ph: any) => ({ num: normalizePhoneDigits(ph.number), type: ph.type || null }))
      .filter((ph: any): ph is { num: string; type: string | null } => {
        if (!ph.num || seen.has(ph.num)) return false;
        seen.add(ph.num);
        return true;
      })
      .slice(0, 4);
    const emails = Array.from(
      new Set((p.emails || []).map((e: any) => e.email).filter(Boolean) as string[]),
    ).slice(0, 2);
    return { phones, emails };
  }
}

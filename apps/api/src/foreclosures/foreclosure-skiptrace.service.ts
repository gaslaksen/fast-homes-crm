import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { PrismaService } from '../prisma/prisma.service';
import { LeadSource } from '@fast-homes/shared';
import { MECK_CITIES, normalizePhoneDigits, scoreOf, daysToSale } from './foreclosure-scoring.util';

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
   */
  async enrichLead(leadId: string, organizationId?: string) {
    const lead = await this.prisma.lead.findFirst({
      where: { id: leadId, source: LeadSource.FORECLOSURE, ...(organizationId ? { organizationId } : {}) },
      include: { foreclosureDetail: true },
    });
    if (!lead || !lead.foreclosureDetail) return { updated: false, reason: 'not found' };

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
      const countyOwner = [parcel.ownname, parcel.ownname2].filter(Boolean).join('; ').trim();
      const mail = [parcel.mailadd, parcel.munit].filter(Boolean).join(' ').trim();
      if (countyOwner) detailPatch.countyOwner = countyOwner;
      if (mail) detailPatch.mailingAddress = mail;
      if (parcel.mcity) detailPatch.mailCity = parcel.mcity;
      if (parcel.mstate) detailPatch.mailState = parcel.mstate;
      if (parcel.mzip) detailPatch.mailZip = parcel.mzip;
      if (parcel.parval != null && parcel.parval !== '') {
        detailPatch.assessedValue = Number(parcel.parval) || null;
      }
      detailPatch.ownerOccupied = this.isOwnerOccupied(parcel) ? 'Y' : 'N';
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

    // Tier 2 - BatchData phones/email (paid, opt-in via key).
    if (this.batchKey) {
      try {
        const contact = await this.batchSkipTrace(parcel, address, lead.propertyCity, lead.propertyZip);
        if (contact) {
          if (contact.phone1) {
            leadPatch.sellerPhone = contact.phone1;
            detailPatch.phone1Type = contact.phone1Type || null;
          }
          if (contact.phone2) {
            detailPatch.phone2 = contact.phone2;
            detailPatch.phone2Type = contact.phone2Type || null;
          }
          if (contact.email && !lead.sellerEmail) leadPatch.sellerEmail = contact.email;
        }
      } catch (e: any) {
        this.logger.warn(`BatchData skip-trace failed for "${address}": ${e.message}`);
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
    if (assessed != null && d.loanAmount != null) {
      detailPatch.equitySpread = Math.round(assessed - d.loanAmount);
    }

    await this.prisma.lead.update({
      where: { id: leadId },
      data: { ...leadPatch, foreclosureDetail: { update: detailPatch } },
    });

    return { updated: true, skipStatus: detailPatch.skipStatus, parcelId: detailPatch.parcelId };
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

  /** Owner-occupied when the mailing address matches the site house# + street. */
  private isOwnerOccupied(a: ParcelAttrs): boolean {
    if (!a.mailadd || !a.siteadd) return false;
    const norm = (s: string) => String(s).toUpperCase().replace(/[^A-Z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
    const m = norm(a.mailadd).split(' ');
    const s = norm(a.siteadd).split(' ');
    return m.length >= 2 && s.length >= 2 && m[0] === s[0] && m[1] === s[1];
  }

  /** BatchData skip-trace: top two phones + first email, or null on no match. */
  private async batchSkipTrace(
    parcel: ParcelAttrs | null,
    fallbackStreet: string,
    city?: string,
    zip?: string,
  ): Promise<{ phone1?: string; phone1Type?: string; phone2?: string; phone2Type?: string; email?: string } | null> {
    if (!this.batchKey) return null;
    const street = parcel?.siteadd || fallbackStreet;
    if (!street) return null;

    const propertyAddress: any = { street: String(street), state: parcel?.mstate || 'NC' };
    if (parcel?.scity || city) propertyAddress.city = String(parcel?.scity || city);
    const z = parcel?.szip || zip;
    if (z) propertyAddress.zip = String(z).slice(0, 5);

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
    const phones = (p.phoneNumbers || [])
      .map((ph: any) => ({ num: normalizePhoneDigits(ph.number), type: ph.type || null }))
      .filter((ph: any) => ph.num);
    const emails = (p.emails || []).map((e: any) => e.email).filter(Boolean);
    return {
      phone1: phones[0]?.num,
      phone1Type: phones[0]?.type,
      phone2: phones[1]?.num,
      phone2Type: phones[1]?.type,
      email: emails[0],
    };
  }
}

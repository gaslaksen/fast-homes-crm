/**
 * The county reference table: what each clerk requires to file a surplus
 * claim, kept once per county because every case filed there reuses the
 * same answer.
 *
 * Rows are seeded per organization from the county list in code on first
 * read, so a fresh database shows the counties the pipeline already runs in
 * with the links that were previously hardcoded. Everything past that is
 * typed in by a person who asked the clerk, and carries a last-verified date
 * so it gets rechecked: a county changes its form or its mailing rule and
 * nothing in the app would otherwise notice.
 */

import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { FL_COUNTIES, FL_COUNTY_LINKS, RULE_MAX_AGE_DAYS } from './surplus-compliance';

export const ACCEPTED_METHODS = ['usps', 'fedex', 'ups', 'in_person', 'efile'] as const;
export const ACCEPTED_METHOD_LABEL: Record<string, string> = {
  usps: 'USPS',
  fedex: 'FedEx',
  ups: 'UPS',
  in_person: 'In person',
  efile: 'E-file',
};

/** The editable fields, and nothing else: no client writes the seed columns. */
const EDITABLE = [
  'active',
  'courtRecordsUrl',
  'surplusListUrl',
  'claimFormUrl',
  'assignmentPreference',
  'acceptedMethods',
  'signatureRequired',
  'attorneyRequired',
  'clerkContactName',
  'clerkContactPhone',
  'clerkContactEmail',
  'clerkAddress',
  'notes',
] as const;

export interface CountyRow {
  id: string;
  name: string;
  state: string;
  active: boolean;
  courtRecordsUrl: string | null;
  surplusListUrl: string | null;
  claimFormUrl: string | null;
  assignmentPreference: string | null;
  acceptedMethods: string[];
  signatureRequired: boolean | null;
  attorneyRequired: boolean | null;
  clerkContactName: string | null;
  clerkContactPhone: string | null;
  clerkContactEmail: string | null;
  clerkAddress: string | null;
  notes: string | null;
  practiceRunAt: Date | null;
  lastVerifiedAt: Date | null;
  /** Never verified, or verified longer ago than the compliance table allows. */
  stale: boolean;
  /** How many of the filing facts are still unanswered. */
  unknowns: string[];
  updatedAt: Date;
}

@Injectable()
export class SurplusCountiesService {
  constructor(private prisma: PrismaService) {}

  /** Make sure every county in the code list has a row for this org. */
  private async ensureSeeded(organizationId: string | null) {
    const seed = FL_COUNTIES.active
      .map((name) => ({ name, active: true }))
      .concat(FL_COUNTIES.candidate.map((name) => ({ name, active: false })))
      .map((c) => ({
        organizationId,
        name: c.name,
        state: 'FL',
        active: c.active,
        courtRecordsUrl: FL_COUNTY_LINKS[c.name]?.courtRecords || null,
      }));
    await this.prisma.surplusCounty.createMany({ data: seed, skipDuplicates: true });
  }

  async list(organizationId?: string | null): Promise<CountyRow[]> {
    const org = organizationId || null;
    await this.ensureSeeded(org);
    const rows = await this.prisma.surplusCounty.findMany({
      where: { organizationId: org },
      orderBy: [{ active: 'desc' }, { name: 'asc' }],
    });
    return rows.map((r) => this.toRow(r));
  }

  /** Lower-cased name to row, for stamping county facts onto lead rows in one query. */
  async mapFor(organizationId?: string | null): Promise<Map<string, CountyRow>> {
    const rows = await this.list(organizationId);
    return new Map(rows.map((r) => [r.name.toLowerCase(), r]));
  }

  async create(organizationId: string | null | undefined, name: string) {
    const clean = String(name || '').trim();
    if (!clean) throw new BadRequestException('A county name is required.');
    const org = organizationId || null;
    const existing = await this.prisma.surplusCounty.findFirst({
      where: { organizationId: org, name: { equals: clean, mode: 'insensitive' } },
    });
    if (existing) throw new BadRequestException(`${clean} is already on the list.`);
    const row = await this.prisma.surplusCounty.create({
      data: { organizationId: org, name: clean, state: 'FL', active: false },
    });
    return this.toRow(row);
  }

  async update(id: string, patch: any, organizationId?: string | null) {
    const row = await this.prisma.surplusCounty.findFirst({
      where: { id, organizationId: organizationId || null },
    });
    if (!row) throw new BadRequestException('County not found');
    const data: any = {};
    for (const k of EDITABLE) {
      if (patch[k] === undefined) continue;
      data[k] = patch[k];
    }
    if (data.acceptedMethods !== undefined) {
      const list = Array.isArray(data.acceptedMethods)
        ? data.acceptedMethods
        : String(data.acceptedMethods || '').split(',');
      const clean = list.map((m: string) => String(m).trim().toLowerCase()).filter(Boolean);
      const bad = clean.filter((m: string) => !(ACCEPTED_METHODS as readonly string[]).includes(m));
      if (bad.length) throw new BadRequestException(`Unknown submission method: ${bad.join(', ')}`);
      data.acceptedMethods = clean.length ? clean.join(',') : null;
    }
    if (data.assignmentPreference !== undefined && data.assignmentPreference !== null) {
      if (!['full', 'partial'].includes(data.assignmentPreference)) {
        throw new BadRequestException('Assignment preference is full or partial.');
      }
    }
    for (const k of ['courtRecordsUrl', 'surplusListUrl', 'claimFormUrl'] as const) {
      if (data[k] !== undefined && data[k] !== null) {
        const v = String(data[k]).trim();
        if (v && !/^https?:\/\//i.test(v)) throw new BadRequestException(`${k} must be a full http(s) link.`);
        data[k] = v || null;
      }
    }
    if (patch.practiceRunAt !== undefined) {
      data.practiceRunAt = patch.practiceRunAt ? new Date(patch.practiceRunAt) : null;
    }
    const saved = await this.prisma.surplusCounty.update({ where: { id: row.id }, data });
    return this.toRow(saved);
  }

  /** Somebody has just checked the answers with the clerk. Resets the clock. */
  async markVerified(id: string, organizationId?: string | null, userId?: string | null) {
    const row = await this.prisma.surplusCounty.findFirst({
      where: { id, organizationId: organizationId || null },
    });
    if (!row) throw new BadRequestException('County not found');
    const saved = await this.prisma.surplusCounty.update({
      where: { id: row.id },
      data: { lastVerifiedAt: new Date(), verifiedByUserId: userId || null },
    });
    return this.toRow(saved);
  }

  toRow(r: any): CountyRow {
    const ageDays = r.lastVerifiedAt
      ? (Date.now() - new Date(r.lastVerifiedAt).getTime()) / 86_400_000
      : Infinity;
    const unknowns: string[] = [];
    if (!r.claimFormUrl) unknowns.push('claim form');
    if (!r.acceptedMethods) unknowns.push('how claims are submitted');
    if (r.signatureRequired == null) unknowns.push('whether a signature is required');
    if (r.attorneyRequired == null) unknowns.push('whether an attorney is required');
    if (!r.assignmentPreference) unknowns.push('full or partial assignment');
    return {
      id: r.id,
      name: r.name,
      state: r.state,
      active: r.active,
      courtRecordsUrl: r.courtRecordsUrl || null,
      surplusListUrl: r.surplusListUrl || null,
      claimFormUrl: r.claimFormUrl || null,
      assignmentPreference: r.assignmentPreference || null,
      acceptedMethods: r.acceptedMethods ? String(r.acceptedMethods).split(',').filter(Boolean) : [],
      signatureRequired: r.signatureRequired ?? null,
      attorneyRequired: r.attorneyRequired ?? null,
      clerkContactName: r.clerkContactName || null,
      clerkContactPhone: r.clerkContactPhone || null,
      clerkContactEmail: r.clerkContactEmail || null,
      clerkAddress: r.clerkAddress || null,
      notes: r.notes || null,
      practiceRunAt: r.practiceRunAt || null,
      lastVerifiedAt: r.lastVerifiedAt || null,
      stale: ageDays > RULE_MAX_AGE_DAYS,
      unknowns,
      updatedAt: r.updatedAt,
    };
  }
}

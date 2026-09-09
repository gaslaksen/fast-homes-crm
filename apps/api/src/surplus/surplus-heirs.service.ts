import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SurplusProbateService, ExtractedHeir, ProbateExtract } from './surplus-probate.service';
import { normalizePhoneDigits } from '../foreclosures/foreclosure-scoring.util';
import { heirRow } from './surplus-heirs.util';
import { SurplusPersonRole, SurplusContactStatus } from '@fast-homes/shared';

/**
 * Heirs of a deceased surplus claimant.
 *
 * An Estate claimant is a dead end until somebody finds who inherited: the
 * claim can only be filed by a living person with standing. Before this, those
 * leads sat in the name-search queue forever, and the only thing distinguishing
 * "we have not found the heirs" from "we cannot reach this person" was whether
 * the name happened to contain the word ESTATE.
 *
 * Heirs come from a probate filing a person downloaded and confirmed. Nothing
 * here searches for them, and nothing is written without confirmation: a wrong
 * heir is a stranger being told they have money coming.
 */
@Injectable()
export class SurplusHeirsService {
  private readonly logger = new Logger(SurplusHeirsService.name);

  constructor(
    private prisma: PrismaService,
    private probate: SurplusProbateService,
  ) {}

  /**
   * Read an uploaded filing and return the heirs for confirmation.
   *
   * Deliberately does NOT write. The reader compares what came back against the
   * document in front of them, because the one judgement a document cannot make
   * for itself is whether this case is about this claimant.
   */
  async preview(
    leadId: string,
    pdf: Buffer,
    filename: string,
    organizationId?: string | null,
  ): Promise<ProbateExtract & { claimant: string; alreadyOnFile: string[] }> {
    const detail = await this.detailForLead(leadId, organizationId);
    const extract = await this.probate.readFiling(pdf, filename);

    const existing = await this.prisma.surplusHeir.findMany({
      where: { surplusDetailId: detail.id },
      select: { name: true },
    });

    const claimant = `${detail.lead.sellerFirstName || ''} ${detail.lead.sellerLastName || ''}`.trim();
    const warnings = [...extract.warnings];

    // The reader has to make this call, so give them the evidence rather than
    // deciding for them. A surname that does not match is usually the wrong
    // case, and occasionally a married daughter.
    if (extract.decedent && claimant && !this.sharesSurname(extract.decedent, claimant)) {
      warnings.push(
        `This filing is for ${extract.decedent}, which does not share a surname with the claimant ${claimant}. Check it is the right case before saving.`,
      );
    }

    return { ...extract, warnings, claimant, alreadyOnFile: existing.map((e) => e.name) };
  }

  /**
   * Save confirmed heirs onto the claimant.
   *
   * Additive and idempotent on name: re-saving the same filing updates the rows
   * it already created rather than doubling them, which matters because the
   * obvious way to use this is to upload the petition, notice a typo, and
   * upload it again.
   */
  async save(
    leadId: string,
    heirs: ExtractedHeir[],
    meta: { caseNumber?: string | null; sourceDocument?: string | null; userId?: string | null },
    organizationId?: string | null,
  ): Promise<{ created: number; updated: number }> {
    const detail = await this.detailForLead(leadId, organizationId);
    const clean = (heirs || []).filter((h) => String(h?.name || '').trim());
    if (!clean.length) throw new BadRequestException('No heirs to save.');

    const existing = await this.prisma.surplusHeir.findMany({
      where: { surplusDetailId: detail.id },
      select: { id: true, name: true },
    });
    const byKey = new Map(existing.map((e) => [e.name.trim().toUpperCase(), e.id]));

    let created = 0;
    let updated = 0;
    for (const h of clean) {
      const name = String(h.name).trim();
      const data = {
        organizationId: detail.organizationId,
        name,
        relationship: h.relationship || null,
        share: h.share || null,
        street: h.street || null,
        city: h.city || null,
        state: h.state || null,
        zip: h.zip || null,
        deceased: !!h.deceased,
        dateOfDeath: h.dateOfDeath ? new Date(`${h.dateOfDeath}T00:00:00`) : null,
        sourceCaseNumber: meta.caseNumber || null,
        sourceDocument: meta.sourceDocument || null,
        sourceKind: 'probate_petition',
        // A filing names heirs. Associates are only ever added by hand.
        role: SurplusPersonRole.HEIR,
        addedByUserId: meta.userId || null,
      };

      const hit = byKey.get(name.toUpperCase());
      if (hit) {
        // Contacts and trace state are NOT in `data`, so a re-upload never
        // wipes a number somebody found or a trace already paid for.
        await this.prisma.surplusHeir.update({ where: { id: hit }, data });
        updated += 1;
      } else {
        await this.prisma.surplusHeir.create({ data: { ...data, surplusDetailId: detail.id } });
        created += 1;
      }
    }

    // The claimant is confirmed dead by the filing itself, whatever the county
    // owner string looked like. This is what moves the lead out of the
    // name-search queue and onto the heirs.
    await this.prisma.surplusDetail.update({
      where: { id: detail.id },
      data: { deceased: true, heirsRequired: true },
    });

    this.logger.log(
      `Lead ${leadId}: ${created} heir(s) added, ${updated} updated from ${meta.sourceDocument || 'a filing'}`,
    );
    return { created, updated };
  }

  /** Heirs on a claimant, living first, each with its contacts and trace state. */
  async list(leadId: string, organizationId?: string | null) {
    const detail = await this.detailForLead(leadId, organizationId);
    const rows = await this.prisma.surplusHeir.findMany({
      where: { surplusDetailId: detail.id },
      orderBy: [{ deceased: 'asc' }, { createdAt: 'asc' }],
    });
    return rows.map((h) => this.toRow(h));
  }

  /**
   * One person added by hand: an heir the filing missed, or somebody who is
   * not an heir at all but may know where the claimant is. The course's
   * relative and neighbor outreach lands here, so each of those calls has a
   * row to sit on and a contact status to move.
   */
  async add(
    leadId: string,
    input: {
      name: string;
      role?: string | null;
      relationship?: string | null;
      street?: string | null;
      city?: string | null;
      state?: string | null;
      zip?: string | null;
      phones?: (string | { number: string; type?: string | null })[];
      emails?: string[];
      callNotes?: string | null;
    },
    organizationId?: string | null,
    userId?: string | null,
  ) {
    const detail = await this.detailForLead(leadId, organizationId);
    const name = String(input.name || '').trim();
    if (!name) throw new BadRequestException('A person needs a name.');
    const role = String(input.role || SurplusPersonRole.HEIR);
    if (!(Object.values(SurplusPersonRole) as string[]).includes(role)) {
      throw new BadRequestException('Pick a role: heir, relative, neighbor, friend, or associate.');
    }
    const created = await this.prisma.surplusHeir.create({
      data: {
        surplusDetailId: detail.id,
        organizationId: detail.organizationId,
        name,
        role,
        relationship: String(input.relationship || '').trim() || null,
        street: String(input.street || '').trim() || null,
        city: String(input.city || '').trim() || null,
        state: String(input.state || '').toUpperCase().slice(0, 2) || null,
        zip: String(input.zip || '').trim() || null,
        callNotes: String(input.callNotes || '').trim() || null,
        sourceKind: 'manual',
        addedByUserId: userId || null,
      },
    });
    // Contacts go through update() so the phone slots are written the one way.
    if (input.phones?.length || input.emails?.length) {
      return this.update(created.id, { phones: input.phones || [], emails: input.emails || [] }, organizationId);
    }
    return this.toRow(created);
  }

  async update(heirId: string, patch: any, organizationId?: string | null) {
    const heir = await this.find(heirId, organizationId);
    const data: any = {};

    for (const f of ['name', 'relationship', 'share', 'street', 'city', 'zip', 'callNotes'] as const) {
      if (patch[f] !== undefined) data[f] = String(patch[f] || '').trim() || null;
    }
    if (patch.state !== undefined) {
      data.state = String(patch.state || '').toUpperCase().slice(0, 2) || null;
    }
    if (patch.deceased !== undefined) data.deceased = !!patch.deceased;
    if (patch.doNotCall !== undefined) data.doNotCall = !!patch.doNotCall;
    if (patch.role !== undefined) {
      const role = String(patch.role || '');
      if (!(Object.values(SurplusPersonRole) as string[]).includes(role)) {
        throw new BadRequestException('Pick a role: heir, relative, neighbor, friend, or associate.');
      }
      data.role = role;
    }
    if (patch.contactStatus !== undefined) {
      const status = String(patch.contactStatus || '');
      if (!(Object.values(SurplusContactStatus) as string[]).includes(status)) {
        throw new BadRequestException('The contact status is not contacted, contacted, message passed, or dead end.');
      }
      data.contactStatus = status;
      // Anything past "not contacted" is a contact, and the date of the latest
      // one is what the recheck cadence reads.
      if (status !== SurplusContactStatus.NOT_CONTACTED) data.lastContactedAt = new Date();
    }
    if (patch.dateOfDeath !== undefined) {
      data.dateOfDeath = patch.dateOfDeath ? new Date(`${patch.dateOfDeath}T00:00:00`) : null;
    }

    // Phones arrive as a whole list, primary first, for the same reason they do
    // on a lead: the slots are positional and writing "the first empty one"
    // races with a skip trace writing the same slots.
    if (patch.phones !== undefined) {
      const digits = (patch.phones || [])
        .map((p: any) => ({
          num: normalizePhoneDigits(typeof p === 'string' ? p : p?.number) || '',
          type: (typeof p === 'string' ? null : p?.type) || null,
        }))
        .filter((p: any) => p.num.length === 10)
        .slice(0, 4);
      for (let i = 0; i < 4; i += 1) {
        data[`phone${i + 1}`] = digits[i]?.num || null;
        data[`phone${i + 1}Type`] = digits[i]?.type || null;
      }
    }
    if (patch.emails !== undefined) {
      const emails = (patch.emails || []).map((e: any) => String(e || '').trim()).filter(Boolean);
      data.email1 = emails[0] || null;
      data.email2 = emails[1] || null;
    }

    if (!data.name && patch.name !== undefined) {
      throw new BadRequestException('An heir needs a name.');
    }

    const saved = await this.prisma.surplusHeir.update({ where: { id: heir.id }, data });
    return this.toRow(saved);
  }

  async remove(heirId: string, organizationId?: string | null) {
    const heir = await this.find(heirId, organizationId);
    await this.prisma.surplusHeir.delete({ where: { id: heir.id } });
    return { deleted: 1 };
  }

  // ─── Shaping ──────────────────────────────────────────────────────────────

  /** One heir as the board and panel see it. Shared with the board payload. */
  toRow(h: any) {
    return heirRow(h);
  }

  // ─── Internals ────────────────────────────────────────────────────────────

  private async detailForLead(leadId: string, organizationId?: string | null) {
    const detail = await this.prisma.surplusDetail.findFirst({
      where: {
        leadId,
        ...(organizationId ? { organizationId } : {}),
      },
      select: {
        id: true,
        organizationId: true,
        lead: { select: { sellerFirstName: true, sellerLastName: true } },
      },
    });
    if (!detail) throw new NotFoundException('Surplus lead not found');
    return detail;
  }

  private async find(heirId: string, organizationId?: string | null) {
    const heir = await this.prisma.surplusHeir.findFirst({
      where: { id: heirId, ...(organizationId ? { organizationId } : {}) },
    });
    if (!heir) throw new NotFoundException('Heir not found');
    return heir;
  }

  /**
   * Do two names share a surname? Used only to WARN, never to block.
   *
   * A married daughter legitimately does not share one, which is why this
   * cannot be a gate: Helen F. Sherman is Alfred Spencer's daughter.
   */
  private sharesSurname(a: string, b: string): boolean {
    const last = (v: string) => {
      const parts = String(v || '')
        .toUpperCase()
        .replace(/\b(ESTATE|OF|THE|DECEASED|DECD|JR|SR|II|III|IV)\b/g, ' ')
        .replace(/[^A-Z\s]/g, ' ')
        .split(/\s+/)
        .filter(Boolean);
      return parts[parts.length - 1] || '';
    };
    const la = last(a);
    const lb = last(b);
    return !!la && !!lb && la === lb;
  }
}

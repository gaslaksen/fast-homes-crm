import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  evaluateRules, shouldAdoptFilingPrincipal, LenderProfile, RulesResult, ForeclosureLoanType,
} from './foreclosure-rules.util';
import { LENDER_PROFILE_SEED } from './lender-profiles.seed';

/** Profiles change rarely and are read on every ingest; cache briefly. */
const PROFILE_CACHE_MS = 60_000;

/**
 * The deterministic layer. Loads lender profiles, classifies a filing, and
 * writes the result back onto the lead.
 *
 * No model call anywhere in here. The one consequential thing it does is
 * suppress equity math on a reverse mortgage, where the recorded principal
 * overstates the debt - see principalFigureReliable.
 */
@Injectable()
export class ForeclosureRulesService implements OnModuleInit {
  private readonly logger = new Logger(ForeclosureRulesService.name);
  private cache: { profiles: LenderProfile[]; loadedAt: number; orgKey: string } | null = null;

  constructor(private prisma: PrismaService) {}

  async onModuleInit() {
    await this.seedSharedProfiles();
  }

  /**
   * Upsert the shared starter patterns. Idempotent on matchPattern, so a
   * redeploy refreshes wording without duplicating rows or clobbering an
   * org's own additions.
   */
  async seedSharedProfiles(): Promise<number> {
    let written = 0;
    for (const seed of LENDER_PROFILE_SEED) {
      try {
        // findFirst + create/update rather than upsert: the compound unique is
        // (organizationId, matchPattern) and organizationId is null on a shared
        // row, which Prisma refuses to accept in a `where`. That is the same
        // nullable-column quirk the other foreclosure tables have.
        const existing = await this.prisma.lenderProfile.findFirst({
          where: { organizationId: null, matchPattern: seed.matchPattern },
          select: { id: true },
        });
        const fields = {
          matchType: seed.matchType,
          lenderName: seed.lenderName,
          loanType: seed.loanType,
          servicerType: seed.servicerType ?? null,
          notes: seed.notes ?? null,
          priority: seed.priority,
        };
        if (existing) {
          await this.prisma.lenderProfile.update({ where: { id: existing.id }, data: fields });
        } else {
          await this.prisma.lenderProfile.create({
            data: { organizationId: null, matchPattern: seed.matchPattern, active: true, ...fields },
          });
        }
        written++;
      } catch (e: any) {
        // A missing table (migration not yet applied) must not stop boot.
        this.logger.warn(`Lender profile seed skipped for "${seed.matchPattern}": ${e.message}`);
        return written;
      }
    }
    this.cache = null;
    this.logger.log(`Seeded ${written} shared lender profiles`);
    return written;
  }

  /** Shared profiles plus this org's own, newest cache within a minute. */
  async loadProfiles(organizationId?: string | null): Promise<LenderProfile[]> {
    const orgKey = organizationId || '';
    if (this.cache && this.cache.orgKey === orgKey && Date.now() - this.cache.loadedAt < PROFILE_CACHE_MS) {
      return this.cache.profiles;
    }
    const rows = await this.prisma.lenderProfile.findMany({
      where: {
        active: true,
        OR: [{ organizationId: null }, ...(organizationId ? [{ organizationId }] : [])],
      },
    });
    const profiles = rows.map((r) => ({
      matchPattern: r.matchPattern,
      matchType: r.matchType,
      lenderName: r.lenderName,
      loanType: r.loanType,
      servicerType: r.servicerType,
      priority: r.priority,
      active: r.active,
    }));
    this.cache = { profiles, loadedAt: Date.now(), orgKey };
    return profiles;
  }

  /** Drop the cache after an edit so a change is visible immediately. */
  invalidateCache() {
    this.cache = null;
  }

  /**
   * Classify a lead's filing and persist what the card needs.
   *
   * When the debt figure is unreliable, equityPct and equitySpread are set to
   * null rather than recomputed. That is a deliberate regression in what the
   * card shows: on a HECM those numbers were previously wrong, and a blank the
   * user can investigate beats a figure they would act on.
   */
  async evaluateLead(leadId: string, organizationId?: string | null): Promise<RulesResult | null> {
    const detail = await this.prisma.foreclosureDetail.findUnique({
      where: { leadId },
      select: { id: true, assessedValue: true, loanAmount: true },
    });
    if (!detail) return null;

    const filing = await this.prisma.foreclosureFiling.findFirst({
      where: { leadId },
      orderBy: { createdAt: 'desc' },
      // The stored text backs the caption rules, which catch an HOA claim of
      // lien whose association is not in the profile table.
      include: { document: { select: { rawText: true } } },
    });
    if (!filing) return null;

    const profiles = await this.loadProfiles(organizationId);
    const result = evaluateRules(filing, profiles, {
      assessedValue: detail.assessedValue,
      documentText: filing.document?.rawText,
    });

    // The equity math above already uses filing.originalPrincipal, so leaving
    // detail.loanAmount on the older 13-field figure makes the card contradict
    // itself: assessed minus loan amount would not equal the spread shown next
    // to it. Adopt the filing figure so the displayed numbers reconcile.
    const principalConfidence = (filing.fieldConfidence as Record<string, number> | null)
      ?.originalPrincipal;
    const adoptPrincipal = shouldAdoptFilingPrincipal(filing.originalPrincipal, principalConfidence);

    await this.prisma.foreclosureDetail.update({
      where: { id: detail.id },
      data: {
        loanType: result.loanType,
        lenderName: result.lenderName,
        debtFigureReliable: result.principalFigureReliable,
        // Null on an unreliable figure; the raw loanAmount stays visible with
        // a warning so the user can still see what was recorded.
        equitySpread: result.equitySpread,
        equityPct: result.equityPct,
        ...(adoptPrincipal ? { loanAmount: filing.originalPrincipal } : {}),
      },
    });

    if (adoptPrincipal && detail.loanAmount !== filing.originalPrincipal) {
      this.logger.log(
        `Lead ${leadId}: loanAmount ${detail.loanAmount ?? 'null'} -> ${filing.originalPrincipal} ` +
          'from the filing (25-field extraction supersedes the notice figure)',
      );
    } else if (!adoptPrincipal && filing.originalPrincipal != null) {
      this.logger.warn(
        `Lead ${leadId}: kept stored loanAmount; filing principal ${filing.originalPrincipal} ` +
          `scored ${principalConfidence}, below the adoption floor`,
      );
    }

    if (result.loanType === ForeclosureLoanType.REVERSE_HECM) {
      this.logger.log(
        `Lead ${leadId} classified REVERSE_HECM via ${result.matchedField} (${result.lenderName}); ` +
          'equity math suppressed',
      );
    }
    return result;
  }

  /** Evaluate without persisting - used by the signals pass and by previews. */
  async evaluateFiling(
    filing: {
      holderName?: string | null;
      originalBeneficiary?: string | null;
      hearingAt?: Date | null;
      saleAt?: Date | null;
      dotDate?: Date | null;
      originalPrincipal?: number | null;
    },
    organizationId?: string | null,
    assessedValue?: number | null,
  ): Promise<RulesResult> {
    const profiles = await this.loadProfiles(organizationId);
    return evaluateRules(filing, profiles, { assessedValue });
  }

  // ---- lender profile CRUD, for the in-app editor --------------------------

  async listProfiles(organizationId?: string | null) {
    return this.prisma.lenderProfile.findMany({
      where: { OR: [{ organizationId: null }, ...(organizationId ? [{ organizationId }] : [])] },
      orderBy: [{ loanType: 'asc' }, { priority: 'desc' }, { matchPattern: 'asc' }],
    });
  }

  async createProfile(data: any, organizationId?: string | null) {
    const created = await this.prisma.lenderProfile.create({
      data: {
        organizationId: organizationId || null,
        matchPattern: String(data.matchPattern || '').trim(),
        matchType: data.matchType === 'regex' ? 'regex' : 'substring',
        lenderName: String(data.lenderName || '').trim(),
        loanType: String(data.loanType || ForeclosureLoanType.UNKNOWN),
        servicerType: data.servicerType || null,
        notes: data.notes || null,
        priority: Number.isFinite(Number(data.priority)) ? Number(data.priority) : 0,
        active: data.active !== false,
      },
    });
    this.invalidateCache();
    return created;
  }

  /** Only an org's own rows are editable; shared seeded rows are read-only. */
  async updateProfile(id: string, data: any, organizationId?: string | null) {
    const existing = await this.prisma.lenderProfile.findFirst({
      where: { id, ...(organizationId ? { organizationId } : { organizationId: null }) },
    });
    if (!existing) return null;

    const patch: any = {};
    for (const field of ['matchPattern', 'lenderName', 'loanType', 'servicerType', 'notes']) {
      if (data[field] !== undefined) patch[field] = data[field] || null;
    }
    if (data.matchType !== undefined) patch.matchType = data.matchType === 'regex' ? 'regex' : 'substring';
    if (data.priority !== undefined && Number.isFinite(Number(data.priority))) {
      patch.priority = Number(data.priority);
    }
    if (data.active !== undefined) patch.active = !!data.active;

    const updated = await this.prisma.lenderProfile.update({ where: { id }, data: patch });
    this.invalidateCache();
    return updated;
  }

  async deleteProfile(id: string, organizationId?: string | null) {
    const existing = await this.prisma.lenderProfile.findFirst({
      where: { id, organizationId: organizationId || null },
    });
    if (!existing) return null;
    await this.prisma.lenderProfile.delete({ where: { id } });
    this.invalidateCache();
    return existing;
  }
}

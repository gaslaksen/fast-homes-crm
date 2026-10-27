import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CampaignExecutionService } from './campaign-execution.service';
import { moduleForSource } from '../companies/companies.service';
import {
  HEIR_CONTACT_SELECT,
  HeirContact,
  LEAD_EMAILS_SELECT,
  campaignEmailFor,
  heirBlockedReason,
  heirEmails,
  heirTextNumber,
  knownEmails,
} from './campaign-recipient';

/** ", for Ricardo Berrios" when the enrollment is a person on the case. */
function forWhom(enrollment: { heir?: { name: string } | null }): string {
  return enrollment.heir ? ` for ${enrollment.heir.name}` : '';
}

@Injectable()
export class CampaignEnrollmentService {
  private readonly logger = new Logger(CampaignEnrollmentService.name);

  constructor(
    private prisma: PrismaService,
    private execution: CampaignExecutionService,
  ) {}

  // Enrollment changes show up in the lead's conversation timeline and the
  // Activity pane via these records (best-effort; never blocks the change).
  private async logActivity(leadId: string, type: string, description: string) {
    try {
      await this.prisma.activity.create({ data: { leadId, type, description } });
    } catch (err) {
      this.logger.warn(`Could not log ${type} activity for lead ${leadId}: ${err.message}`);
    }
  }

  /**
   * opts.toEmail names which email EMAIL steps go to. It must already be on
   * the recipient. Omitted keeps whatever the enrollment had (the first email
   * for a new one); passing it to an existing enrollment changes the recipient
   * without restarting the sequence.
   *
   * opts.heirId enrolls a person on a surplus case rather than the claimant:
   * an heir, a relative, a neighbor. Their own phone and email are used, and
   * each person holds their own enrollment, so the son can be on the same
   * campaign as the claimant without either one replacing the other.
   */
  /**
   * A campaign that belongs to a company only takes that company's leads. A
   * lead always sends as its own company (its number, name and sign-off), so
   * a surplus claimant on a Quick Cash campaign would get "we buy houses"
   * wording from D.I.G. Deeper's number. A campaign with no company, or an
   * account with no companies set up, is not checked.
   */
  private async checkSameCompany(
    campaign: { name: string; brandId: string | null; brand?: { legalName: string; shortName: string | null } | null },
    lead: { source: string; organizationId: string | null },
  ) {
    if (!campaign.brandId || !lead.organizationId) return;
    const runs = await this.prisma.brandModule.findUnique({
      where: {
        organizationId_module: { organizationId: lead.organizationId, module: moduleForSource(lead.source) },
      },
      select: { brandId: true, brand: { select: { legalName: true, shortName: true } } },
    });
    if (!runs || runs.brandId === campaign.brandId) return;
    const name = (b?: { legalName: string; shortName: string | null } | null) =>
      b ? b.shortName || b.legalName : 'another company';
    throw new BadRequestException(
      `This is a ${name(runs.brand)} lead, and "${campaign.name}" is a ${name(campaign.brand)} campaign.`,
    );
  }

  async enrollLead(
    leadId: string,
    campaignId: string,
    opts: { toEmail?: string | null; heirId?: string | null } = {},
  ) {
    // Get campaign with its first step
    const campaign = await this.prisma.campaign.findUnique({
      where: { id: campaignId },
      include: {
        steps: { orderBy: { stepOrder: 'asc' } },
        brand: { select: { legalName: true, shortName: true } },
      },
    });
    if (!campaign) throw new NotFoundException('Campaign not found');

    // Verify the lead can actually receive messages on every channel this
    // campaign uses. Without this, a lead missing a phone or email can be
    // enrolled and then silently skipped at send time, leaving the user
    // thinking the message went out.
    const lead = await this.prisma.lead.findUnique({
      where: { id: leadId },
      select: {
        id: true,
        sellerPhone: true,
        doNotContact: true,
        source: true,
        organizationId: true,
        ...LEAD_EMAILS_SELECT,
      },
    });
    if (!lead) throw new NotFoundException('Lead not found');
    await this.checkSameCompany(campaign, lead);
    // Surplus claimants are enrolled like any other lead when a person picks
    // the campaign. Nothing enrolls them automatically: ingestion skips the
    // outreach scheduler and autoEnrollInDefaults leaves them out, so the
    // person who adds a claimant owns the wording under FS 45.033.

    const heirId = opts.heirId || null;
    let heir: HeirContact | null = null;
    if (heirId) {
      const row = await this.prisma.surplusHeir.findUnique({
        where: { id: heirId },
        select: HEIR_CONTACT_SELECT,
      });
      if (!row || row.surplusDetail?.leadId !== leadId) {
        throw new NotFoundException('That person is not on this case');
      }
      heir = row;
      const blocked = heirBlockedReason(heir);
      if (blocked) throw new BadRequestException(`${blocked}, so cannot be enrolled in a drip campaign.`);
    }
    // Who this is, in the words the activity log and errors use.
    const who = heir ? heir.name : 'Lead';

    const channels = new Set<string>(
      (campaign.steps ?? []).map((s: any) => s.channel),
    );
    const emails = heir ? heirEmails(heir) : knownEmails(lead);
    let toEmail: string | null | undefined = undefined;
    if (opts.toEmail !== undefined) {
      const wanted = (opts.toEmail || '').trim().toLowerCase();
      if (wanted) {
        const match = emails.find((e) => e.toLowerCase() === wanted);
        if (!match) {
          throw new BadRequestException(
            `${opts.toEmail} is not one of ${heir ? `${heir.name}'s` : "this lead's"} email addresses.`,
          );
        }
        toEmail = match;
      } else {
        toEmail = null;
      }
    }
    if (channels.has('EMAIL') && emails.length === 0) {
      throw new BadRequestException(
        `${who} has no email address, so cannot be enrolled in an email campaign`,
      );
    }
    if (channels.has('TEXT') && !(heir ? heirTextNumber(heir) : lead.sellerPhone)) {
      throw new BadRequestException(
        heir
          ? `${heir.name} has no phone number that is clear to text, so cannot be enrolled in an SMS campaign`
          : 'Lead has no phone number, so cannot be enrolled in an SMS campaign',
      );
    }
    // A claimant marked Do Not Contact holds the whole case, people included:
    // the send path refuses every text on the lead, so enrolling would only
    // queue skips.
    if (channels.has('TEXT') && lead.doNotContact) {
      throw new BadRequestException(
        'Lead is marked Do Not Contact, so cannot be enrolled in an SMS campaign',
      );
    }

    const recipientKey = heirId || '';
    const enrolledWhat = `${heir ? `${heir.name} enrolled` : 'Enrolled'} in drip campaign "${campaign.name}"${toEmail ? `, emailing ${toEmail}` : ''}`;

    // Check if already enrolled (upsert with unique constraint)
    const existing = await this.prisma.campaignEnrollment.findUnique({
      where: { campaignId_leadId_recipientKey: { campaignId, leadId, recipientKey } },
    });
    if (existing && existing.status !== 'REMOVED') {
      if (toEmail === undefined || toEmail === existing.toEmail) return existing;
      const updated = await this.prisma.campaignEnrollment.update({
        where: { id: existing.id },
        data: { toEmail },
      });
      await this.logActivity(
        leadId,
        'CAMPAIGN_RECIPIENT_CHANGED',
        `Drip campaign "${campaign.name}" now emails ${toEmail || emails[0] || (heir ? heir.name : 'the lead')}`,
      );
      return updated;
    }

    // Calculate first nextSendAt. delayDays/delayHours are cumulative offsets
    // from enrollment start (enrolledAt), the same convention used by every
    // subsequent step in CampaignExecutionService.calculateNextSendAt, so a
    // campaign with delays [0d, 1d, 2d, 3d] fires on day 0, 1, 2, 3 from
    // enrollment, not day 0, 1, 3, 6.
    //
    // For a brand new enrollment, enrolledAt === now, so step 1 with
    // delayDays=0 fires on the next cron tick.
    const firstStep = campaign.steps[0];
    const enrolledAt = new Date();
    let nextSendAt: Date | null = null;
    if (firstStep) {
      nextSendAt = new Date(enrolledAt.getTime());
      nextSendAt.setDate(nextSendAt.getDate() + (firstStep.delayDays ?? 0));
      nextSendAt.setHours(nextSendAt.getHours() + (firstStep.delayHours ?? 0));
    }

    if (existing) {
      // Re-enroll (was REMOVED). Reset enrolledAt to now so cumulative-from-
      // enrollment delays anchor on the re-enrollment date, not the original
      // (which would make every step fire immediately on the next cron tick).
      const reEnrolled = await this.prisma.campaignEnrollment.update({
        where: { id: existing.id },
        data: {
          status: 'ACTIVE',
          currentStepOrder: 0,
          nextSendAt,
          enrolledAt,
          completedAt: null,
          ...(toEmail !== undefined ? { toEmail } : {}),
        },
      });
      await this.logActivity(leadId, 'CAMPAIGN_ENROLLED', enrolledWhat);
      return reEnrolled;
    }

    const enrollment = await this.prisma.campaignEnrollment.create({
      data: {
        campaignId,
        leadId,
        heirId,
        recipientKey,
        currentStepOrder: 0,
        status: 'ACTIVE',
        enrolledAt,
        nextSendAt,
        toEmail: toEmail ?? null,
      },
    });
    await this.logActivity(leadId, 'CAMPAIGN_ENROLLED', enrolledWhat);
    return enrollment;
  }

  /**
   * Enroll many leads in one campaign, reporting per-lead outcomes instead of
   * failing the batch on the first bad lead. A list import lands hundreds of
   * leads at once and some of them will be missing an email or marked Do Not
   * Contact; those belong in a skip list the user can read, not in a 400 that
   * loses the other 145 enrollments.
   */
  async enrollLeads(leadIds: string[], campaignId: string) {
    const enrolled: string[] = [];
    const skipped: { leadId: string; reason: string }[] = [];

    for (const leadId of leadIds) {
      try {
        await this.enrollLead(leadId, campaignId);
        enrolled.push(leadId);
      } catch (err: any) {
        skipped.push({ leadId, reason: err?.message || 'Enrollment failed' });
      }
    }

    return { enrolled: enrolled.length, skipped, leadIds: enrolled };
  }

  /**
   * Recompute nextSendAt for everyone already enrolled, from the campaign's
   * CURRENT step delays.
   *
   * Enrollment stamps nextSendAt once, at enrollment time, so editing a
   * campaign's delays afterwards used to leave the existing queue sitting on
   * the old schedule - change step 1 from "day 2" to "immediately" and the
   * leads already in the campaign still waited two days. This brings them in
   * line without the alternative of removing and re-adding everyone, which
   * throws away enrollment history.
   *
   * Safe to run at any time: nextSendAt is derived from (enrolledAt,
   * cumulative delay), so re-deriving it is idempotent. Editing message copy
   * moves nobody; only editing a delay does.
   *
   * Deliberately narrow about what it touches:
   *   - ACTIVE only. Paused, replied, completed and removed enrollments keep
   *     whatever state they are in.
   *   - Never an enrollment with nextSendAt = null. That null is the cron's
   *     in-flight claim (see CampaignExecutionService.processScheduledMessages);
   *     writing a time back over it would hand the same step to the next tick
   *     as well and send the message twice.
   *   - The write is conditional on nextSendAt being unchanged since the read,
   *     so an enrollment the cron claims mid-resync is left to the cron.
   */
  async resyncSchedule(campaignId: string) {
    const campaign = await this.prisma.campaign.findUnique({
      where: { id: campaignId },
      include: { steps: { orderBy: { stepOrder: 'asc' } } },
    });
    if (!campaign) throw new NotFoundException('Campaign not found');

    const enrollments = await this.prisma.campaignEnrollment.findMany({
      where: { campaignId, status: 'ACTIVE', nextSendAt: { not: null } },
      select: { id: true, enrolledAt: true, currentStepOrder: true, nextSendAt: true },
    });

    const now = new Date();
    let rescheduled = 0;
    let dueNow = 0;
    let skipped = 0;

    for (const e of enrollments) {
      const nextStep = campaign.steps.find(
        (s: any) => s.stepOrder === e.currentStepOrder + 1,
      );
      if (!nextStep) { skipped++; continue; }

      const nextSendAt = this.execution.calculateNextSendAt(nextStep, e.enrolledAt);

      // Within a second of where it already sits: nothing to write.
      if (e.nextSendAt && Math.abs(nextSendAt.getTime() - e.nextSendAt.getTime()) < 1000) {
        skipped++;
        continue;
      }

      const claimed = await this.prisma.campaignEnrollment.updateMany({
        where: { id: e.id, nextSendAt: e.nextSendAt },
        data: { nextSendAt },
      });
      if (claimed.count === 0) { skipped++; continue; }

      rescheduled++;
      if (nextSendAt <= now) dueNow++;
    }

    this.logger.log(
      `Resynced campaign ${campaign.name}: ${rescheduled} rescheduled ` +
      `(${dueNow} now due), ${skipped} unchanged`,
    );
    return { rescheduled, dueNow, unchanged: skipped, total: enrollments.length };
  }

  async unenrollLead(enrollmentId: string) {
    const enrollment = await this.prisma.campaignEnrollment.update({
      where: { id: enrollmentId },
      data: { status: 'REMOVED' },
      include: { campaign: { select: { name: true } }, heir: { select: { name: true } } },
    });
    await this.logActivity(enrollment.leadId, 'CAMPAIGN_UNENROLLED', `Removed from drip campaign "${enrollment.campaign.name}"${forWhom(enrollment)}`);
    return enrollment;
  }

  async pauseEnrollment(enrollmentId: string) {
    const enrollment = await this.prisma.campaignEnrollment.update({
      where: { id: enrollmentId },
      data: { status: 'PAUSED' },
      include: { campaign: { select: { name: true } }, heir: { select: { name: true } } },
    });
    await this.logActivity(enrollment.leadId, 'CAMPAIGN_PAUSED', `Paused drip campaign "${enrollment.campaign.name}"${forWhom(enrollment)}`);
    return enrollment;
  }

  /**
   * Back to active. An enrollment paused by failed sends, or one that had its
   * send time cleared, has no nextSendAt and would sit active forever, so it
   * gets a fresh one the way resumeAllPaused does. Nothing left to send
   * completes it instead.
   */
  async resumeEnrollment(enrollmentId: string) {
    const current = await this.prisma.campaignEnrollment.findUnique({
      where: { id: enrollmentId },
      include: { campaign: { include: { steps: { orderBy: { stepOrder: 'asc' } } } } },
    });
    if (!current) throw new NotFoundException('Enrollment not found');
    const nextStep = current.campaign.steps.find(
      (s: any) => s.stepOrder === current.currentStepOrder + 1,
    );
    const data: any = { status: 'ACTIVE' };
    if (!nextStep) {
      Object.assign(data, { status: 'COMPLETED', completedAt: new Date(), nextSendAt: null });
    } else if (!current.nextSendAt) {
      data.nextSendAt = this.execution.calculateNextSendAt(nextStep, current.enrolledAt);
    }
    const enrollment = await this.prisma.campaignEnrollment.update({
      where: { id: enrollmentId },
      data,
      include: { campaign: { select: { name: true } }, heir: { select: { name: true } } },
    });
    await this.logActivity(enrollment.leadId, 'CAMPAIGN_RESUMED', `Resumed drip campaign "${enrollment.campaign.name}"${forWhom(enrollment)}`);
    return enrollment;
  }

  /**
   * Put every paused enrollment on a campaign back to active and give it a
   * fresh send time.
   *
   * A provider outage pauses enrollments in bulk (five failed attempts each),
   * and clicking Resume once per lead is not a recovery plan. Their nextSendAt
   * was cleared on pause, so it is recomputed here the same way resyncSchedule
   * does it; anything already past its cumulative time comes back due, and the
   * hourly throttle meters it out from there.
   */
  async resumeAllPaused(campaignId: string) {
    const campaign = await this.prisma.campaign.findUnique({
      where: { id: campaignId },
      include: { steps: { orderBy: { stepOrder: 'asc' } } },
    });
    if (!campaign) throw new NotFoundException('Campaign not found');

    const paused = await this.prisma.campaignEnrollment.findMany({
      where: { campaignId, status: 'PAUSED' },
      select: { id: true, leadId: true, enrolledAt: true, currentStepOrder: true },
    });

    let resumed = 0;
    for (const e of paused) {
      const nextStep = campaign.steps.find(
        (s: any) => s.stepOrder === e.currentStepOrder + 1,
      );
      // Nothing left to send: complete it rather than reviving it as active.
      if (!nextStep) {
        await this.prisma.campaignEnrollment.update({
          where: { id: e.id },
          data: { status: 'COMPLETED', completedAt: new Date(), nextSendAt: null },
        });
        continue;
      }

      await this.prisma.campaignEnrollment.update({
        where: { id: e.id },
        data: {
          status: 'ACTIVE',
          nextSendAt: this.execution.calculateNextSendAt(nextStep, e.enrolledAt),
        },
      });
      await this.logActivity(
        e.leadId,
        'CAMPAIGN_RESUMED',
        `Resumed drip campaign "${campaign.name}"`,
      );
      resumed++;
    }

    this.logger.log(
      `Resumed ${resumed} paused enrollment(s) on campaign ${campaign.name}`,
    );
    return { resumed, examined: paused.length };
  }

  /**
   * Remove all non-terminal enrollments for a lead (e.g., when lead marked DEAD).
   * Sweeps ACTIVE, PAUSED, and REPLIED so a dead lead never lingers on the campaign roster.
   */
  async removeAllActive(leadId: string) {
    const result = await this.prisma.campaignEnrollment.updateMany({
      where: { leadId, status: { notIn: ['REMOVED', 'COMPLETED', 'OPTED_OUT'] } },
      data: { status: 'REMOVED' },
    });
    if (result.count > 0) {
      this.logger.log(`🗑️ Removed ${result.count} campaign enrollment(s) for lead ${leadId}`);
    }
  }

  /**
   * End every live enrollment for one person on a surplus case, leaving the
   * claimant's and everyone else's alone. Used when that person opts out.
   */
  async removeAllForHeir(heirId: string, status: 'REMOVED' | 'OPTED_OUT' = 'OPTED_OUT') {
    const result = await this.prisma.campaignEnrollment.updateMany({
      where: { heirId, status: { notIn: ['REMOVED', 'COMPLETED', 'OPTED_OUT'] } },
      data: { status, nextSendAt: null },
    });
    if (result.count > 0) {
      this.logger.log(`Ended ${result.count} campaign enrollment(s) for case person ${heirId}`);
    }
    return result.count;
  }

  /**
   * Auto-enroll a lead in all active default campaigns.
   *
   * Surplus claimants are left out. The default campaigns are written for
   * sellers, and a claimant joins a drip only when a person picks one for
   * them (enrollLead from the work panel), never off a first reply.
   */
  async autoEnrollInDefaults(leadId: string) {
    const lead = await this.prisma.lead.findUnique({
      where: { id: leadId },
      select: { source: true },
    });
    if (lead?.source === 'SURPLUS') return;

    const campaigns = await this.prisma.campaign.findMany({
      where: { isActive: true, enrollmentMode: 'auto' },
    });
    for (const campaign of campaigns) {
      try {
        await this.enrollLead(leadId, campaign.id);
        this.logger.log(`📢 Auto-enrolled lead ${leadId} in campaign "${campaign.name}"`);
      } catch (err) {
        this.logger.warn(`Could not auto-enroll lead ${leadId} in campaign ${campaign.id}: ${err.message}`);
      }
    }
  }

  async handleReply(leadId: string) {
    const activeEnrollments = await this.prisma.campaignEnrollment.findMany({
      where: { leadId, status: 'ACTIVE' },
    });

    if (activeEnrollments.length === 0) return;

    await this.prisma.campaignEnrollment.updateMany({
      where: { leadId, status: 'ACTIVE' },
      data: { status: 'REPLIED' },
    });

    this.logger.log(
      `📨 Marked ${activeEnrollments.length} enrollment(s) as REPLIED for lead ${leadId}`,
    );
  }

  async getEnrollmentsForLead(leadId: string) {
    return this.prisma.campaignEnrollment.findMany({
      where: { leadId },
      include: {
        campaign: { select: { id: true, name: true, steps: { orderBy: { stepOrder: 'asc' } } } },
        // Null for the claimant. The panel files each enrollment under the
        // person it talks to.
        heir: { select: { id: true, name: true } },
        messageLogs: {
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
      orderBy: { enrolledAt: 'desc' },
    });
  }

  /**
   * The campaign's roster. Each row carries sendsToEmail and sendsToPhone,
   * resolved the same way the sender resolves them, so the screen shows where
   * the next message will actually go rather than what was picked once.
   */
  async getEnrollmentsForCampaign(campaignId: string, status?: string) {
    const rows = await this.prisma.campaignEnrollment.findMany({
      where: {
        campaignId,
        ...(status
          ? { status: status as any }
          : { status: { not: 'REMOVED' } }),
      },
      include: {
        lead: {
          select: {
            id: true,
            sellerFirstName: true,
            sellerLastName: true,
            propertyAddress: true,
            propertyCity: true,
            propertyState: true,
            sellerPhone: true,
            status: true,
            source: true,
            ...LEAD_EMAILS_SELECT,
          },
        },
        heir: { select: HEIR_CONTACT_SELECT },
        messageLogs: {
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
      orderBy: { enrolledAt: 'desc' },
    });
    return rows.map((r) => {
      const { surplusDetail, probateDetail, taxSaleDetail, foreclosureDetail, ...lead } = r.lead as any;
      // A person on the case is sent to on their own contacts, not the
      // claimant's. Only their id and name leave the API.
      const heir = r.heir as HeirContact | null;
      return {
        ...r,
        lead,
        heir: heir ? { id: heir.id, name: heir.name } : null,
        sendsToEmail: campaignEmailFor(r.toEmail, heir ? heirEmails(heir) : knownEmails(r.lead as any)),
        sendsToPhone: heir ? heirTextNumber(heir) : lead.sellerPhone || null,
      };
    });
  }
}

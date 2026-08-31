import {
  Injectable,
  Logger,
  OnModuleInit,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import * as os from 'os';
import { PrismaService } from '../prisma/prisma.service';
import { MessagesService } from '../messages/messages.service';
import { LeadsService } from '../leads/leads.service';
import {
  MailerService,
  describeMailgunError,
  isMailgunRateLimit,
  parseMailgunRetryAfter,
} from '../mailer/mailer.service';
import { brandForLeadSource } from '../common/company.constants';

// Instance tag for distinguishing Railway replicas in logs.
const INSTANCE_TAG = `${os.hostname()}/${process.pid}`;

// Max times we retry the same step before giving up and pausing the enrollment.
const MAX_STEP_ATTEMPTS = 5;

// Outbound email ceilings, across every campaign and sender, because Mailgun's
// limits are per domain and everything we send shares one.
//
// The observed limits on a domain whose account is on probation are 100
// requests a DAY plus a short-window recipient limit around 26. Both defaults
// sit under those with room for the sends that never reach the Email table and
// so cannot be counted here: the daily brief, password resets, deal packages.
//
// These are a courtesy pre-check, not the real defence. Mailgun counts
// requests rather than delivered mail, so a failed send costs quota too and no
// local count can track it exactly. The authority is Mailgun's own "try again
// after", honoured in sendWithRetry. Raise both with EMAIL_DAILY_LIMIT /
// EMAIL_HOURLY_LIMIT once the account is off probation.
const DEFAULT_EMAIL_DAILY_LIMIT = 90;
const DEFAULT_EMAIL_HOURLY_LIMIT = 20;

type StepOutcome =
  | { kind: 'SENT'; externalId?: string }
  // A send that was attempted and failed. Burns one of MAX_STEP_ATTEMPTS.
  | { kind: 'RETRY'; reason: string }
  // A send deliberately not attempted yet, because sending now would break a
  // rate limit. Distinct from RETRY on purpose: nothing failed, so it must not
  // count against the attempt budget. Treating throttling as failure is how a
  // lead ends up permanently PAUSED for the sin of being 81st in the hour.
  | { kind: 'DEFERRED'; reason: string; retryAt: Date }
  | { kind: 'SKIPPED'; reason: string };

interface LeadForTemplate {
  sellerFirstName?: string | null;
  sellerLastName?: string | null;
  propertyAddress?: string | null;
  propertyCity?: string | null;
  propertyState?: string | null;
  askingPrice?: number | null;
  arv?: number | null;
  sellerEmail?: string | null;
}

// Default campaign templates removed — campaigns are now created and managed
// entirely through the UI. The old hardcoded "Gentle Follow-Up", "Urgency Builder",
// and "Empathetic Long Game" templates were auto-enrolling leads and sending
// messages that conflicted with the AI CAMP system.

@Injectable()
export class CampaignExecutionService implements OnModuleInit {
  private readonly logger = new Logger(CampaignExecutionService.name);

  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
    @Inject(forwardRef(() => MessagesService))
    private messagesService: MessagesService,
    @Inject(forwardRef(() => LeadsService))
    private leadsService: LeadsService,
    private mailerService: MailerService,
  ) {}

  async onModuleInit() {
    // Old seed campaign deactivation removed — enrollment is now controlled
    // per-campaign via enrollmentMode ('manual' | 'auto').
  }

  // Run every 5 minutes
  @Cron('*/5 * * * *')
  async processScheduledMessages() {
    const now = new Date();
    const enrollments = await this.prisma.campaignEnrollment.findMany({
      where: {
        status: 'ACTIVE',
        nextSendAt: { lte: now },
        // A campaign toggled off stops sending. Without this the Active/Paused
        // control on the campaign page changed a flag and nothing else, so the
        // one obvious way to halt a campaign that is misfiring did not halt it.
        // Enrollments keep their nextSendAt and resume when it is switched back
        // on, so toggling off is a hold, not a cancellation.
        campaign: { isActive: true },
      },
      include: {
        campaign: {
          include: {
            steps: { orderBy: { stepOrder: 'asc' } },
          },
        },
        lead: true,
      },
      take: 50, // cap per run
    });

    if (enrollments.length > 0) {
      this.logger.log(`⏰ Processing ${enrollments.length} scheduled campaign message(s)`);
    }

    for (const enrollment of enrollments) {
      // Optimistic lock: atomically claim this enrollment to prevent
      // duplicate sends when Railway runs multiple instances during deploy.
      // The claim sets nextSendAt to null; executeStep is responsible for
      // restoring it on RETRY outcomes or advancing it on SENT/SKIPPED.
      const claimed = await this.prisma.campaignEnrollment.updateMany({
        where: {
          id: enrollment.id,
          nextSendAt: enrollment.nextSendAt, // only if unchanged since our query
        },
        data: { nextSendAt: null },
      });
      if (claimed.count === 0) {
        // Benign: another Railway replica already picked this up. Kept at
        // debug level so it doesn't flood prod logs.
        this.logger.debug(
          `[${INSTANCE_TAG}] Enrollment ${enrollment.id} already claimed by another instance — skipping`,
        );
        continue;
      }

      try {
        await this.executeStep(enrollment);
      } catch (err) {
        // Restore nextSendAt on unexpected failure so it retries next cron run.
        try {
          await this.prisma.campaignEnrollment.update({
            where: { id: enrollment.id },
            data: { nextSendAt: enrollment.nextSendAt },
          });
        } catch (restoreErr) {
          this.logger.error(
            `Failed to restore nextSendAt for enrollment ${enrollment.id}: ${restoreErr.message}`,
            restoreErr.stack,
          );
        }
        this.logger.error(
          `Failed to execute step for enrollment ${enrollment.id}: ${err.message}`,
          err.stack,
        );
      }
    }
  }

  // Stale lead auto-enrollment removed — was auto-enrolling leads in hardcoded
  // seed campaigns. Campaign enrollment is now manual (via UI) or triggered on
  // first inbound reply (via handleInboundMessage).

  async executeStep(enrollment: any) {
    const { campaign, lead } = enrollment;
    const steps: any[] = campaign.steps;

    // Find the current step (by stepOrder = currentStepOrder + 1, since we use 1-indexed stepOrder)
    const currentStep = steps.find((s: any) => s.stepOrder === enrollment.currentStepOrder + 1);

    if (!currentStep || !currentStep.isActive) {
      // No more steps — mark complete
      await this.prisma.campaignEnrollment.update({
        where: { id: enrollment.id },
        data: { status: 'COMPLETED', completedAt: new Date(), nextSendAt: null },
      });
      return;
    }

    // Load org once so merge fields resolve to the real company name
    // instead of the hardcoded "Fast Homes" default.
    const org = lead.organizationId
      ? await this.prisma.organization.findUnique({
          where: { id: lead.organizationId },
          select: { name: true },
        })
      : null;

    const renderedBody = this.renderTemplate(currentStep.body, lead, org);
    const renderedSubject = currentStep.subject
      ? this.renderTemplate(currentStep.subject, lead, org)
      : undefined;

    // Run the channel-specific send. This returns a StepOutcome and does NOT
    // touch the enrollment or log rows — that's the caller's responsibility
    // so outcomes and side effects stay in one place.
    const outcome = await this.dispatch(
      enrollment,
      lead,
      currentStep,
      renderedBody,
      renderedSubject,
    );

    if (outcome.kind === 'RETRY') {
      // Transient failure: count prior FAILED attempts for this step; pause
      // the enrollment if we've already retried too many times, otherwise
      // restore nextSendAt so the next cron run picks it up again.
      const priorFailures = await this.prisma.campaignMessageLog.count({
        where: {
          enrollmentId: enrollment.id,
          stepId: currentStep.id,
          status: 'FAILED',
        },
      });

      await this.prisma.campaignMessageLog.create({
        data: {
          enrollmentId: enrollment.id,
          stepId: currentStep.id,
          channel: currentStep.channel,
          messageBody: renderedBody,
          status: 'FAILED',
        },
      });

      if (priorFailures + 1 >= MAX_STEP_ATTEMPTS) {
        this.logger.error(
          `Enrollment ${enrollment.id} step ${currentStep.stepOrder} failed ${priorFailures + 1} times — pausing enrollment. Last reason: ${outcome.reason}`,
        );
        await this.prisma.campaignEnrollment.update({
          where: { id: enrollment.id },
          data: { status: 'PAUSED', nextSendAt: null },
        });
        return;
      }

      // Restore so the next cron run retries the same step.
      await this.prisma.campaignEnrollment.update({
        where: { id: enrollment.id },
        data: { nextSendAt: enrollment.nextSendAt },
      });
      this.logger.warn(
        `Enrollment ${enrollment.id} step ${currentStep.stepOrder} will retry (attempt ${priorFailures + 2}/${MAX_STEP_ATTEMPTS}): ${outcome.reason}`,
      );
      return;
    }

    if (outcome.kind === 'DEFERRED') {
      // Rate limited before we tried. Push the send out to when capacity frees
      // and leave the attempt budget, the step and the logs untouched, so the
      // lead is exactly where it was, just later.
      await this.prisma.campaignEnrollment.update({
        where: { id: enrollment.id },
        data: { nextSendAt: outcome.retryAt },
      });
      this.logger.log(
        `Enrollment ${enrollment.id} step ${currentStep.stepOrder} deferred to ` +
        `${outcome.retryAt.toISOString()}: ${outcome.reason}`,
      );
      return;
    }

    if (outcome.kind === 'SKIPPED') {
      // Permanent skip (missing contact field, org not connected, etc.).
      // Record a SKIPPED log row so the UI can show why nothing went out,
      // then advance the enrollment so it doesn't hang forever.
      await this.prisma.campaignMessageLog.create({
        data: {
          enrollmentId: enrollment.id,
          stepId: currentStep.id,
          channel: currentStep.channel,
          messageBody: renderedBody,
          status: 'SKIPPED',
        },
      });
      this.logger.warn(
        `Enrollment ${enrollment.id} step ${currentStep.stepOrder} skipped: ${outcome.reason}`,
      );
    } else {
      // SENT — record the log row with external ID if we have one.
      await this.prisma.campaignMessageLog.create({
        data: {
          enrollmentId: enrollment.id,
          stepId: currentStep.id,
          channel: currentStep.channel,
          messageBody: renderedBody,
          status: 'SENT',
          externalId: outcome.externalId,
        },
      });
    }

    // Note: Email touches are recorded inline in the EMAIL branch above (after
    // mailerService.sendAsDeals). SMS touches are recorded by
    // messagesService.sendMessage() via recordTouch('MESSAGE_SENT').
    // No additional recordTouch needed here — adding one would create duplicates.

    // Advance to next step (only reached for SENT or SKIPPED).
    const nextStep = steps.find((s: any) => s.stepOrder === currentStep.stepOrder + 1);
    if (nextStep) {
      // Step delays are cumulative from enrollment start, not from the
      // previous send. enrolledAt is the anchor.
      let nextSendAt = this.calculateNextSendAt(nextStep, enrollment.enrolledAt);

      // Catch-up safeguard: if a lead is backlogged (cumulative date is in
      // the past — common right after this fix is deployed, or whenever an
      // enrollment was paused and resumed), enforce a minimum 1-hour gap
      // from the send we just made so backlogged steps don't all fire on
      // the next cron tick. Fresh on-schedule enrollments are unaffected
      // because their cumulative date is always in the future.
      const minNext = new Date(Date.now() + 60 * 60 * 1000);
      if (nextSendAt < minNext) {
        nextSendAt = minNext;
      }

      await this.prisma.campaignEnrollment.update({
        where: { id: enrollment.id },
        data: {
          currentStepOrder: currentStep.stepOrder,
          nextSendAt,
          lastContactAt: outcome.kind === 'SENT' ? new Date() : enrollment.lastContactAt,
        },
      });
    } else {
      // Last step done
      await this.prisma.campaignEnrollment.update({
        where: { id: enrollment.id },
        data: {
          currentStepOrder: currentStep.stepOrder,
          status: 'COMPLETED',
          completedAt: new Date(),
          nextSendAt: null,
          lastContactAt: outcome.kind === 'SENT' ? new Date() : enrollment.lastContactAt,
        },
      });
    }
  }

  /**
   * A DEFERRED outcome when the trailing hour is already at the email ceiling,
   * or null when there is room to send.
   *
   * The retry time is derived rather than guessed: capacity frees when the
   * oldest send inside the window ages out of it, so that timestamp plus an
   * hour (plus a minute of slack for clock skew) is the first moment another
   * message is safe. Guessing a flat "try again in 10 minutes" would either
   * spin uselessly or idle longer than necessary.
   *
   * Set EMAIL_HOURLY_LIMIT to raise this once the Mailgun account is off
   * probation and the domain is warmed.
   */
  private async emailThrottle(): Promise<StepOutcome | null> {
    const daily = await this.emailWindowThrottle(
      'daily', 'day',
      24 * 60 * 60 * 1000,
      this.config.get<string>('EMAIL_DAILY_LIMIT'),
      DEFAULT_EMAIL_DAILY_LIMIT,
    );
    if (daily) return daily;

    return this.emailWindowThrottle(
      'hourly', 'hour',
      60 * 60 * 1000,
      this.config.get<string>('EMAIL_HOURLY_LIMIT'),
      DEFAULT_EMAIL_HOURLY_LIMIT,
    );
  }

  /** One rolling-window ceiling. Returns DEFERRED at the limit, else null. */
  private async emailWindowThrottle(
    label: string,
    windowName: string,
    windowMs: number,
    configured: string | undefined,
    fallback: number,
  ): Promise<StepOutcome | null> {
    const limit = Number(configured ?? fallback);
    if (!Number.isFinite(limit) || limit <= 0) return null;

    const windowStart = new Date(Date.now() - windowMs);
    const sent = await this.prisma.email.count({
      where: { direction: 'outbound', sentAt: { gte: windowStart } },
    });
    if (sent < limit) return null;

    const oldest = await this.prisma.email.findFirst({
      where: { direction: 'outbound', sentAt: { gte: windowStart } },
      orderBy: { sentAt: 'asc' },
      select: { sentAt: true },
    });

    // Capacity frees when the oldest send in the window ages out of it.
    const freesAt = oldest?.sentAt
      ? new Date(oldest.sentAt.getTime() + windowMs + 60 * 1000)
      : new Date(Date.now() + 10 * 60 * 1000);
    // Never schedule into the past, and never tighter than the cron's own tick.
    const retryAt = new Date(Math.max(freesAt.getTime(), Date.now() + 5 * 60 * 1000));

    return {
      kind: 'DEFERRED',
      reason: `email ${label} limit reached (${sent}/${limit} in the last ${windowName})`,
      retryAt,
    };
  }

  /**
   * Channel dispatch. Returns a StepOutcome describing what happened:
   *   - SENT:    message actually left the building; advance the step.
   *   - RETRY:   transient failure (network, rate limit, provider 5xx); caller
   *              should leave the enrollment on this step and try again.
   *   - SKIPPED: lead/org permanently can't receive on this channel; caller
   *              should advance past the step without claiming success.
   *
   * All side effects on enrollment/log rows are handled by the caller.
   */
  private async dispatch(
    enrollment: any,
    lead: any,
    currentStep: any,
    renderedBody: string,
    renderedSubject: string | undefined,
  ): Promise<StepOutcome> {
    if (currentStep.channel === 'TEXT') {
      if (!lead.sellerPhone) {
        return { kind: 'SKIPPED', reason: `lead ${lead.id} has no sellerPhone` };
      }
      if (lead.doNotContact) {
        return { kind: 'SKIPPED', reason: `lead ${lead.id} marked doNotContact` };
      }
      return this.sendWithRetry(enrollment, currentStep, async () => {
        // sendMessage returns null when throttled (recent outbound to the
        // same lead within 5 min). Treat that as a retryable failure so the
        // step doesn't silently advance.
        const result = await this.messagesService.sendMessage(lead.id, renderedBody);
        if (result === null) {
          throw new Error('throttled — another outbound was sent <5 min ago');
        }
        return undefined;
      });
    }

    if (currentStep.channel === 'EMAIL') {
      if (!lead.sellerEmail) {
        return { kind: 'SKIPPED', reason: `lead ${lead.id} has no sellerEmail` };
      }
      const orgId = lead.organizationId;
      if (!orgId) {
        return { kind: 'SKIPPED', reason: `lead ${lead.id} has no organizationId` };
      }
      const brand = brandForLeadSource(lead.source);
      const dealsFrom =
        brand.key === 'digdeeper'
          ? this.config.get<string>('EMAIL_DIGDEEPER_FROM') || 'deals@digdeeperllc.com'
          : this.config.get<string>('EMAIL_DEALS_FROM') || 'deals@quickcashhomebuyers.com';

      // Daily then hourly ceilings, across ALL outbound email rather than just
      // this campaign or this sender, because Mailgun's limits are per domain
      // and every one of our senders shares one. Crossing them does not merely
      // reject the extra message: it locks the domain out, taking the daily
      // brief and every reply down with the campaign.
      //
      // Deliberately still counted across brands even though each brand now
      // has its own domain and so its own limit. The ceiling is conservative
      // rather than wrong, and a shared counter cannot let a second brand
      // quietly lift the total we send. Split it per domain if Dig Deeper
      // volume ever makes the shared ceiling the binding constraint.
      const throttle = await this.emailThrottle();
      if (throttle) return throttle;

      const unsubUrl = this.mailerService.buildUnsubscribeUrl(lead.id);
      return this.sendWithRetry(enrollment, currentStep, async () => {
        const email = await this.mailerService.sendAsDeals({
          orgId,
          to: lead.sellerEmail,
          subject: renderedSubject || 'Following up on your property',
          bodyText: renderedBody,
          leadId: lead.id,
          listUnsubscribeUrl: unsubUrl,
          brand,
        });
        // MailerService persists the Email row but does not touch the lead;
        // record the EMAIL_SENT touch here to keep pipeline tracking accurate.
        await this.leadsService.recordTouch(lead.id, 'EMAIL_SENT', {
          description: `Email sent to ${lead.sellerEmail} from ${dealsFrom}`,
          metadata: { subject: renderedSubject, mailgunId: email.mailgunId },
        });
        return email.mailgunId || `${lead.id}-${Date.now()}`;
      });
    }

    return { kind: 'SKIPPED', reason: `unknown channel ${currentStep.channel}` };
  }

  /**
   * Try the given send function up to 3 times with backoff. Returns SENT on
   * success or RETRY with the last error message if all attempts throw.
   */
  private async sendWithRetry(
    enrollment: any,
    currentStep: any,
    doSend: () => Promise<string | undefined>,
  ): Promise<StepOutcome> {
    const delays = [0, 1000, 5000];
    let lastErr: any;
    for (let attempt = 0; attempt < 3; attempt++) {
      if (attempt > 0) {
        await new Promise((r) => setTimeout(r, delays[attempt]));
      }
      try {
        const externalId = await doSend();
        return { kind: 'SENT', externalId };
      } catch (err) {
        lastErr = err;

        // A sending limit is not a failure to retry into. Retrying burns more
        // of the very quota that is exhausted (Mailgun counts requests, not
        // just delivered mail), so stop here and come back when Mailgun says
        // to. Its own "try again after" beats any ceiling we keep ourselves.
        if (isMailgunRateLimit(err)) {
          const quoted = parseMailgunRetryAfter(err);
          const retryAt = new Date(
            Math.max(
              (quoted ?? new Date(Date.now() + 30 * 60 * 1000)).getTime(),
              Date.now() + 5 * 60 * 1000,
            ),
          );
          this.logger.warn(
            `Rate limited [${currentStep.channel}] enrollment=${enrollment.id}, ` +
            `holding until ${retryAt.toISOString()}: ${describeMailgunError(err)}`,
          );
          return {
            kind: 'DEFERRED',
            reason: `provider rate limit: ${describeMailgunError(err)}`,
            retryAt,
          };
        }

        this.logger.warn(
          `Send attempt ${attempt + 1} failed [${currentStep.channel}] enrollment=${enrollment.id}: ${describeMailgunError(err)}`,
          err?.stack,
        );
      }
    }
    return {
      kind: 'RETRY',
      reason: `all 3 send attempts failed: ${describeMailgunError(lastErr)}`,
    };
  }

  renderTemplate(
    body: string,
    lead: LeadForTemplate,
    org?: { name: string } | null,
  ): string {
    const offerAmount = lead.askingPrice
      ? `$${Math.round(lead.askingPrice).toLocaleString()}`
      : '';
    const arvEstimate = lead.arv
      ? `$${Math.round(lead.arv).toLocaleString()}`
      : '';
    const companyName =
      org?.name?.trim() ||
      this.config.get<string>('EMAIL_FROM_NAME') ||
      'Quick Cash Home Buyers';

    return body
      .replace(/\{\{firstName\}\}/g, lead.sellerFirstName || '')
      .replace(/\{\{lastName\}\}/g, lead.sellerLastName || '')
      .replace(/\{\{propertyAddress\}\}/g, lead.propertyAddress || '')
      .replace(/\{\{city\}\}/g, lead.propertyCity || '')
      .replace(/\{\{state\}\}/g, lead.propertyState || '')
      .replace(/\{\{offerAmount\}\}/g, offerAmount)
      .replace(/\{\{arvEstimate\}\}/g, arvEstimate)
      .replace(/\{\{companyName\}\}/g, companyName)
      .replace(/\{\{senderName\}\}/g, companyName)
      .replace(/\{\{[^}]+\}\}/g, ''); // clear any remaining merge fields
  }

  /**
   * Compute when a step should fire. delayDays/delayHours are interpreted as
   * CUMULATIVE offsets from `enrollmentStart`, not from the previous send —
   * so a campaign with steps [0d, 1d, 2d, 3d] fires on day 0, day 1, day 2,
   * day 3 from enrollment, not day 0, 1, 3, 6.
   *
   * If `enrollmentStart` is omitted (legacy callers), falls back to "now"
   * which preserves the old behavior.
   */
  calculateNextSendAt(
    step: any,
    enrollmentStart?: Date,
    timezone = 'America/Chicago',
  ): Date {
    const base = enrollmentStart ? new Date(enrollmentStart.getTime()) : new Date();
    const next = new Date(base.getTime());
    next.setDate(next.getDate() + (step.delayDays ?? 0));
    next.setHours(next.getHours() + (step.delayHours ?? 0));

    if (step.sendWindowStart && step.sendWindowEnd) {
      const [startH, startM] = step.sendWindowStart.split(':').map(Number);
      const [endH, endM] = step.sendWindowEnd.split(':').map(Number);

      // Compare in the user's local timezone, not UTC
      const localTimeStr = next.toLocaleString('en-US', { timeZone: timezone });
      const localNow = new Date(localTimeStr);
      const localMinutes = localNow.getHours() * 60 + localNow.getMinutes();
      const startMinutes = startH * 60 + startM;
      const endMinutes = endH * 60 + endM;

      if (localMinutes < startMinutes || localMinutes > endMinutes) {
        // Calculate UTC offset: difference between UTC hours and local hours
        const offsetMs = next.getTime() - localNow.getTime();

        if (localMinutes > endMinutes) {
          next.setDate(next.getDate() + 1);
        }
        // Set local time then shift back to UTC
        const localTarget = new Date(next);
        localTarget.setHours(startH, startM, 0, 0);
        return new Date(localTarget.getTime() + offsetMs);
      }
    }

    return next;
  }
}

/**
 * The follow-up cadences, run every morning.
 *
 * The course's rule is that control comes from staying ahead of
 * communication on every side of the file: the county is asked about a
 * filed claim at least monthly, and the claimant hears from us at least
 * monthly whether or not there is news, because a routine "no update yet"
 * reads as normal and silence reads as a problem. The stage changes create
 * the first task of each; this creates the next one when the last has been
 * done and the month has passed, so the cadence does not depend on somebody
 * remembering to set the next reminder.
 *
 * The task is the reminder: it shows on the lead, the dashboard and the
 * daily brief, and the reminder cron emails it when due.
 *
 * The rechecks are the other half. A claimant nobody has reached, with no
 * number to ring, gets the free searches run again after sixty days and
 * another letter after ninety: people move, phones change, an obituary
 * appears, and a file that was a dead end in March is not one in June.
 * The search log is the recheck history, so the task fires off the last
 * logged search rather than off a date somebody remembered to set.
 */

import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { CronLockService } from '../common/cron-lock.service';
import { LeadSource, SurplusStage, SURPLUS_TIER1_CHANNELS } from '@fast-homes/shared';
import { CLAIMANT_UPDATE_DAYS, COUNTY_FOLLOW_UP_DAYS, TIER1_RECHECK_DAYS, REMAIL_DAYS } from './surplus.service';

const DAY = 86_400_000;

/** The recheck task titles, exported so the brief can count them. */
export const recheckTitle = (name: string) => `Re-run the free searches for ${name}`;
export const remailTitle = (name: string) => `Write to ${name} again`;
export const RECHECK_TITLE_PREFIX = 'Re-run the free searches for ';
export const REMAIL_TITLE_PREFIX = 'Write to ';
export const REMAIL_TITLE_SUFFIX = ' again';

/** Stages where nobody has signed and a claimant can still be unreached. */
const UNREACHED_STAGES = [SurplusStage.NEW, SurplusStage.CONTACTED];

/** Stages where the county has the claim and should be asked about it. */
const COUNTY_STAGES = [SurplusStage.CLAIM_FILED, SurplusStage.AWAITING_DISBURSEMENT];
/** Stages where the claimant has signed and is owed a monthly word. */
const SIGNED_STAGES = [
  SurplusStage.AGREEMENT_SIGNED,
  SurplusStage.PACKAGE_NOTARIZED,
  SurplusStage.CLAIM_FILED,
  SurplusStage.AWAITING_DISBURSEMENT,
  SurplusStage.CHECK_RECEIVED,
];

@Injectable()
export class SurplusCadenceService {
  private readonly logger = new Logger(SurplusCadenceService.name);
  private readonly enabled: boolean;

  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
    private lock: CronLockService,
  ) {
    this.enabled = String(config.get('SURPLUS_CADENCE_ENABLED') ?? 'true').toLowerCase() !== 'false';
  }

  /** After the county pulls and before the brief, so the brief carries today's tasks. */
  @Cron('15 6 * * *', { timeZone: 'America/New_York' })
  async daily() {
    if (!this.enabled) return;
    await this.lock.run('surplus-cadence', () => this.runOnce());
  }

  /** One pass over every live claim. Returns what it created, for the log and the manual trigger. */
  async runOnce(): Promise<{ countyTasks: number; claimantTasks: number; recheckTasks: number; remailTasks: number }> {
    const now = new Date();
    const rechecks = await this.rechecks(now);
    const leads = await this.prisma.lead.findMany({
      where: {
        source: LeadSource.SURPLUS,
        surplusDetail: { stage: { in: [...new Set([...COUNTY_STAGES, ...SIGNED_STAGES])] } },
      },
      select: {
        id: true,
        sellerFirstName: true,
        sellerLastName: true,
        surplusDetail: {
          select: {
            stage: true,
            submittedAt: true,
            countyAcknowledgedAt: true,
            lastClaimantUpdateAt: true,
            notaryAgreementSignedAt: true,
            attorneyName: true,
            attorneyEngagedAt: true,
            updatedAt: true,
          },
        },
        tasks: {
          where: { OR: [{ completed: false }, { completedAt: { gte: new Date(now.getTime() - 60 * DAY) } }] },
          select: { title: true, completed: true, completedAt: true, dueDate: true },
        },
      },
    });

    let countyTasks = 0;
    let claimantTasks = 0;
    for (const lead of leads) {
      const d = lead.surplusDetail;
      if (!d) continue;
      const name = `${lead.sellerFirstName || ''} ${lead.sellerLastName || ''}`.trim() || 'the claimant';
      const attorney = d.attorneyEngagedAt || d.attorneyName ? d.attorneyName || 'the attorney' : null;

      if (COUNTY_STAGES.includes(d.stage as SurplusStage)) {
        if (await this.nextCountyTask(lead.id, name, attorney, d, lead.tasks, now)) countyTasks += 1;
      }
      if (SIGNED_STAGES.includes(d.stage as SurplusStage)) {
        if (await this.nextClaimantTask(lead.id, name, d, lead.tasks, now)) claimantTasks += 1;
      }
    }
    if (countyTasks || claimantTasks || rechecks.recheckTasks || rechecks.remailTasks) {
      this.logger.log(
        `Cadence: ${countyTasks} county follow-up(s), ${claimantTasks} claimant update(s), ${rechecks.recheckTasks} recheck(s), ${rechecks.remailTasks} re-mail(s) scheduled`,
      );
    }
    return { countyTasks, claimantTasks, ...rechecks };
  }

  /**
   * The rechecks on unreached claimants. Reads the search log and the
   * letter history rather than the trace stamp, so a search somebody ran by
   * hand last week counts and a BatchData run from a year ago does not.
   */
  async rechecks(now: Date): Promise<{ recheckTasks: number; remailTasks: number }> {
    const leads = await this.prisma.lead.findMany({
      where: {
        source: LeadSource.SURPLUS,
        status: { not: 'DEAD' },
        surplusDetail: { stage: { in: UNREACHED_STAGES }, tappedAt: null, doNotCall: false },
      },
      select: {
        id: true,
        sellerFirstName: true,
        sellerLastName: true,
        sellerPhone: true,
        surplusDetail: {
          select: {
            phone2: true,
            phone3: true,
            phone4: true,
            phone1Dnc: true,
            phone2Dnc: true,
            phone3Dnc: true,
            phone4Dnc: true,
            ownerMailingStreet: true,
            letterMailedTo: true,
            letters: { orderBy: { mailedAt: 'desc' }, take: 1, select: { mailedAt: true } },
            traceAttempts: {
              where: { heirId: null, channel: { in: [...SURPLUS_TIER1_CHANNELS] }, result: { not: 'skipped' } },
              orderBy: { ranAt: 'desc' },
              take: 1,
              select: { ranAt: true },
            },
          },
        },
        tasks: {
          where: { OR: [{ completed: false }, { completedAt: { gte: new Date(now.getTime() - REMAIL_DAYS * DAY) } }] },
          select: { title: true, completed: true, completedAt: true },
        },
      },
    });

    let recheckTasks = 0;
    let remailTasks = 0;
    for (const lead of leads) {
      const d = lead.surplusDetail;
      if (!d) continue;
      const name = `${lead.sellerFirstName || ''} ${lead.sellerLastName || ''}`.trim() || 'the claimant';
      const callable =
        [
          [lead.sellerPhone, d.phone1Dnc],
          [d.phone2, d.phone2Dnc],
          [d.phone3, d.phone3Dnc],
          [d.phone4, d.phone4Dnc],
        ].some(([num, dnc]) => !!num && !dnc);

      // The free searches again. Only for somebody with no number to ring
      // (a number means the work is calling, not searching) and only once
      // they have been searched at all: the first search is the tracing
      // queue's job, and a task saying "search" on a file nobody has
      // touched would just duplicate the board.
      const lastTier1 = d.traceAttempts[0]?.ranAt ? new Date(d.traceAttempts[0].ranAt).getTime() : null;
      if (!callable && lastTier1 !== null && now.getTime() - lastTier1 >= TIER1_RECHECK_DAYS * DAY) {
        if (!this.pending(lead.tasks, recheckTitle(name), TIER1_RECHECK_DAYS, now)) {
          await this.createTask(lead.id, recheckTitle(name), now);
          recheckTasks += 1;
        }
      }

      // Another letter. There is an address, a letter went out, ninety days
      // have passed and nothing came back.
      const lastLetter = d.letters[0]?.mailedAt ? new Date(d.letters[0].mailedAt).getTime() : null;
      const hasAddress = !!(d.ownerMailingStreet || d.letterMailedTo);
      if (hasAddress && lastLetter !== null && now.getTime() - lastLetter >= REMAIL_DAYS * DAY) {
        if (!this.pending(lead.tasks, remailTitle(name), REMAIL_DAYS, now)) {
          await this.createTask(lead.id, remailTitle(name), now);
          remailTasks += 1;
        }
      }
    }
    return { recheckTasks, remailTasks };
  }

  /** A task with this title is open, or was done within the window (done without logging is still done). */
  private pending(tasks: { title: string; completed: boolean; completedAt: Date | null }[], title: string, windowDays: number, now: Date) {
    return tasks.some(
      (t) =>
        t.title === title &&
        (!t.completed || (t.completedAt && now.getTime() - new Date(t.completedAt).getTime() < windowDays * DAY)),
    );
  }

  /** The titles the county follow-up has used, so open and done ones are recognized. */
  private countyTitles(name: string, attorney: string | null): string[] {
    return [
      `Check with the clerk on ${name}'s claim`,
      `Check with the clerk on ${name}'s disbursement`,
      `Ask ${attorney || 'the attorney'} where ${name}'s claim stands with the clerk`,
      `Ask ${attorney || 'the attorney'} when the county will pay ${name}'s claim`,
    ];
  }

  private async nextCountyTask(
    leadId: string,
    name: string,
    attorney: string | null,
    d: any,
    tasks: any[],
    now: Date,
  ): Promise<boolean> {
    const titles = this.countyTitles(name, attorney);
    const mine = tasks.filter((t) => titles.includes(t.title));
    if (mine.some((t) => !t.completed)) return false;
    const lastDone = mine
      .filter((t) => t.completed && t.completedAt)
      .map((t) => new Date(t.completedAt).getTime())
      .sort((a, b) => b - a)[0];
    // The clock starts at the last check, or at the acknowledgement, or at
    // the filing. Only the first check runs on the shorter stage timer.
    const since = lastDone ?? (d.countyAcknowledgedAt || d.submittedAt ? new Date(d.countyAcknowledgedAt || d.submittedAt).getTime() : null);
    if (since === null) return false;
    if (now.getTime() - since < COUNTY_FOLLOW_UP_DAYS * DAY) return false;
    const title =
      d.stage === SurplusStage.AWAITING_DISBURSEMENT
        ? attorney
          ? `Ask ${attorney} when the county will pay ${name}'s claim`
          : `Check with the clerk on ${name}'s disbursement`
        : attorney
          ? `Ask ${attorney} where ${name}'s claim stands with the clerk`
          : `Check with the clerk on ${name}'s claim`;
    await this.createTask(leadId, title, now);
    return true;
  }

  private async nextClaimantTask(leadId: string, name: string, d: any, tasks: any[], now: Date): Promise<boolean> {
    const title = `Monthly update to ${name}`;
    if (tasks.some((t) => t.title === title && !t.completed)) return false;
    const last = d.lastClaimantUpdateAt || d.notaryAgreementSignedAt || d.updatedAt;
    if (!last) return false;
    if (now.getTime() - new Date(last).getTime() < CLAIMANT_UPDATE_DAYS * DAY) return false;
    await this.createTask(leadId, title, now);
    return true;
  }

  private async createTask(leadId: string, title: string, dueDate: Date) {
    await this.prisma.task.create({ data: { leadId, title, dueDate } });
    await this.prisma.activity.create({
      data: {
        leadId,
        type: 'TASK_CREATED',
        description: `Task created: ${title}`,
        metadata: { title, dueDate: dueDate.toISOString(), auto: true, cadence: true },
      },
    });
  }
}

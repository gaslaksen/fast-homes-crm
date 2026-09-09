/**
 * The two follow-up cadences on a filed claim, run every morning.
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
 */

import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { CronLockService } from '../common/cron-lock.service';
import { LeadSource, SurplusStage } from '@fast-homes/shared';
import { CLAIMANT_UPDATE_DAYS, COUNTY_FOLLOW_UP_DAYS } from './surplus.service';

const DAY = 86_400_000;

/** Stages where the county has the claim and should be asked about it. */
const COUNTY_STAGES = [SurplusStage.CLAIM_FILED, SurplusStage.AWAITING_DISBURSEMENT];
/** Stages where the claimant has signed and is owed a monthly word. */
const SIGNED_STAGES = [
  SurplusStage.AGREEMENT_SIGNED,
  SurplusStage.ASSIGNMENT_NOTARIZED,
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
  async runOnce(): Promise<{ countyTasks: number; claimantTasks: number }> {
    const now = new Date();
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
    if (countyTasks || claimantTasks) {
      this.logger.log(`Cadence: ${countyTasks} county follow-up(s), ${claimantTasks} claimant update(s) scheduled`);
    }
    return { countyTasks, claimantTasks };
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

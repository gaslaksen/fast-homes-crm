import { Injectable, Logger } from '@nestjs/common';
import { LeadSource, SURPLUS_DEAD_REASON_LABEL, SurplusStage } from '@fast-homes/shared';
import { PrismaService } from '../prisma/prisma.service';
import {
  LETTER_REPLY_TASK_PREFIX,
  countyRetirement,
  isSignedStage,
  outcomeDeadReason,
} from './surplus-progress.util';
import { clerkTaskTitle, countyReadiness, practiceRunTaskTitle } from './surplus-county-readiness.util';

const DAY = 86_400_000;

/**
 * Moves the course's four fields on a surplus case (Stage, Next action,
 * Owner, Due) as a side effect of the work, so nobody has to remember to.
 *
 * Reviewed against production on 2026-10-31: every case was New, Owner was
 * Nobody, and the only thing that ever moved a stage was a saved call
 * outcome, which almost never happened. A reply from the claimant did not
 * move the stage, the first call did not claim an owner, and a letter's
 * "check for a reply" task stayed open after the reply came in.
 *
 * Every method is safe to call on a non-surplus lead (it does nothing) and
 * never throws into the caller: the text, call or email has already happened
 * and must not be rolled back by bookkeeping.
 */
@Injectable()
export class SurplusProgressService {
  private readonly logger = new Logger(SurplusProgressService.name);

  constructor(private prisma: PrismaService) {}

  /**
   * Somebody on the case got back to us, or picked up the phone: a New case
   * is now Contacted, and the letter follow-up waiting on that person is done.
   * `heirId` names the person when it was not the claimant themselves.
   */
  async contacted(
    leadId: string,
    opts: { heirId?: string | null; userId?: string | null; how: string },
  ): Promise<void> {
    try {
      const lead = await this.surplusLead(leadId);
      if (!lead?.surplusDetail) return;
      const who = opts.heirId
        ? (await this.prisma.surplusHeir.findUnique({ where: { id: opts.heirId }, select: { name: true } }))?.name ||
          'a person on the case'
        : this.claimantName(lead);

      if (lead.surplusDetail.stage === SurplusStage.NEW) {
        await this.prisma.surplusDetail.update({
          where: { id: lead.surplusDetail.id },
          data: { stage: SurplusStage.CONTACTED },
        });
        await this.prisma.activity.create({
          data: {
            leadId,
            userId: opts.userId || undefined,
            type: 'STAGE_CHANGED',
            description: `Stage New to Contacted: ${who} ${opts.how}.`,
            metadata: { from: SurplusStage.NEW, to: SurplusStage.CONTACTED, heirId: opts.heirId || null },
          },
        });
      }

      // The letter's promise is kept the moment they answer. The task is
      // scoped to the person it named, so a son's reply does not close the
      // follow-up on the letter to his father.
      await this.prisma.task.updateMany({
        where: {
          leadId,
          completed: false,
          title: { startsWith: LETTER_REPLY_TASK_PREFIX },
          heirId: opts.heirId || null,
        },
        data: { completed: true, completedAt: new Date() },
      });
    } catch (err: any) {
      this.logger.warn(`Could not mark ${leadId} contacted: ${err.message}`);
    }
  }

  /**
   * A teammate touched the case. An unowned case becomes theirs, which is the
   * course's Owner field filling itself on the first call, text, email or
   * letter. An owner already set is never changed here.
   */
  async owned(leadId: string, userId: string | null | undefined, how: string): Promise<void> {
    if (!userId) return;
    try {
      const lead = await this.prisma.lead.findFirst({
        where: { id: leadId, source: LeadSource.SURPLUS },
        select: { id: true, assignedToUserId: true },
      });
      if (!lead || lead.assignedToUserId) return;
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { firstName: true, lastName: true },
      });
      if (!user) return;
      const name = `${user.firstName || ''} ${user.lastName || ''}`.trim() || 'a teammate';
      await this.prisma.lead.update({ where: { id: leadId }, data: { assignedToUserId: userId } });
      await this.prisma.note.create({
        data: { leadId, userId, content: `Owner set to ${name} (${how}).` },
      });
    } catch (err: any) {
      this.logger.warn(`Could not set the owner on ${leadId}: ${err.message}`);
    }
  }

  /**
   * A connected call where the answer was no. Only the person who can sign
   * closes the case: a relative saying "not interested" is passed along, not
   * acted on. A case a client has already signed is never closed by a call.
   * Returns true when the case was closed.
   */
  async closedByOutcome(
    leadId: string,
    outcome: string | null | undefined,
    opts: { heirId?: string | null; userId?: string | null; note?: string | null },
  ): Promise<boolean> {
    const reason = outcomeDeadReason(outcome);
    if (!reason) return false;
    try {
      const lead = await this.surplusLead(leadId);
      const d = lead?.surplusDetail;
      if (!lead || !d) return false;
      if (d.stage === SurplusStage.DEAD || isSignedStage(d.stage)) return false;
      if (opts.heirId) {
        const person = await this.prisma.surplusHeir.findUnique({
          where: { id: opts.heirId },
          select: { role: true },
        });
        if (!person || person.role !== 'heir') return false;
      }
      const label = SURPLUS_DEAD_REASON_LABEL[reason];
      const note = `Said on the phone: ${label.toLowerCase()}.${opts.note ? ` ${opts.note}` : ''}`;
      await this.retire(leadId, d.id, d.stage, {
        deadReason: reason,
        deadNote: note,
        description: `Stage ${d.stage || SurplusStage.NEW} to Dead: ${label}.`,
        userId: opts.userId || null,
      });
      return true;
    } catch (err: any) {
      this.logger.warn(`Could not close ${leadId} from the call outcome: ${err.message}`);
      return false;
    }
  }

  /**
   * The first yes or maybe in a county: the county has to be ready to file
   * in before the signature, so one task asks the clerk the five questions
   * (claim form, third party or POA, submission method, signature,
   * attorney) and one books the course's practice run of the document set.
   * Both are once per county across the org, keyed on the title, and land
   * on the case that raised them, owned by whoever took the call. A county
   * already ready, with its practice run done, opens nothing.
   */
  async countyPrep(leadId: string, opts: { userId?: string | null; how: string }): Promise<{ clerkTask: boolean; practiceTask: boolean }> {
    const out = { clerkTask: false, practiceTask: false };
    try {
      const lead = await this.prisma.lead.findFirst({
        where: { id: leadId, source: LeadSource.SURPLUS },
        select: { id: true, organizationId: true, surplusDetail: { select: { county: true } } },
      });
      const county = String(lead?.surplusDetail?.county || '').trim();
      if (!lead || !county) return out;
      const row = await this.prisma.surplusCounty.findFirst({
        where: { organizationId: lead.organizationId, name: { equals: county, mode: 'insensitive' } },
      });
      const readiness = countyReadiness(row);
      const name = row?.name || county;
      const open = async (title: string, days: number) => {
        // Once per county for the whole org: a second maybe in Hernando
        // does not ask the clerk twice.
        const exists = await this.prisma.task.findFirst({
          where: { title, lead: { organizationId: lead.organizationId } },
          select: { id: true },
        });
        if (exists) return false;
        const dueDate = new Date(Date.now() + days * DAY);
        dueDate.setHours(9, 0, 0, 0);
        await this.prisma.task.create({ data: { leadId, title, dueDate, userId: opts.userId || undefined } });
        await this.prisma.activity.create({
          data: {
            leadId,
            userId: opts.userId || undefined,
            type: 'TASK_CREATED',
            description: `Task created: ${title}`,
            metadata: { title, dueDate: dueDate.toISOString(), auto: true, countyPrep: true, how: opts.how },
          },
        });
        return true;
      };
      if (!readiness.ready) out.clerkTask = await open(clerkTaskTitle(name), 1);
      if (!readiness.practiceRun) out.practiceTask = await open(practiceRunTaskTitle(name), 7);
      if (out.clerkTask || out.practiceTask) {
        await this.prisma.activity.create({
          data: {
            leadId,
            userId: opts.userId || undefined,
            type: 'NOTE_ADDED',
            description: `${name} is not ready to file in (${readiness.unknowns.length ? `still to ask the clerk: ${readiness.unknowns.join(', ')}` : 'practice run not done'}). Opened by ${opts.how}.`,
            metadata: { auto: true, countyPrep: true, unknowns: readiness.unknowns, practiceRun: readiness.practiceRun },
          },
        });
      }
    } catch (err: any) {
      this.logger.warn(`Could not open the county prep tasks for ${leadId}: ${err.message}`);
    }
    return out;
  }

  /**
   * The weekly pull found the docket no longer workable. The stage write
   * itself happens in the pull's own update (see `countyRetirement`); this is
   * the bookkeeping around it: the lead's status, the timeline, the open
   * tasks and the drips, which the pull used to leave running on a case the
   * county had already paid out.
   */
  async countyRetired(leadId: string, claimStatus: string | null, stage: string | null): Promise<void> {
    const verdict = countyRetirement(stage, claimStatus, false);
    try {
      if (verdict.action === 'retire') {
        await this.prisma.lead.update({ where: { id: leadId }, data: { status: 'DEAD' } });
        await this.prisma.activity.create({
          data: {
            leadId,
            type: 'STAGE_CHANGED',
            description: `Stage ${stage || SurplusStage.NEW} to Dead: ${verdict.data.deadNote}`,
            metadata: { from: stage, to: SurplusStage.DEAD, deadReason: verdict.data.deadReason, claimStatus },
          },
        });
        await this.closeOpenWork(leadId);
      } else if (verdict.action === 'keep') {
        await this.prisma.activity.create({
          data: {
            leadId,
            type: 'DOCKET_CHANGED',
            description: verdict.why,
            metadata: { stage, claimStatus },
          },
        });
      }
    } catch (err: any) {
      this.logger.warn(`Could not record the county retirement on ${leadId}: ${err.message}`);
    }
  }

  private async retire(
    leadId: string,
    detailId: string,
    fromStage: string | null,
    opts: { deadReason: string; deadNote: string; description: string; userId: string | null },
  ): Promise<void> {
    await this.prisma.surplusDetail.update({
      where: { id: detailId },
      data: { stage: SurplusStage.DEAD, deadReason: opts.deadReason, deadNote: opts.deadNote, deadAt: new Date() },
    });
    await this.prisma.lead.update({ where: { id: leadId }, data: { status: 'DEAD' } });
    await this.prisma.activity.create({
      data: {
        leadId,
        userId: opts.userId || undefined,
        type: 'STAGE_CHANGED',
        description: opts.description,
        metadata: { from: fromStage, to: SurplusStage.DEAD, deadReason: opts.deadReason },
      },
    });
    await this.closeOpenWork(leadId);
  }

  /** A Dead case has no next action and no drips. */
  private async closeOpenWork(leadId: string): Promise<void> {
    await this.prisma.task.updateMany({
      where: { leadId, completed: false },
      data: { completed: true, completedAt: new Date() },
    });
    // Mirrors CampaignEnrollmentService.removeAllActive, which this module
    // does not import.
    await this.prisma.campaignEnrollment.updateMany({
      where: { leadId, status: { notIn: ['REMOVED', 'COMPLETED', 'OPTED_OUT'] } },
      data: { status: 'REMOVED', nextSendAt: null },
    });
  }

  private async surplusLead(leadId: string) {
    return this.prisma.lead.findFirst({
      where: { id: leadId, source: LeadSource.SURPLUS },
      select: {
        id: true,
        sellerFirstName: true,
        sellerLastName: true,
        surplusDetail: { select: { id: true, stage: true } },
      },
    });
  }

  private claimantName(lead: { sellerFirstName: string | null; sellerLastName: string | null }): string {
    return `${lead.sellerFirstName || ''} ${lead.sellerLastName || ''}`.trim() || 'the claimant';
  }
}

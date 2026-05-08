import { Injectable, Inject, forwardRef, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Anthropic from '@anthropic-ai/sdk';
import { PrismaService } from '../prisma/prisma.service';
import { DripService } from '../drip/drip.service';
import { CampaignEnrollmentService } from '../campaigns/campaign-enrollment.service';
import { sanitizeOutboundSmsBody } from '../webhooks/sms-body-normalize.util';

const TERMINAL_STATUSES_FOR_REMOVAL = ['DEAD', 'SOLD', 'SOLD_LOSS', 'HELD_LONG_TERM', 'CANCELLED', 'CLOSED_LOST', 'OPTED_OUT'];

@Injectable()
export class PipelineService {
  private readonly logger = new Logger(PipelineService.name);
  private anthropic: Anthropic | null = null;

  constructor(
    private config: ConfigService,
    private prisma: PrismaService,
    @Inject(forwardRef(() => DripService))
    private dripService: DripService,
    @Inject(forwardRef(() => CampaignEnrollmentService))
    private campaignEnrollmentService: CampaignEnrollmentService,
  ) {
    const apiKey = this.config.get<string>('ANTHROPIC_API_KEY');
    if (apiKey) {
      this.anthropic = new Anthropic({ apiKey });
    }
  }

  /** Active pipeline stages shown on the Kanban board */
  private readonly ACTIVE_STAGES = [
    'NEW',
    'ATTEMPTING_CONTACT',
    'QUALIFYING',
    'QUALIFIED',
    'OFFER_SENT',
    'NEGOTIATING',
    'UNDER_CONTRACT',
    'CLOSING',
    'ACQUIRED',
    'SOLD',
    'NURTURE',
  ];

  async getLeadsByStage() {
    const leads = await this.prisma.lead.findMany({
      where: {
        status: { in: this.ACTIVE_STAGES },
      },
      orderBy: [{ totalScore: 'desc' }, { lastTouchedAt: 'desc' }],
      select: {
        id: true,
        propertyAddress: true,
        propertyCity: true,
        propertyState: true,
        propertyZip: true,
        sellerFirstName: true,
        sellerLastName: true,
        sellerPhone: true,
        sellerEmail: true,
        status: true,
        totalScore: true,
        scoreBand: true,
        tier: true,
        arv: true,
        askingPrice: true,
        primaryPhoto: true,
        lastTouchedAt: true,
        touchCount: true,
        daysInStage: true,
        stageChangedAt: true,
        aiRecommendation: true,
        assignedToUserId: true,
        assignedTo: { select: { id: true, firstName: true, lastName: true } },
        assignedStage: true,
        createdAt: true,
        dripSequence: {
          select: {
            id: true,
            status: true,
            currentStep: true,
            lastMessageAt: true,
          },
        },
        campaignEnrollments: {
          where: { status: 'ACTIVE' },
          select: {
            id: true,
            campaignId: true,
            currentStepOrder: true,
            nextSendAt: true,
            campaign: {
              select: { id: true, name: true },
            },
          },
        },
        activities: {
          where: { type: 'STATUS_CHANGED' },
          take: 1,
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            metadata: true,
            createdAt: true,
            userId: true,
            user: { select: { firstName: true, lastName: true } },
          },
        },
      },
    });

    // Group by status
    const grouped: Record<string, any[]> = {};
    for (const stage of this.ACTIVE_STAGES) {
      grouped[stage] = [];
    }
    for (const lead of leads) {
      if (grouped[lead.status]) {
        grouped[lead.status].push(lead);
      }
    }

    return grouped;
  }

  async updateLeadStage(
    leadId: string,
    newStage: string,
    opts?: { reason?: string; userId?: string },
  ) {
    const lead = await this.prisma.lead.findUnique({
      where: { id: leadId },
    });

    if (!lead) {
      throw new Error('Lead not found');
    }

    const reason = opts?.reason ?? 'manual';

    await this.prisma.lead.update({
      where: { id: leadId },
      data: {
        status: newStage,
        stageChangedAt: new Date(),
        daysInStage: 0,
      },
    });

    await this.prisma.activity.create({
      data: {
        leadId,
        userId: opts?.userId ?? null,
        type: 'STATUS_CHANGED',
        description: `Pipeline stage changed from ${this.formatStageName(lead.status)} to ${this.formatStageName(newStage)}`,
        metadata: {
          oldStatus: lead.status,
          newStatus: newStage,
          reason,
        },
      },
    });

    if (lead.status !== newStage) {
      await this.cancelOutreachIfTerminal(leadId, newStage);
    }

    // Generate AI recommendation in background (don't block response)
    this.generateLeadRecommendation(leadId).catch((err) =>
      console.error(`AI recommendation failed for ${leadId}:`, err.message),
    );

    return { success: true };
  }

  private async cancelOutreachIfTerminal(leadId: string, newStatus: string) {
    if (!TERMINAL_STATUSES_FOR_REMOVAL.includes(newStatus)) return;
    try {
      await this.campaignEnrollmentService.removeAllActive(leadId);
    } catch (err: any) {
      this.logger.error(`Failed to remove campaign enrollments for lead ${leadId}: ${err.message}`);
    }
    try {
      await this.dripService.cancelByLeadId(leadId, `Lead status changed to ${newStatus}`);
    } catch {
      // Drip may not exist — that's fine
    }
  }

  async bulkUpdateStage(
    ids: string[],
    newStage: string,
    opts?: { reason?: string; userId?: string },
  ) {
    if (!ids.length) return { success: true, updated: 0 };
    const TERMINAL = ['DEAD', 'SOLD_LOSS', 'HELD_LONG_TERM', 'CANCELLED', 'CLOSED_LOST'];
    if (!this.ACTIVE_STAGES.includes(newStage) && !TERMINAL.includes(newStage)) {
      throw new Error(`Invalid stage: ${newStage}`);
    }
    const reason = opts?.reason ?? 'manual';

    const existing = await this.prisma.lead.findMany({
      where: { id: { in: ids } },
      select: { id: true, status: true },
    });
    const byId = new Map(existing.map((l) => [l.id, l.status]));

    const now = new Date();
    await this.prisma.$transaction([
      this.prisma.lead.updateMany({
        where: { id: { in: ids } },
        data: {
          status: newStage,
          stageChangedAt: now,
          daysInStage: 0,
        },
      }),
      this.prisma.activity.createMany({
        data: existing.map((l) => ({
          leadId: l.id,
          userId: opts?.userId ?? null,
          type: 'STATUS_CHANGED',
          description: `Pipeline stage changed from ${this.formatStageName(l.status)} to ${this.formatStageName(newStage)}`,
          metadata: {
            oldStatus: l.status,
            newStatus: newStage,
            reason,
            bulk: true,
          },
        })),
      }),
    ]);

    // Cancel campaigns + drip for any lead that actually transitioned into a terminal stage
    if (TERMINAL_STATUSES_FOR_REMOVAL.includes(newStage)) {
      for (const l of existing) {
        if (l.status !== newStage) {
          await this.cancelOutreachIfTerminal(l.id, newStage);
        }
      }
    }

    // Fire background AI recommendations (best-effort)
    for (const id of ids) {
      this.generateLeadRecommendation(id).catch(() => {});
    }

    return { success: true, updated: existing.length };
  }

  async generateAiInsights(leadsByStage: Record<string, any[]>) {
    if (!this.anthropic) {
      console.log('⚠️ Anthropic API key not configured, using fallback insights');
      return this.getFallbackInsights(leadsByStage);
    }

    try {
      console.log('🤖 Generating AI pipeline insights with Claude...');

      const allLeads = Object.values(leadsByStage).flat();
      const totalLeads = allLeads.length;

      const stageStats = Object.entries(leadsByStage).map(
        ([stage, leads]) => ({
          stage: this.formatStageName(stage),
          count: leads.length,
          avgScore: this.getAvgScore(leads),
        }),
      );

      const hotLeads = allLeads.filter((l) => l.totalScore >= 7);

      const needsFollowUp = allLeads.filter((l) => {
        const hoursSinceTouch =
          (Date.now() - new Date(l.lastTouchedAt).getTime()) /
          (1000 * 60 * 60);
        return hoursSinceTouch > 48;
      });

      const prompt = `You are an AI assistant for a real estate wholesaling CRM. Analyze this pipeline and provide actionable insights.

Pipeline Overview:
- Total active leads: ${totalLeads}
- Hot leads (score 7+): ${hotLeads.length}
- Needs follow-up (>48hrs): ${needsFollowUp.length}

Stage Breakdown:
${stageStats.map((s) => `- ${s.stage}: ${s.count} leads (avg score: ${s.avgScore})`).join('\n')}

Top 3 Hot Leads:
${hotLeads
  .slice(0, 3)
  .map(
    (l) =>
      `- ${l.propertyAddress} (Score: ${l.totalScore}, ARV: ${l.arv ? '$' + l.arv.toLocaleString() : 'Unknown'})`,
  )
  .join('\n')}

Provide:
1. A 2-3 sentence summary of pipeline health
2. One specific, actionable recommendation for what to prioritize today
3. Estimated close rate percentage based on lead quality

Respond ONLY with valid JSON (no markdown):
{
  "summary": "...",
  "recommendation": "...",
  "hotLeadsCount": ${hotLeads.length},
  "needsFollowUpCount": ${needsFollowUp.length},
  "estimatedCloseRate": <number between 0-100>
}`;

      const message = await this.anthropic.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1000,
        messages: [{ role: 'user', content: prompt }],
      });

      const responseText =
        message.content[0].type === 'text' ? message.content[0].text : '';
      const insights = JSON.parse(responseText);

      // Strip dashes / smart Unicode from any operator-facing strings.
      // Hard rule: no AI text in Dealcore uses em or en dashes.
      if (typeof insights.summary === 'string') {
        insights.summary = sanitizeOutboundSmsBody(insights.summary);
      }
      if (typeof insights.recommendation === 'string') {
        insights.recommendation = sanitizeOutboundSmsBody(insights.recommendation);
      }

      console.log('✅ AI insights generated successfully');
      return insights;
    } catch (error) {
      console.error('❌ AI insights failed:', error.message);
      return this.getFallbackInsights(leadsByStage);
    }
  }

  async generateLeadRecommendation(leadId: string) {
    if (!this.anthropic) return;

    try {
      const lead = await this.prisma.lead.findUnique({
        where: { id: leadId },
        include: {
          activities: {
            take: 5,
            orderBy: { createdAt: 'desc' },
          },
        },
      });

      if (!lead) return;

      const hoursSinceTouch =
        (Date.now() - new Date(lead.lastTouchedAt).getTime()) /
        (1000 * 60 * 60);

      const prompt = `You are an AI assistant for a real estate wholesaler. Analyze this lead and provide ONE specific action to take next.

Lead Details:
- Property: ${lead.propertyAddress}, ${lead.propertyCity}, ${lead.propertyState}
- Current Stage: ${this.formatStageName(lead.status)}
- Lead Score: ${lead.totalScore}/12 (${lead.scoreBand})
- ARV: ${lead.arv ? '$' + lead.arv.toLocaleString() : 'Not calculated'}
- Days in current stage: ${lead.daysInStage}
- Hours since last touch: ${Math.round(hoursSinceTouch)}
- Total touches: ${lead.touchCount}

Recent Activity:
${lead.activities.slice(0, 3).map((a) => `- ${a.description}`).join('\n') || 'No recent activity'}

What is the ONE most important action to take with this lead right now? Be specific and actionable.
Respond with ONE sentence only, no preamble.`;

      const message = await this.anthropic.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 150,
        messages: [{ role: 'user', content: prompt }],
      });

      const recommendationRaw =
        message.content[0].type === 'text' ? message.content[0].text : '';
      // Strip dashes / smart Unicode (hard rule).
      const recommendation = sanitizeOutboundSmsBody(recommendationRaw.trim());

      await this.prisma.lead.update({
        where: { id: leadId },
        data: {
          aiRecommendation: recommendation,
        },
      });

      console.log(`✅ AI recommendation generated for lead ${leadId}`);
    } catch (error) {
      console.error(
        `❌ AI recommendation failed for lead ${leadId}:`,
        error.message,
      );
    }
  }


  private getFallbackInsights(leadsByStage: Record<string, any[]>) {
    const allLeads = Object.values(leadsByStage).flat();
    const totalLeads = allLeads.length;
    const hotLeads = allLeads.filter((l) => l.totalScore >= 7).length;
    const needsFollowUp = allLeads.filter(
      (l) =>
        (Date.now() - new Date(l.lastTouchedAt).getTime()) /
          (1000 * 60 * 60) >
        48,
    ).length;

    return {
      summary: `You have ${totalLeads} active leads in your pipeline. ${hotLeads} are hot prospects (score 7+). Focus on moving qualified leads toward offers.`,
      recommendation: `Prioritize follow-up with ${needsFollowUp} leads that haven't been touched in 48+ hours, starting with the highest scores.`,
      hotLeadsCount: hotLeads,
      needsFollowUpCount: needsFollowUp,
      estimatedCloseRate:
        totalLeads > 0 ? Math.round((hotLeads / totalLeads) * 25) : 0,
    };
  }

  private getAvgScore(leads: any[]) {
    if (leads.length === 0) return 0;
    const sum = leads.reduce((acc, l) => acc + (l.totalScore || 0), 0);
    return Math.round(sum / leads.length);
  }

  private formatStageName(stage: string): string {
    return stage
      .split('_')
      .map((word) => word.charAt(0) + word.slice(1).toLowerCase())
      .join(' ');
  }
}

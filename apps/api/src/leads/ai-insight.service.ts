import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Anthropic from '@anthropic-ai/sdk';
import { createHash } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AiInsightService {
  private readonly logger = new Logger(AiInsightService.name);
  private anthropic: Anthropic | null = null;

  constructor(
    private config: ConfigService,
    private prisma: PrismaService,
  ) {
    const apiKey = this.config.get<string>('ANTHROPIC_API_KEY');
    if (apiKey) {
      this.anthropic = new Anthropic({ apiKey });
    }
  }

  /**
   * Fingerprint inputs that should invalidate the cached insight.
   * Changes to stage, tier, last message, offer count, or CAMP completeness → regenerate.
   */
  private computeFingerprint(lead: any, lastMessageId: string | null, offerCount: number): string {
    const parts = [
      lead.status ?? '',
      lead.tier ?? '',
      lastMessageId ?? '',
      offerCount,
      lead.campPriorityComplete ? 'P' : '',
      lead.campMoneyComplete ? 'M' : '',
      lead.campChallengeComplete ? 'C' : '',
      lead.campAuthorityComplete ? 'A' : '',
      lead.arv ?? '',
      lead.askingPrice ?? '',
    ].join('|');
    return createHash('sha1').update(parts).digest('hex').slice(0, 16);
  }

  async getInsight(leadId: string, regenerate = false): Promise<{ insight: string | null; cached: boolean; generatedAt: Date | null }> {
    const lead = await this.prisma.lead.findUnique({
      where: { id: leadId },
      include: {
        messages: { orderBy: { createdAt: 'desc' }, take: 1, select: { id: true } },
        offers: { select: { id: true } },
      },
    });
    if (!lead) {
      return { insight: null, cached: false, generatedAt: null };
    }

    const lastMessageId = lead.messages[0]?.id ?? null;
    const offerCount = lead.offers.length;
    const fingerprint = this.computeFingerprint(lead, lastMessageId, offerCount);

    if (!regenerate && lead.aiInsight && lead.aiInsightState === fingerprint) {
      return {
        insight: lead.aiInsight,
        cached: true,
        generatedAt: lead.aiInsightGeneratedAt,
      };
    }

    const insight = await this.generateInsight(lead, offerCount);
    if (!insight) {
      return { insight: lead.aiInsight ?? null, cached: true, generatedAt: lead.aiInsightGeneratedAt };
    }

    const now = new Date();
    await this.prisma.lead.update({
      where: { id: leadId },
      data: {
        aiInsight: insight,
        aiInsightGeneratedAt: now,
        aiInsightState: fingerprint,
      },
    });

    return { insight, cached: false, generatedAt: now };
  }

  private async generateInsight(lead: any, offerCount: number): Promise<string | null> {
    if (!this.anthropic) return null;

    const stage = lead.status;
    const tierLabel = lead.tier === 1 ? 'T1 (contract now)' : lead.tier === 2 ? 'T2 (keep pursuing)' : lead.tier === 3 ? 'T3 (dead)' : 'untiered';
    const campSummary: string[] = [];
    if (lead.campPriorityComplete) campSummary.push(`timeline ${lead.timeline ?? '?'} days`);
    if (lead.campMoneyComplete && lead.askingPrice) campSummary.push(`asking $${Math.round(lead.askingPrice).toLocaleString()}`);
    if (lead.campChallengeComplete && lead.conditionLevel) campSummary.push(`condition ${lead.conditionLevel}`);
    if (lead.campAuthorityComplete && lead.ownershipStatus) campSummary.push(`ownership ${lead.ownershipStatus}`);

    const arv = lead.arv ? `$${Math.round(lead.arv).toLocaleString()}` : 'unknown';
    const asking = lead.askingPrice ? `$${Math.round(lead.askingPrice).toLocaleString()}` : 'unknown';

    const prompt = `You are summarizing the state of a real estate wholesale lead in ONE sentence to help an agent decide the next move.

Lead context:
- Stage: ${stage}
- Tier: ${tierLabel}
- ARV: ${arv}
- Asking price: ${asking}
- CAMP gathered: ${campSummary.length ? campSummary.join(', ') : 'nothing yet'}
- Offers sent: ${offerCount}
- Touches: ${lead.touchCount ?? 0}
- Auto-respond: ${lead.autoRespond ? 'on' : 'off'}

Write ONE short sentence (max 25 words) that captures the current lead state and the next action the agent should take. No preamble. No bullet points. Example tone: "Hot lead — asking is 55% of ARV, ready for an offer at MAO." or "CAMP incomplete — need seller's timeline before offering."`;

    try {
      const response = await this.anthropic.messages.create({
        model: 'claude-haiku-4-5',
        max_tokens: 120,
        system: 'You are a terse real estate wholesaling assistant. Always reply with a single sentence, no markdown.',
        messages: [{ role: 'user', content: prompt }],
      });
      const text = (response.content[0] as any)?.text?.trim();
      if (!text) return null;
      return text.replace(/^["']|["']$/g, '').trim();
    } catch (error: any) {
      this.logger.error(`Insight generation failed for lead ${lead.id}: ${error.message}`);
      return null;
    }
  }
}

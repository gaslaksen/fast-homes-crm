import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Anthropic from '@anthropic-ai/sdk';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class PipelineService {
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
        status: true,
        totalScore: true,
        scoreBand: true,
        arv: true,
        askingPrice: true,
        primaryPhoto: true,
        lastTouchedAt: true,
        touchCount: true,
        daysInStage: true,
        aiRecommendation: true,
        assignedToUserId: true,
        assignedTo: { select: { id: true, firstName: true, lastName: true } },
        assignedStage: true,
        createdAt: true,
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

  async updateLeadStage(leadId: string, newStage: string) {
    const lead = await this.prisma.lead.findUnique({
      where: { id: leadId },
    });

    if (!lead) {
      throw new Error('Lead not found');
    }

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
        type: 'STATUS_CHANGED',
        description: `Pipeline stage changed from ${this.formatStageName(lead.status)} to ${this.formatStageName(newStage)}`,
        metadata: { oldStatus: lead.status, newStatus: newStage },
      },
    });

    // Generate AI recommendation in background (don't block response)
    this.generateLeadRecommendation(leadId).catch((err) =>
      console.error(`AI recommendation failed for ${leadId}:`, err.message),
    );

    return { success: true };
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

      const recommendation =
        message.content[0].type === 'text' ? message.content[0].text : '';

      await this.prisma.lead.update({
        where: { id: leadId },
        data: {
          aiRecommendation: recommendation.trim(),
          aiLastUpdated: new Date(),
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

  /** Return cached analysis if fresh (<24h) AND key numbers haven't changed, otherwise generate new */
  async getCachedOrGenerateAnalysis(leadId: string) {
    const lead = await this.prisma.lead.findUnique({
      where: { id: leadId },
      select: { aiAnalysis: true, aiLastUpdated: true, arv: true, askingPrice: true },
    });

    if (lead?.aiAnalysis && lead.aiLastUpdated) {
      const hoursSinceUpdate = (Date.now() - new Date(lead.aiLastUpdated).getTime()) / (1000 * 60 * 60);
      if (hoursSinceUpdate < 24) {
        // Validate cached numbers still match current lead data — if ARV or asking price
        // changed since the cache was written, force a refresh so the rating is accurate.
        try {
          const cached = JSON.parse(lead.aiAnalysis);
          const arvMatch     = cached._cacheArv      == null || cached._cacheArv      === lead.arv;
          const askingMatch  = cached._cacheAsking   == null || cached._cacheAsking   === lead.askingPrice;
          if (arvMatch && askingMatch) {
            console.log(`✅ Returning cached AI analysis for lead ${leadId}`);
            return cached;
          }
          console.log(`🔄 Key numbers changed (ARV or asking price) — regenerating analysis for lead ${leadId}`);
        } catch {
          // Cache corrupt — regenerate
        }
      }
    }

    console.log(`🔄 Generating fresh AI analysis for lead ${leadId}`);
    return this.generateLeadAnalysis(leadId);
  }

  async generateLeadAnalysis(leadId: string) {
    const lead = await this.prisma.lead.findUnique({
      where: { id: leadId },
      include: {
        comps: { where: { selected: true }, orderBy: { correlation: 'desc' }, take: 10 },
      },
    });

    if (!lead) {
      throw new Error('Lead not found');
    }

    // Identify missing data
    const missingData: string[] = [];
    if (!lead.timeline) missingData.push('Timeline/urgency');
    if (!lead.askingPrice) missingData.push('Asking price');
    if (!lead.ownershipStatus) missingData.push('Ownership status');
    if (!lead.conditionLevel) missingData.push('Property condition');
    if (!lead.bedrooms || !lead.bathrooms || !lead.sqft)
      missingData.push('Property details (beds/baths/sqft)');
    if (!lead.arv) missingData.push('ARV calculation');
    if (!lead.comps || lead.comps.length === 0)
      missingData.push('Comparable sales data');

    // Calculate estimated profit — use saved deal numbers if available
    let estimatedProfit: number | null = null;
    if (lead.arv && lead.askingPrice) {
      const repairEst = (lead as any).repairCosts ??
        (lead.conditionLevel === 'poor' || lead.conditionLevel === 'distressed'
          ? 50000
          : lead.conditionLevel === 'fair'
            ? 30000
            : 15000);
      const savedMaoFactor = ((lead as any).maoPercent ?? 70) / 100;
      const savedFee = (lead as any).assignmentFee ?? 15000;
      const mao = Math.round(lead.arv * savedMaoFactor - repairEst - savedFee);
      estimatedProfit = mao - lead.askingPrice;
    }

    if (!this.anthropic) {
      const fallback = this.getFallbackLeadAnalysis(lead, missingData, estimatedProfit);
      await this.saveAnalysisToLead(leadId, fallback, missingData.length, estimatedProfit);
      return fallback;
    }

    try {
      console.log(`🤖 Generating AI analysis for lead ${leadId}...`);

      // Deal math — use lead-level overrides if set
      const assignmentFee = (lead as any).assignmentFee ?? 15000;
      const maoFactor = ((lead as any).maoPercent ?? 70) / 100;
      const savedRepairs = (lead as any).repairCosts;
      const maoLight  = lead.arv ? Math.round(lead.arv * maoFactor - 20000 - assignmentFee) : null;
      const maoMod    = lead.arv ? Math.round(lead.arv * maoFactor - 40000 - assignmentFee) : null;
      const maoHeavy  = lead.arv ? Math.round(lead.arv * maoFactor - 60000 - assignmentFee) : null;
      const maoSaved  = lead.arv && savedRepairs != null ? Math.round(lead.arv * maoFactor - savedRepairs - assignmentFee) : null;
      // Primary benchmark: saved MAO (actual repair estimate). Falls back to repair scenarios.
      // The MAO = ARV * factor - repairs - fee. If asking <= MAO, the deal pencils as-is.
      const bestMao = maoSaved ?? maoLight;
      const askingVsMao = (lead.arv && lead.askingPrice)
        ? `Asking $${lead.askingPrice.toLocaleString()} is ${((lead.askingPrice / lead.arv) * 100).toFixed(0)}% of ARV $${lead.arv.toLocaleString()}. ` +
          (maoSaved != null
            ? lead.askingPrice <= maoSaved
              ? `BELOW saved MAO ($${maoSaved.toLocaleString()}) — deal pencils at current numbers.`
              : `Above saved MAO ($${maoSaved.toLocaleString()}) by $${(lead.askingPrice - maoSaved).toLocaleString()} — gap requires negotiation.`
            : lead.askingPrice <= (maoLight ?? Infinity)
              ? `Below light-repair MAO ($${maoLight?.toLocaleString()}) — deal pencils on light rehab.`
              : lead.askingPrice <= (maoMod ?? Infinity)
              ? `Below moderate-repair MAO ($${maoMod?.toLocaleString()}) — pencils on moderate rehab.`
              : `Above all MAO scenarios — needs price reduction or very low repair cost.`)
        : 'Cannot compare — asking price or ARV unknown.';

      const compsStr = lead.comps.length > 0
        ? lead.comps.map((c, i) => {
            const monthsAgo = Math.round((Date.now() - new Date(c.soldDate).getTime()) / (30 * 24 * 60 * 60 * 1000));
            return `${i + 1}. ${c.address}: $${c.soldPrice.toLocaleString()} | ${c.bedrooms || '?'}bd/${c.bathrooms || '?'}ba | ${c.sqft?.toLocaleString() || '?'}sqft | ${c.distance?.toFixed(1) || '?'}mi | ${monthsAgo}mo ago${c.correlation ? ` | ${(c.correlation * 100).toFixed(0)}% match` : ''}`;
          }).join('\n')
        : 'No comps selected yet.';

      const prompt = `You are an expert real estate wholesaling analyst. Analyze this deal based on the property, comps, and deal math. Do NOT factor in CRM activity logs or status changes — those are irrelevant to deal quality.

PROPERTY:
Address: ${lead.propertyAddress}, ${lead.propertyCity}, ${lead.propertyState} ${lead.propertyZip}
Type: ${lead.propertyType || 'Unknown'} | Beds/Baths/SqFt: ${lead.bedrooms || '?'}/${lead.bathrooms || '?'}/${lead.sqft?.toLocaleString() || '?'}
Year Built: ${(lead as any).yearBuilt || 'Unknown'} | Condition: ${lead.conditionLevel || 'Unknown'}
Ownership: ${lead.ownershipStatus || 'Unknown'} | Timeline: ${lead.timeline ? lead.timeline + ' days' : 'Unknown'}

DEAL NUMBERS:
ARV: ${lead.arv ? '$' + lead.arv.toLocaleString() : 'Not calculated'}
Asking Price: ${lead.askingPrice ? '$' + lead.askingPrice.toLocaleString() : 'Unknown'}
MAO (${Math.round(maoFactor * 100)}% rule, $${assignmentFee.toLocaleString()} fee):${maoSaved != null ? ` Saved repairs ($${savedRepairs.toLocaleString()}): $${maoSaved.toLocaleString()} |` : ''} Light (~$20k): ${maoLight ? '$' + maoLight.toLocaleString() : '?'} | Moderate (~$40k): ${maoMod ? '$' + maoMod.toLocaleString() : '?'} | Heavy (~$60k): ${maoHeavy ? '$' + maoHeavy.toLocaleString() : '?'}
Asking vs MAO: ${askingVsMao}
Estimated Assignment Profit: ${estimatedProfit !== null ? '$' + estimatedProfit.toLocaleString() : 'Cannot calculate'}

COMPARABLE SALES (selected):
${compsStr}

MISSING DATA:
${missingData.length > 0 ? missingData.map((d) => '- ' + d).join('\n') : 'All key data collected'}

Analyze this as a wholesaler deciding whether to pursue and at what price. Respond ONLY with valid JSON (no markdown):
{
  "dataGaps": ["top 3 missing data points that would change the analysis"],
  "dealRating": <1-10 based on profit potential, comp strength, seller motivation, asking vs MAO>,
  "dealRatingExplanation": "2-3 sentences on why this rating — reference specific numbers",
  "nextActions": ["3 specific actions to advance or kill this deal"],
  "redFlags": ["property/deal red flags only — no CRM or activity flags"],
  "dealWorthiness": "YES" or "NO" or "NEED_MORE_DATA",
  "worthinessReason": "1-2 sentences referencing ARV, MAO, and asking price",
  "estimatedProfitPotential": "HIGH" or "MEDIUM" or "LOW" or "UNKNOWN",
  "confidenceLevel": <0-100 based on comp quality and data completeness>
}`;

      const message = await this.anthropic.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 2000,
        messages: [{ role: 'user', content: prompt }],
      });

      const responseText =
        message.content[0].type === 'text' ? message.content[0].text : '';
      const cleaned = responseText
        .replace(/```json\n?/g, '')
        .replace(/```\n?/g, '')
        .trim();
      const analysis = JSON.parse(cleaned);

      // Create brief summary for overview tab
      const summaryIcon = analysis.dealWorthiness === 'YES' ? '✅' : analysis.dealWorthiness === 'NO' ? '❌' : '⚠️';
      const summary = `${summaryIcon} ${analysis.worthinessReason}`;

      // Save structured fields to database
      await this.prisma.lead.update({
        where: { id: leadId },
        data: {
          aiAnalysis: JSON.stringify({ ...analysis, missingDataCount: missingData.length, estimatedProfit, _cacheArv: lead.arv, _cacheAsking: lead.askingPrice }),
          aiDealRating: analysis.dealRating,
          aiDealWorthiness: analysis.dealWorthiness,
          aiProfitPotential: analysis.estimatedProfitPotential,
          aiConfidence: analysis.confidenceLevel,
          aiLastUpdated: new Date(),
          aiSummary: summary,
        },
      });

      console.log(`✅ AI analysis saved to database for lead ${leadId}`);
      return { ...analysis, missingDataCount: missingData.length, estimatedProfit };
    } catch (error) {
      console.error(`❌ AI analysis failed for lead ${leadId}:`, error.message);
      const fallback = this.getFallbackLeadAnalysis(lead, missingData, estimatedProfit);
      await this.saveAnalysisToLead(leadId, fallback, missingData.length, estimatedProfit).catch(() => {});
      return fallback;
    }
  }

  /** Save analysis results to lead record */
  private async saveAnalysisToLead(
    leadId: string,
    analysis: any,
    missingDataCount: number,
    estimatedProfit: number | null,
  ) {
    const summaryIcon = analysis.dealWorthiness === 'YES' ? '✅' : analysis.dealWorthiness === 'NO' ? '❌' : '⚠️';
    const summary = `${summaryIcon} ${analysis.worthinessReason}`;

    await this.prisma.lead.update({
      where: { id: leadId },
      data: {
        aiAnalysis: JSON.stringify({ ...analysis, missingDataCount, estimatedProfit }),
        aiDealRating: analysis.dealRating,
        aiDealWorthiness: analysis.dealWorthiness,
        aiProfitPotential: analysis.estimatedProfitPotential,
        aiConfidence: analysis.confidenceLevel,
        aiLastUpdated: new Date(),
        aiSummary: summary,
      },
    });
  }

  private getFallbackLeadAnalysis(
    lead: any,
    missingData: string[],
    estimatedProfit: number | null,
  ) {
    return {
      dataGaps: missingData.slice(0, 3),
      dealRating: Math.min(10, Math.round((lead.totalScore / 12) * 10)),
      dealRatingExplanation: `Based on current lead score of ${lead.totalScore}/12`,
      nextActions: [
        'Gather missing property details',
        'Calculate ARV if not done',
        'Contact seller to understand motivation',
      ],
      redFlags: [] as string[],
      dealWorthiness:
        lead.totalScore >= 7
          ? 'YES'
          : lead.totalScore >= 4
            ? 'NEED_MORE_DATA'
            : 'NO',
      worthinessReason: `Based on lead score of ${lead.totalScore}/12`,
      estimatedProfitPotential: 'UNKNOWN',
      confidenceLevel: 30,
      missingDataCount: missingData.length,
      estimatedProfit,
    };
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

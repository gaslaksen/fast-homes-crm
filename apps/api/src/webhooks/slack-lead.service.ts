import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RentCastService } from '../comps/rentcast.service';
import Anthropic from '@anthropic-ai/sdk';
import axios from 'axios';

@Injectable()
export class SlackLeadService {
  private readonly logger = new Logger(SlackLeadService.name);
  private anthropic: Anthropic | null = null;

  constructor(
    private rentcast: RentCastService,
    private config: ConfigService,
  ) {
    const apiKey = this.config.get<string>('ANTHROPIC_API_KEY');
    if (apiKey) {
      this.anthropic = new Anthropic({ apiKey });
    }
  }

  // ─── Parse lead notification message ──────────────────────────────────────

  parseLeadNotification(text: string): {
    name?: string;
    phone?: string;
    email?: string;
    address?: string;
    city?: string;
    state?: string;
    zip?: string;
    fullAddress?: string;
  } | null {
    // Expected format:
    // :boltdeals: New Lead in the CRM:
    // Name: Kelly Hensley
    // Phone: +19407334533
    // Email: koltonhensley@outlook.com
    // Address: 1225 W. Belknap St. 76458

    if (!text.includes('New Lead in the CRM')) return null;

    const name = text.match(/Name:\s*(.+)/i)?.[1]?.trim();
    const phone = text.match(/Phone:\s*(.+)/i)?.[1]?.trim();
    const email = text.match(/Email:\s*(.+)/i)?.[1]?.trim();
    const addressLine = text.match(/Address:\s*(.+)/i)?.[1]?.trim();

    if (!addressLine) return null;

    // Try to extract zip from address line (5-digit number at end)
    const zipMatch = addressLine.match(/(\d{5})(?:-\d{4})?$/);
    const zip = zipMatch?.[1];

    // Remove zip from address for RentCast lookup
    const addressWithoutZip = addressLine.replace(/\s*\d{5}(?:-\d{4})?$/, '').trim();

    // Build full address for RentCast — append TX if zip is known Texas zip
    // We'll let RentCast figure out city/state from the address+zip combo
    const fullAddress = zip
      ? `${addressWithoutZip}, ${zip}`
      : addressWithoutZip;

    return { name, phone, email, address: addressWithoutZip, zip, fullAddress };
  }

  // ─── Run full analysis pipeline ───────────────────────────────────────────

  async analyzeAndPost(params: {
    text: string;
    responseUrl: string; // Slack channel webhook URL to post back to
    channelId?: string;
  }): Promise<void> {
    const lead = this.parseLeadNotification(params.text);

    if (!lead?.fullAddress) {
      this.logger.warn('Could not parse address from Slack notification');
      await this.postToSlack(params.responseUrl, {
        text: '⚠️ TRON: Could not parse address from lead notification.',
      });
      return;
    }

    this.logger.log(`Analyzing lead: ${lead.fullAddress}`);

    // Post "working on it" message immediately
    await this.postToSlack(params.responseUrl, {
      text: `🔍 *TRON analyzing:* ${lead.address}${lead.zip ? ' ' + lead.zip : ''} — fetching comps now...`,
    });

    try {
      // Fetch RentCast AVM + comps
      const avm = await this.rentcast.getValueWithComps(lead.fullAddress, {
        compCount: 15,
      });

      if (!avm || !avm.price) {
        await this.postToSlack(params.responseUrl, {
          text: `⚠️ *TRON:* RentCast returned no data for \`${lead.fullAddress}\`. Address may need city/state — please verify and run manually.`,
        });
        return;
      }

      // Also fetch property details for beds/baths
      const details = await this.rentcast.getPropertyDetails(lead.fullAddress);

      const sp = avm.subjectProperty || {};
      const comps = avm.comparables || [];

      // Filter outliers (> 50% below median — likely distressed sales)
      const prices = comps.map(c => c.price || c.lastSalePrice || 0).filter(p => p > 0).sort((a, b) => a - b);
      const median = prices[Math.floor(prices.length / 2)] || avm.price;
      const validComps = comps.filter(c => {
        const price = c.price || c.lastSalePrice || 0;
        return price > 0 && price >= median * 0.5;
      });

      const outlierCount = comps.length - validComps.length;

      // Build top comps summary
      const topComps = validComps.slice(0, 8);
      const avgPrice = topComps.length > 0
        ? Math.round(topComps.reduce((s, c) => s + (c.price || c.lastSalePrice || 0), 0) / topComps.length)
        : avm.price;

      // Calculate MAO scenarios
      const arv = avm.price;
      const arvLow = avm.priceRangeLow || arv * 0.9;
      const arvHigh = avm.priceRangeHigh || arv * 1.1;
      const assignmentFee = 15000;
      const maoLight  = Math.round((arv * 0.70) - 20000 - assignmentFee);
      const maoMod    = Math.round((arv * 0.70) - 40000 - assignmentFee);
      const maoHeavy  = Math.round((arv * 0.70) - 60000 - assignmentFee);

      // Generate AI analysis
      const aiSummary = await this.generateAnalysis({
        address: lead.fullAddress,
        sellerName: lead.name,
        sqft: sp.squareFootage || details?.squareFootage,
        yearBuilt: sp.yearBuilt || details?.yearBuilt,
        arv,
        arvLow,
        arvHigh,
        comps: topComps,
        outlierCount,
      });

      // Build Slack message
      const sqft = sp.squareFootage || details?.squareFootage;
      const yearBuilt = sp.yearBuilt || details?.yearBuilt;
      const pricePerSqft = sqft ? Math.round(arv / sqft) : null;

      const compLines = topComps.slice(0, 6).map((c, i) => {
        const price = c.price || c.lastSalePrice || 0;
        const corr = c.correlation ? `${(c.correlation * 100).toFixed(0)}%` : '?';
        const dist = c.distance ? `${c.distance.toFixed(1)}mi` : '?';
        const daysAgo = c.daysOld ? `${c.daysOld}d ago` : '?';
        const sqftComp = c.squareFootage ? `${c.squareFootage.toLocaleString()}sf` : '';
        const beds = c.bedrooms ? `${c.bedrooms}bd/${c.bathrooms}ba` : '';
        return `>${i + 1}. \`$${price.toLocaleString()}\` · ${beds} ${sqftComp} · ${dist} · ${daysAgo} · ${corr} match`;
      }).join('\n');

      const blocks = [
        {
          type: 'header',
          text: { type: 'plain_text', text: `🏠 Lead Analysis: ${lead.address}` },
        },
        {
          type: 'section',
          fields: [
            { type: 'mrkdwn', text: `*Seller:*\n${lead.name || 'Unknown'}` },
            { type: 'mrkdwn', text: `*Phone:*\n${lead.phone || '—'}` },
            { type: 'mrkdwn', text: `*Property:*\n${sqft ? sqft.toLocaleString() + ' sqft' : '?'}, built ${yearBuilt || '?'}` },
            { type: 'mrkdwn', text: `*Comps pulled:*\n${topComps.length}${outlierCount > 0 ? ` (${outlierCount} outlier${outlierCount > 1 ? 's' : ''} excluded)` : ''}` },
          ],
        },
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `*💰 ARV Estimate:* \`$${arv.toLocaleString()}\`  _(range: $${arvLow.toLocaleString()} – $${arvHigh.toLocaleString()})_${pricePerSqft ? `  |  $${pricePerSqft}/sqft` : ''}`,
          },
        },
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `*📊 Top Comps (within 1mi):*\n${compLines}`,
          },
        },
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `*🧮 MAO at 70% Rule* _(+ $15k assignment fee)_\n` +
              `>💚 *Light repairs* (~$20k): \`$${Math.max(maoLight, 0).toLocaleString()}\`\n` +
              `>🟡 *Moderate repairs* (~$40k): \`$${Math.max(maoMod, 0).toLocaleString()}\`\n` +
              `>🔴 *Heavy repairs* (~$60k): \`$${Math.max(maoHeavy, 0).toLocaleString()}\``,
          },
        },
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `*🤖 TRON's Take:*\n${aiSummary}`,
          },
        },
        {
          type: 'context',
          elements: [
            { type: 'mrkdwn', text: `Powered by RentCast + Claude · Data as of today · Always verify comps before contracting` },
          ],
        },
      ];

      await this.postToSlack(params.responseUrl, { blocks });
      this.logger.log(`✅ Slack analysis posted for ${lead.fullAddress}`);

    } catch (error) {
      this.logger.error('Analysis pipeline failed:', error);
      await this.postToSlack(params.responseUrl, {
        text: `❌ TRON hit an error analyzing \`${lead.fullAddress}\`: ${error.message}`,
      });
    }
  }

  // ─── Claude analysis ──────────────────────────────────────────────────────

  private async generateAnalysis(params: {
    address: string;
    sellerName?: string;
    sqft?: number;
    yearBuilt?: number;
    arv: number;
    arvLow: number;
    arvHigh: number;
    comps: any[];
    outlierCount: number;
  }): Promise<string> {
    if (!this.anthropic) return 'AI analysis unavailable.';

    const { address, arv, arvLow, arvHigh, comps, outlierCount, sqft, yearBuilt } = params;

    const compSummary = comps.slice(0, 6).map((c, i) => {
      const price = c.price || c.lastSalePrice || 0;
      return `${i + 1}. $${price.toLocaleString()} | ${c.bedrooms || '?'}bd/${c.bathrooms || '?'}ba | ${c.squareFootage || '?'}sqft | ${c.distance?.toFixed(1) || '?'}mi away | sold ${c.daysOld || '?'} days ago`;
    }).join('\n');

    const prompt = `You are TRON, a sharp real estate wholesaling analyst. A new lead just came in and you've pulled the comps. Give a 2-3 sentence analyst's take.

Property: ${address}
${sqft ? `Size: ${sqft.toLocaleString()} sqft, built ${yearBuilt || 'unknown'}` : ''}
RentCast ARV: $${arv.toLocaleString()} (range: $${arvLow.toLocaleString()} – $${arvHigh.toLocaleString()})
${outlierCount > 0 ? `Note: ${outlierCount} distressed/outlier sale(s) excluded from analysis.` : ''}

Top comps:
${compSummary}

Cover: (1) how reliable the ARV is given the comp pool, (2) any concerns or green flags, (3) what repair scenario matters most for this deal to pencil. Be direct, specific, no fluff.`;

    try {
      const response = await this.anthropic.messages.create({
        model: 'claude-haiku-4-5',
        max_tokens: 250,
        messages: [{ role: 'user', content: prompt }],
      });
      return (response.content[0] as any)?.text || 'Unable to generate analysis.';
    } catch (err) {
      this.logger.error('Claude analysis failed:', err);
      return 'AI analysis unavailable at this time.';
    }
  }

  // ─── Post to Slack via webhook URL ────────────────────────────────────────

  private async postToSlack(webhookUrl: string, payload: any): Promise<void> {
    try {
      await axios.post(webhookUrl, payload, {
        headers: { 'Content-Type': 'application/json' },
        timeout: 10000,
      });
    } catch (err) {
      this.logger.error('Failed to post to Slack:', err.message);
    }
  }
}

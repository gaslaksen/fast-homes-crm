import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import { ScoringInput, ScoringResult, AIExtractionResult } from '@fast-homes/shared';
import { calculateScoreBand, calculateABCDFit } from '@fast-homes/shared';

@Injectable()
export class ScoringService {
  private openai: OpenAI;

  constructor(private config: ConfigService) {
    const apiKey = this.config.get<string>('OPENAI_API_KEY');
    if (apiKey) {
      this.openai = new OpenAI({ apiKey });
    }
  }

  /**
   * Calculate lead score using Council (CHAMP-like) model
   * Categories: Challenge, Authority, Money, Priority (each 0-3)
   * Total: 0-12
   */
  async scoreLead(input: ScoringInput): Promise<ScoringResult> {
    // Calculate individual category scores
    const priorityScore = this.calculatePriorityScore(input.timeline);
    const authorityScore = this.calculateAuthorityScore(input.ownershipStatus);
    const moneyScore = this.calculateMoneyScore(input.askingPrice, input.arv);
    const challengeScore = this.calculateChallengeScore(
      input.conditionLevel,
      input.distressSignals,
    );

    // Calculate total and band
    const totalScore = priorityScore + authorityScore + moneyScore + challengeScore;
    const scoreBand = calculateScoreBand(totalScore);
    const abcdFit = calculateABCDFit(scoreBand);

    // Generate rationale
    const rationale = this.generateRationale({
      priorityScore,
      authorityScore,
      moneyScore,
      challengeScore,
      input,
    });

    return {
      challengeScore,
      authorityScore,
      moneyScore,
      priorityScore,
      totalScore,
      scoreBand,
      abcdFit,
      rationale,
    };
  }

  /**
   * Priority Score (Timeline urgency): 0-3
   * < 14 days → 3
   * 14–30 days → 2
   * 31–90 days → 1
   * > 90 days / "just curious" → 0
   */
  private calculatePriorityScore(timeline?: number): number {
    if (!timeline) return 0;
    if (timeline < 14) return 3;
    if (timeline <= 30) return 2;
    if (timeline <= 90) return 1;
    return 0;
  }

  /**
   * Authority Score (Decision-making power): 0-3
   * Confirmed sole decision-maker/owner → 3
   * One of multiple owners/heirs → 1–2
   * Not owner / "helping a friend" → 0
   */
  private calculateAuthorityScore(ownershipStatus?: string): number {
    if (!ownershipStatus) return 1; // Default unclear
    
    const status = ownershipStatus.toLowerCase();
    if (status.includes('sole') || status === 'sole_owner') return 3;
    if (status.includes('co_owner') || status.includes('heir')) return 1;
    if (status.includes('not_owner') || status.includes('helping')) return 0;
    
    return 1; // Default for unclear
  }

  /**
   * Money Score (Price/equity position): 0-3
   * Asking <= 70% of ARV → 3
   * Asking 70–80% of ARV → 2
   * Asking 80–90% of ARV → 1
   * Asking > 90% of ARV or refuses → 0
   */
  private calculateMoneyScore(askingPrice?: number, arv?: number): number {
    if (!askingPrice || !arv) return 1; // Default unknown
    
    const ratio = askingPrice / arv;
    if (ratio <= 0.70) return 3;
    if (ratio <= 0.80) return 2;
    if (ratio <= 0.90) return 1;
    return 0;
  }

  /**
   * Challenge Score (Distress/motivation): 0-3
   * Major distress signals → 2–3
   * Moderate repairs/cosmetic but motivated → 1–2
   * Retail ready / no distress → 0–1
   */
  private calculateChallengeScore(
    conditionLevel?: string,
    distressSignals?: string[],
  ): number {
    let score = 0;

    // Evaluate condition
    if (conditionLevel) {
      const condition = conditionLevel.toLowerCase();
      if (condition === 'distressed' || condition === 'poor') {
        score += 2;
      } else if (condition === 'fair') {
        score += 1;
      }
    }

    // Evaluate distress signals
    if (distressSignals && distressSignals.length > 0) {
      const majorSignals = ['vacant', 'foreclosure', 'code_violations', 'major_repairs'];
      const hasMajorDistress = distressSignals.some(signal =>
        majorSignals.includes(signal.toLowerCase()),
      );
      
      if (hasMajorDistress) {
        score = Math.max(score, 2); // At least 2 for major distress
        if (distressSignals.length >= 3) {
          score = 3; // Multiple major issues
        }
      } else {
        score = Math.max(score, 1); // Some motivation present
      }
    }

    return Math.min(score, 3); // Cap at 3
  }

  /**
   * Generate human-readable scoring rationale
   */
  private generateRationale(data: {
    priorityScore: number;
    authorityScore: number;
    moneyScore: number;
    challengeScore: number;
    input: ScoringInput;
  }): string {
    const parts: string[] = [];

    // Priority
    if (data.input.timeline) {
      if (data.priorityScore === 3) {
        parts.push(`Urgent timeline (<14 days: ${data.input.timeline} days)`);
      } else if (data.priorityScore === 2) {
        parts.push(`Near-term timeline (${data.input.timeline} days)`);
      } else if (data.priorityScore === 1) {
        parts.push(`Moderate timeline (${data.input.timeline} days)`);
      } else {
        parts.push(`Long timeline (${data.input.timeline} days)`);
      }
    }

    // Authority
    if (data.input.ownershipStatus) {
      if (data.authorityScore === 3) {
        parts.push('sole owner with full decision authority');
      } else if (data.authorityScore >= 1) {
        parts.push('shared ownership (may need multiple approvals)');
      } else {
        parts.push('limited decision authority');
      }
    }

    // Money
    if (data.input.askingPrice && data.input.arv) {
      const ratio = (data.input.askingPrice / data.input.arv) * 100;
      parts.push(`asking price at ${ratio.toFixed(0)}% ARV`);
      if (data.moneyScore >= 2) {
        parts.push('strong equity position');
      }
    }

    // Challenge
    if (data.input.distressSignals && data.input.distressSignals.length > 0) {
      const signals = data.input.distressSignals.join(', ');
      parts.push(`distress signals: ${signals}`);
    }
    if (data.input.conditionLevel) {
      parts.push(`property condition: ${data.input.conditionLevel}`);
    }

    return parts.length > 0 ? parts.join(', ') : 'Limited information available';
  }

  /**
   * Extract structured data from message text using AI
   */
  async extractFromMessages(messages: string[]): Promise<AIExtractionResult> {
    if (!this.openai || messages.length === 0) {
      return {};
    }

    const conversationText = messages.join('\n\n');

    const prompt = `You are analyzing text messages from a seller about their property. Extract key information:

Conversation:
${conversationText}

Extract and return ONLY a JSON object with these fields (use null if not found):
{
  "timeline_days": <number or null> (how soon they want to sell, in days),
  "asking_price": <number or null> (their asking/target price),
  "condition_level": <"excellent"|"good"|"fair"|"poor"|"distressed" or null>,
  "distress_signals": <array of strings or []> (e.g., ["vacant", "foreclosure", "code_violations", "major_repairs"]),
  "ownership_status": <"sole_owner"|"co_owner"|"heir"|"not_owner" or null>,
  "confidence": <number 0-100> (your confidence in these extractions)
}

Return ONLY valid JSON, no other text.`;

    try {
      const response = await this.openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: 'You extract structured data from conversations. Always respond with valid JSON only.',
          },
          {
            role: 'user',
            content: prompt,
          },
        ],
        temperature: 0.1,
        max_tokens: 500,
      });

      const content = response.choices[0]?.message?.content?.trim();
      if (!content) return {};

      // Parse JSON response
      const extracted = JSON.parse(content);
      return extracted;
    } catch (error) {
      console.error('AI extraction failed:', error);
      return {};
    }
  }

  /**
   * Generate message drafts using AI
   */
  async generateMessageDrafts(context: {
    sellerName: string;
    propertyAddress: string;
    conversationHistory?: string[];
    purpose?: string;
  }): Promise<{ direct: string; friendly: string; professional: string }> {
    if (!this.openai) {
      // Fallback templates if no AI
      return this.getDefaultMessageDrafts(context);
    }

    const history = context.conversationHistory?.join('\n') || 'No previous messages';
    const purpose = context.purpose || 'follow up and move the conversation forward';

    const prompt = `You are texting a property seller on behalf of "Fast Homes for Cash", a house buying company.

Seller: ${context.sellerName}
Property: ${context.propertyAddress}
Conversation so far:
${history}

Goal: ${purpose}

Generate 3 different message drafts:
1. "Direct" - straight to the point, businesslike
2. "Friendly" - warm and conversational
3. "Professional" - polite and formal

Rules:
- Keep each under 160 characters
- Ask only 1 question per message
- Be respectful and compliant
- Include opt-out info only if it's the first message
- Sound human, not spammy

Return ONLY a JSON object:
{
  "direct": "message text",
  "friendly": "message text",
  "professional": "message text"
}`;

    try {
      const response = await this.openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: 'You write compliant, human-sounding text messages for real estate. Always respond with valid JSON only.',
          },
          {
            role: 'user',
            content: prompt,
          },
        ],
        temperature: 0.7,
        max_tokens: 400,
      });

      const content = response.choices[0]?.message?.content?.trim();
      if (!content) return this.getDefaultMessageDrafts(context);

      const drafts = JSON.parse(content);
      return drafts;
    } catch (error) {
      console.error('AI draft generation failed:', error);
      return this.getDefaultMessageDrafts(context);
    }
  }

  /**
   * Fallback message templates when AI is unavailable
   */
  private getDefaultMessageDrafts(context: {
    sellerName: string;
    propertyAddress: string;
  }): { direct: string; friendly: string; professional: string } {
    return {
      direct: `Hi ${context.sellerName}, following up on ${context.propertyAddress}. Can we schedule a quick call?`,
      friendly: `Hey ${context.sellerName}! Hope you're doing well. I'd love to chat about ${context.propertyAddress} when you have a moment. What works for you?`,
      professional: `Hello ${context.sellerName}, this is Fast Homes for Cash regarding ${context.propertyAddress}. Would you be available for a brief discussion at your convenience?`,
    };
  }
}

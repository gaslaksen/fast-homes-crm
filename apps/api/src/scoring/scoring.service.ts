import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Anthropic from '@anthropic-ai/sdk';
import { ScoringInput, ScoringResult, AIExtractionResult } from '@fast-homes/shared';
import { calculateScoreBand, calculateABCDFit } from '@fast-homes/shared';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ScoringService {
  private readonly logger = new Logger(ScoringService.name);
  private anthropic: Anthropic;

  constructor(
    private config: ConfigService,
    private prisma: PrismaService,
  ) {
    const apiKey = this.config.get<string>('ANTHROPIC_API_KEY');
    if (apiKey) {
      this.anthropic = new Anthropic({ apiKey });
      this.logger.log('🤖 ScoringService using Anthropic Claude');
    } else {
      this.logger.warn('⚠️  ANTHROPIC_API_KEY not set — AI features disabled, using fallback templates');
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

    // Motivation
    if ((data.input as any).sellerMotivation) {
      parts.push(`seller motivation: ${(data.input as any).sellerMotivation}`);
    }

    return parts.length > 0 ? parts.join(', ') : 'Limited information available';
  }

  /**
   * Extract structured data from message text using AI.
   * Only uses the last 10 messages to keep context focused and costs low.
   */
  async extractFromMessages(messages: string[]): Promise<AIExtractionResult> {
    if (!this.anthropic || messages.length === 0) {
      return {};
    }

    // Cap to last 10 messages
    const recentMessages = messages.slice(-10);
    const conversationText = recentMessages.join('\n\n');

    const prompt = `You are analyzing SMS text messages from a property seller in a real estate context. Extract key information, being smart about informal language.

Conversation:
${conversationText}

IMPORTANT RULES FOR EXTRACTION:

**Asking Price** — sellers text casually. Apply these rules in order:
1. Explicit full number: "$75,000" → 75000. "$1.2M" → 1200000.
2. "k" shorthand: "75k", "75K" → 75000. "1.2M" → 1200000.
3. Bare numbers in real estate context: if someone says "70", "80", "150", "250" with no unit,
   assume THOUSANDS for residential property (the context here is always residential real estate).
   So "70" → 70000, "around 80" → 80000.
4. Ranges like "70 to 80", "between 70 and 80", "maybe 70 or 80" → use the MIDPOINT as asking_price
   (e.g. 75000) AND set asking_price_high to the upper bound.
5. "Maybe 70" / "around 70" / "like 70" — still extract 70000, confidence just lower.
6. Only return null if there is genuinely NO price information at all.

**Timeline** — similarly casual:
- "30 days", "a month" → 30
- "couple months" → 60
- "ASAP", "right away", "yesterday" → 7
- "few weeks" → 21
- "6 months" → 180
- "not in a rush", "whenever" → 365
- IMPORTANT: "no timeline", "no timeline yet", "not sure", "haven't decided", "no specific timeline",
  "flexible", "don't know yet" → use 365 (treat as "whenever"). Do NOT leave null just because
  they don't have a specific date — they still answered the question.

**Condition** — read between the lines. Be aggressive about inferring condition:
- "needs work", "fixer", "rough shape", "some issues" → "poor"
- "needs a new roof", "roof needs work", "needs roof" → "poor" (major structural)
- "needs some repairs", "few things to fix" → "fair"
- "it's ok", "okay", "decent", "average" → "fair"
- "pretty good", "mostly updated", "good shape" → "good"
- "move-in ready", "renovated", "updated", "great condition" → "excellent"
- If they mention ANY major repair (roof, foundation, HVAC, plumbing) → at most "fair", usually "poor"
- IMPORTANT: If they say BOTH something okay AND a major repair (e.g. "it's ok, needs a new roof"),
  the repair wins — use "poor" or "fair", not their overall self-assessment.

**fields_addressed** — list the CAMP topics the seller mentioned in their replies, even if vaguely.
This is separate from extraction — if the seller said ANYTHING about timeline (even "no timeline"),
include "timeline" in this list. If they mentioned condition at all, include "condition". Etc.
Topics: "timeline", "asking_price", "condition", "ownership"

Extract and return ONLY a JSON object:
{
  "timeline_days": <number or null>,
  "asking_price": <number or null> (always in full dollars, e.g. 75000 not 75),
  "asking_price_high": <number or null> (upper end if seller gave a range, else null),
  "asking_price_raw": <string or null> (exactly what seller said, e.g. "70 to 80"),
  "condition_level": <"excellent"|"good"|"fair"|"poor"|"distressed" or null>,
  "distress_signals": <array of strings or []>,
  "ownership_status": <"sole_owner"|"co_owner"|"heir"|"not_owner" or null>,
  "seller_motivation": <string or null>,
  "fields_addressed": <array of strings> (CAMP topics the seller addressed, even vaguely — from: "timeline", "asking_price", "condition", "ownership"),
  "confidence": <number 0-100>
}

Return ONLY valid JSON, no other text.`;

    try {
      const response = await this.anthropic.messages.create({
        model: 'claude-haiku-4-5',
        max_tokens: 600,
        system: 'You extract structured data from real estate seller conversations. Always respond with valid JSON only. No markdown, no explanation — just the JSON object.',
        messages: [{ role: 'user', content: prompt }],
      });

      const content = (response.content[0] as any)?.text?.trim();
      if (!content) return {};

      // Strip markdown code fences if model adds them
      const cleaned = content.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
      const extracted = JSON.parse(cleaned);
      return extracted;
    } catch (error) {
      this.logger.error('AI extraction failed:', error.message);
      return {};
    }
  }

  /**
   * Detect the emotional sentiment of a seller's message.
   * Used to pick the right response tone automatically.
   */
  async detectSentiment(message: string): Promise<'positive' | 'neutral' | 'negative' | 'hesitant'> {
    if (!this.anthropic || !message) return 'neutral';

    try {
      const response = await this.anthropic.messages.create({
        model: 'claude-haiku-4-5',
        max_tokens: 10,
        system: 'Classify the sentiment of this seller text message. Reply with exactly one word: positive, neutral, negative, or hesitant.',
        messages: [{ role: 'user', content: message }],
      });

      const raw = (response.content[0] as any)?.text?.trim().toLowerCase() ?? 'neutral';
      if (['positive', 'neutral', 'negative', 'hesitant'].includes(raw)) {
        return raw as 'positive' | 'neutral' | 'negative' | 'hesitant';
      }
      return 'neutral';
    } catch {
      return 'neutral';
    }
  }

  /**
   * Refresh CAMP completion booleans on the lead based on current field values.
   */
  async refreshCampFlags(leadId: string): Promise<void> {
    const lead = await this.prisma.lead.findUnique({ where: { id: leadId } });
    if (!lead) return;

    await this.prisma.lead.update({
      where: { id: leadId },
      data: {
        campPriorityComplete: lead.timeline != null,
        campMoneyComplete: lead.askingPrice != null,
        campChallengeComplete: lead.conditionLevel != null,
        campAuthorityComplete: lead.ownershipStatus != null,
      },
    });
  }

  /**
   * Select the best matching AI prompt template for the given lead and messages.
   *
   * Selection order:
   * 1. If no messages yet → initial_contact
   * 2. Check for objections in recent inbound messages → objection_handling
   * 3. CAMP discovery order: Priority → Money → Challenge → Authority
   * 4. If all CAMP complete → closing
   * 5. Fallback to generic prompt-table scan
   */
  async selectPrompt(
    lead: { status: string; askingPrice?: number | null; timeline?: number | null; conditionLevel?: string | null; ownershipStatus?: string | null },
    messages: { direction: string; body: string }[],
  ): Promise<{ systemPrompt: string; exampleMessages?: any[]; scenario?: string } | null> {
    const prompts = await this.prisma.aiPrompt.findMany({
      where: { isActive: true },
      orderBy: { priority: 'desc' },
    });

    const promptMap = new Map<string, typeof prompts[0]>();
    for (const p of prompts) {
      promptMap.set(p.scenario, p);
    }

    const messageCount = messages.length;
    const outboundCount = messages.filter((m) => m.direction === 'OUTBOUND').length;
    const inboundCount = messages.filter((m) => m.direction === 'INBOUND').length;

    // 1. No outbound messages yet AND no inbound → initial_contact
    //    If there are inbound messages, the seller already engaged — skip intro
    //    and go straight to CAMP discovery.
    if (outboundCount === 0 && inboundCount === 0) {
      const p = promptMap.get('initial_contact');
      if (p) return { systemPrompt: p.systemPrompt, exampleMessages: p.exampleMessages as any[], scenario: p.scenario };
    }

    // 2. Check for objections in the last inbound message
    const inboundMessages = messages.filter((m) => m.direction === 'INBOUND');
    if (inboundMessages.length > 0) {
      const objectionPrompt = promptMap.get('objection_handling');
      if (objectionPrompt) {
        const rules = objectionPrompt.contextRules as any;
        if (rules?.objectionKeywords?.length > 0) {
          const lastInbound = inboundMessages[inboundMessages.length - 1].body.toLowerCase();
          const hasObjection = rules.objectionKeywords.some(
            (keyword: string) => lastInbound.includes(keyword.toLowerCase()),
          );
          if (hasObjection) {
            return { systemPrompt: objectionPrompt.systemPrompt, exampleMessages: objectionPrompt.exampleMessages as any[], scenario: objectionPrompt.scenario };
          }
        }
      }
    }

    // 3. CAMP discovery order: Priority → Money → Challenge → Authority
    const campOrder: { field: string; scenario: string; fallback: string }[] = [
      { field: 'timeline', scenario: 'price_discovery', fallback: 'motivation_discovery' },
      { field: 'askingPrice', scenario: 'price_discovery', fallback: 'motivation_discovery' },
      { field: 'conditionLevel', scenario: 'property_condition', fallback: 'motivation_discovery' },
      { field: 'ownershipStatus', scenario: 'authority_discovery', fallback: 'motivation_discovery' },
    ];

    // Priority first
    if (lead.timeline == null) {
      const p = promptMap.get('motivation_discovery') || promptMap.get('follow_up');
      if (p) return { systemPrompt: p.systemPrompt, exampleMessages: p.exampleMessages as any[], scenario: p.scenario };
    }

    // Money
    if (lead.askingPrice == null) {
      const p = promptMap.get('price_discovery') || promptMap.get('motivation_discovery');
      if (p) return { systemPrompt: p.systemPrompt, exampleMessages: p.exampleMessages as any[], scenario: p.scenario };
    }

    // Challenge
    if (lead.conditionLevel == null) {
      const p = promptMap.get('property_condition') || promptMap.get('motivation_discovery');
      if (p) return { systemPrompt: p.systemPrompt, exampleMessages: p.exampleMessages as any[], scenario: p.scenario };
    }

    // Authority
    if (lead.ownershipStatus == null) {
      const p = promptMap.get('authority_discovery') || promptMap.get('motivation_discovery');
      if (p) return { systemPrompt: p.systemPrompt, exampleMessages: p.exampleMessages as any[], scenario: p.scenario };
    }

    // 4. All CAMP complete → closing
    if (lead.timeline != null && lead.askingPrice != null && lead.conditionLevel != null && lead.ownershipStatus != null) {
      const p = promptMap.get('closing') || promptMap.get('rbp_explanation');
      if (p) return { systemPrompt: p.systemPrompt, exampleMessages: p.exampleMessages as any[], scenario: p.scenario };
    }

    // 5. Fallback — scan all prompts with contextRules matching
    //    NEVER return initial_contact if the seller has already messaged us.
    for (const prompt of prompts) {
      if (prompt.scenario === 'initial_contact' && inboundCount > 0) continue;

      const rules = prompt.contextRules as any;
      if (!rules) continue;

      let matches = true;

      if (rules.leadStatuses?.length > 0 && !rules.leadStatuses.includes(lead.status)) matches = false;
      if (matches && rules.minMessages != null && messageCount < rules.minMessages) matches = false;
      if (matches && rules.maxMessages != null && messageCount > rules.maxMessages) matches = false;

      if (matches) {
        return { systemPrompt: prompt.systemPrompt, exampleMessages: prompt.exampleMessages as any[], scenario: prompt.scenario };
      }
    }

    return null;
  }

  /**
   * Generate message drafts using AI
   */
  async generateMessageDrafts(
    context: {
      sellerName: string;
      propertyAddress: string;
      conversationHistory?: string[];
      purpose?: string;
      knownData?: {
        askingPrice?: number | null;
        timeline?: number | null;
        conditionLevel?: string | null;
        ownershipStatus?: string | null;
      };
      justExtracted?: Record<string, any>;
      lastInboundMessage?: string;
    },
    promptOverride?: {
      systemPrompt: string;
      exampleMessages?: any[];
    },
    lead?: { status: string; askingPrice?: number | null; timeline?: number | null; conditionLevel?: string | null; ownershipStatus?: string | null },
    messages?: { direction: string; body: string }[],
  ): Promise<{ direct: string; friendly: string; professional: string }> {
    if (!this.anthropic) {
      // Fallback templates if no AI
      return this.getDefaultMessageDrafts(context);
    }

    // Cap conversation history to last 10 messages to control context size
    const fullHistory = context.conversationHistory ?? [];
    const trimmedHistory = fullHistory.length > 10 ? fullHistory.slice(-10) : fullHistory;
    const historyPrefix = fullHistory.length > 10
      ? `[Earlier conversation: ${fullHistory.length - 10} messages not shown]\n`
      : '';
    const history = fullHistory.length > 0
      ? historyPrefix + trimmedHistory.join('\n')
      : 'No previous messages';
    const purpose = context.purpose || 'follow up and move the conversation forward';

    // Determine which system prompt to use
    let systemMessage: string;
    let fewShotMessages: any[] = [];

    // SAFETY: if the seller has already messaged us, never use initial_contact prompt
    const hasInboundMessage = !!context.lastInboundMessage ||
      (messages && messages.some((m) => m.direction === 'INBOUND'));

    if (promptOverride) {
      // Explicit override (e.g. from test endpoint)
      systemMessage = promptOverride.systemPrompt;
      fewShotMessages = promptOverride.exampleMessages || [];
    } else if (lead && messages) {
      // Try to select a matching prompt template
      const selected = await this.selectPrompt(lead, messages);
      if (selected && selected.scenario !== 'initial_contact') {
        systemMessage = selected.systemPrompt;
        fewShotMessages = selected.exampleMessages || [];
      } else if (selected && selected.scenario === 'initial_contact' && !hasInboundMessage) {
        // Only use initial_contact when there are truly no inbound messages
        systemMessage = selected.systemPrompt;
        fewShotMessages = selected.exampleMessages || [];
      } else {
        // Fallback: safe follow-up prompt that will NEVER introduce itself
        systemMessage = `You are a real estate acquisitions specialist for "Fast Homes for Cash" continuing a conversation with a seller.
Continue the natural flow of conversation. Show you listened to what they've already said.
Be empathetic. Ask ONE question at a time. Keep under 160 characters. Sound human.
NEVER introduce yourself or the company — you are already in a conversation.
Always respond with valid JSON only.`;
      }
    } else {
      systemMessage = 'You write compliant, human-sounding text messages for real estate. Always respond with valid JSON only.';
    }

    // Build known data block for the prompt
    const knownData = context.knownData;
    const justExtracted = context.justExtracted;
    const justExtractedKeys = justExtracted ? Object.keys(justExtracted) : [];

    const knownDataLines: string[] = [];
    if (knownData) {
      const formatField = (label: string, value: any, fieldKey: string) => {
        const justProvided = justExtractedKeys.includes(fieldKey);
        if (value != null) {
          return `- ${label}: ${value}${justProvided ? ' (just provided)' : ''}`;
        }
        return `- ${label}: Unknown`;
      };
      knownDataLines.push(formatField('Asking Price', knownData.askingPrice != null ? `$${Number(knownData.askingPrice).toLocaleString()}` : null, 'askingPrice'));
      // Show timeline as urgency label — never as a raw day count — so the AI
      // doesn't echo back a specific number (e.g. "7 days") as if it's a promise.
      // Actual closing timelines (typically 30-60 days minimum) are handled by the team.
      const timelineLabel = knownData.timeline == null ? null
        : knownData.timeline <= 14 ? 'urgent / ASAP'
        : knownData.timeline <= 30 ? 'wants to move quickly (~1 month)'
        : knownData.timeline <= 90 ? 'moderate (~2-3 months)'
        : 'flexible / no rush';
      knownDataLines.push(formatField('Timeline', timelineLabel, 'timeline'));
      knownDataLines.push(formatField('Property Condition', knownData.conditionLevel, 'conditionLevel'));
      knownDataLines.push(formatField('Ownership', knownData.ownershipStatus, 'ownershipStatus'));
    }

    // Build last inbound message highlight
    const lastInboundBlock = context.lastInboundMessage
      ? `\nSeller's last message: "${context.lastInboundMessage}"\n`
      : '';

    // Determine if this is the first outreach (no conversation yet)
    const isFirstMessage = !context.conversationHistory || context.conversationHistory.length === 0;

    // Build acknowledgment instruction
    const acknowledgmentBlock = context.lastInboundMessage
      ? `\nCRITICAL: Your response MUST first acknowledge what the seller just said (confirm you received their answer — neutral phrases like "Got it" or "Thanks for sharing"), then naturally transition to asking about the next topic. Do NOT re-introduce yourself. Do NOT ask about information already provided above. Do NOT agree to, validate, or commit to any price, timeline, or terms — never say things like "$250k works", "that price sounds good", "7 days works for us", or anything that implies you are accepting their terms. NEVER use em dashes (—) in your message.\n`
      : '';

    const prompt = `Seller: ${context.sellerName}
Property: ${context.propertyAddress}
${knownDataLines.length > 0 ? `\nWhat we know about this seller:\n${knownDataLines.join('\n')}\n` : ''}${lastInboundBlock}
Conversation so far:
${history}

Goal: ${purpose}
${acknowledgmentBlock}
Generate 3 different message drafts:
1. "Direct" - straight to the point, businesslike
2. "Friendly" - warm and conversational
3. "Professional" - polite and formal

Rules:
- Keep each under 160 characters
- Ask only 1 question per message
- Be respectful and compliant
${isFirstMessage ? '- Include "Reply STOP to opt out" at the end\n' : ''}- Sound human, not spammy
- Do NOT ask about information already known (listed above)
- Do NOT agree to, validate, or commit to any price, timeline, or terms the seller mentioned (e.g. never say "$250k works", "that price works for us", "7 days works", or anything implying agreement)
- You are ONLY gathering information — all offers and decisions are made by the team, not in this message
- When acknowledging what the seller said, simply confirm receipt (e.g. "Got it, thanks" / "Thanks for letting me know") — neutral, no judgment on whether the terms work
- NEVER use em dashes (—) in any message; use a comma, period, or rephrase instead

Return ONLY a JSON object:
{
  "direct": "message text",
  "friendly": "message text",
  "professional": "message text"
}`;

    try {
      // Anthropic uses system param separately; user/assistant messages only in messages array
      // Few-shot examples are passed as alternating user/assistant turns
      const anthropicMessages: Anthropic.MessageParam[] = [];

      for (const example of fewShotMessages) {
        // Map 'system' role examples to 'user' so Anthropic accepts them
        const role = example.role === 'assistant' ? 'assistant' : 'user';
        anthropicMessages.push({ role, content: example.content });
      }

      anthropicMessages.push({ role: 'user', content: prompt });

      const response = await this.anthropic.messages.create({
        model: 'claude-haiku-4-5',
        max_tokens: 500,
        system: systemMessage,
        messages: anthropicMessages,
      });

      const content = (response.content[0] as any)?.text?.trim();
      if (!content) return this.getDefaultMessageDrafts(context);

      // Strip markdown code fences if model adds them
      const cleaned = content.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
      const drafts = JSON.parse(cleaned);
      return drafts;
    } catch (error) {
      this.logger.error('AI draft generation failed:', error.message);
      return this.getDefaultMessageDrafts(context);
    }
  }

  /**
   * Fallback message templates when AI is unavailable.
   * Uses conversation context to pick the right template — NEVER sends an
   * intro message when the seller has already replied.
   */
  private getDefaultMessageDrafts(context: {
    sellerName: string;
    propertyAddress: string;
    conversationHistory?: string[];
    knownData?: {
      askingPrice?: number | null;
      timeline?: number | null;
      conditionLevel?: string | null;
      ownershipStatus?: string | null;
    };
    justExtracted?: Record<string, any>;
    lastInboundMessage?: string;
  }): { direct: string; friendly: string; professional: string } {
    const name = context.sellerName;
    const hasConversation = context.conversationHistory && context.conversationHistory.length > 0;
    const known = context.knownData;
    const extracted = context.justExtracted;

    // If there's no conversation yet, send intro
    if (!hasConversation) {
      return {
        direct: `Hi ${name}, this is Fast Homes for Cash. I noticed your property at ${context.propertyAddress} — are you considering selling? Reply STOP to opt out.`,
        friendly: `Hey ${name}! I'm with Fast Homes for Cash and saw your place at ${context.propertyAddress}. Would love to learn more if you have a sec. Reply STOP to opt out.`,
        professional: `Hello ${name}, this is Fast Homes for Cash reaching out about ${context.propertyAddress}. Would you have a moment to discuss your property? Reply STOP to opt out.`,
      };
    }

    // Build acknowledgment if something was just extracted
    let ack = '';
    if (extracted) {
      if (extracted.askingPrice != null && extracted._askingPriceHigh != null) {
        const lo = Number(extracted.askingPrice).toLocaleString();
        const hi = Number(extracted._askingPriceHigh).toLocaleString();
        ack = `Got it, somewhere in the $${lo}–$${hi} range. `;
      } else if (extracted.askingPrice != null) {
        ack = `Got it, around $${Number(extracted.askingPrice).toLocaleString()}. `;
      } else if (extracted._askingPriceRaw) {
        ack = `Got it, noted the ${extracted._askingPriceRaw}. `;
      } else if (extracted.timeline != null) {
        ack = `${extracted.timeline} days — thanks for letting me know. `;
      } else if (extracted.conditionLevel != null) {
        ack = `Thanks for the details on the condition. `;
      } else if (extracted.ownershipStatus != null) {
        ack = `Good to know about the ownership. `;
      }
    }

    // Determine next missing CAMP field: Priority → Money → Challenge → Authority
    if (known) {
      if (known.timeline == null) {
        return {
          direct: `${ack}How soon are you looking to sell?`,
          friendly: `${ack}Quick question — do you have a timeline in mind for selling? No rush, just curious.`,
          professional: `${ack}May I ask what your ideal timeline would be for completing a sale?`,
        };
      }
      if (known.askingPrice == null) {
        return {
          direct: `${ack}Do you have a ballpark price in mind?`,
          friendly: `${ack}Just curious — do you have a price range you're hoping for?`,
          professional: `${ack}What price range would you be comfortable with for the property?`,
        };
      }
      if (known.conditionLevel == null) {
        return {
          direct: `${ack}How's the condition of the property?`,
          friendly: `${ack}How would you describe the condition? Any repairs needed or is it move-in ready?`,
          professional: `${ack}Could you share a bit about the current condition of the property?`,
        };
      }
      if (known.ownershipStatus == null) {
        return {
          direct: `${ack}Are you the sole owner?`,
          friendly: `${ack}Last question — are you the sole owner, or are there other decision-makers involved?`,
          professional: `${ack}May I ask about the ownership situation? Are you the sole decision-maker?`,
        };
      }

      // All CAMP complete
      return {
        direct: `${ack}Thanks for all the info, ${name}. I'll put together some numbers and get back to you shortly.`,
        friendly: `${ack}Really appreciate you sharing all that, ${name}! Let me review everything and I'll get back to you with next steps soon.`,
        professional: `${ack}Thank you for the information, ${name}. I will review the details and follow up with you shortly regarding next steps.`,
      };
    }

    // Generic follow-up when we have conversation but no knownData tracking
    return {
      direct: `Thanks ${name}. What else can you tell me about the property?`,
      friendly: `Thanks for sharing that, ${name}! What else can you tell me about your situation?`,
      professional: `Thank you, ${name}. Could you share any additional details about the property?`,
    };
  }
}

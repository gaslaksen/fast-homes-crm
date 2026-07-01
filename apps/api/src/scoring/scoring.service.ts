import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Anthropic from '@anthropic-ai/sdk';
import { ScoringInput, ScoringResult, AIExtractionResult } from '@fast-homes/shared';
import { calculateScoreBand, calculateABCDFit } from '@fast-homes/shared';
import { PrismaService } from '../prisma/prisma.service';
import { sanitizeOutboundSmsBody } from '../webhooks/sms-body-normalize.util';

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
  async extractFromMessages(
    messages: Array<{ direction: 'INBOUND' | 'OUTBOUND'; body: string } | string>,
  ): Promise<AIExtractionResult> {
    if (!this.anthropic || messages.length === 0) {
      return {};
    }

    // Cap to last 10 messages and label by direction so the AI can tell whose
    // statement is whose. Backwards-compatible with bare strings (treated as
    // INBOUND), but all production callers should pass directional objects.
    const recentMessages = messages.slice(-10).map((m) =>
      typeof m === 'string'
        ? { direction: 'INBOUND' as const, body: m }
        : m,
    );
    const conversationText = recentMessages
      .map((m) => `${m.direction}: ${m.body}`)
      .join('\n');

    const prompt = `You are analyzing SMS text messages from a property seller in a real estate context. Extract key information, being smart about informal language.

The conversation below is labeled with INBOUND (the seller's messages) and OUTBOUND (the agent's questions).
Only extract claims the SELLER made — i.e. only treat INBOUND lines as answers. Never extract a value from OUTBOUND lines (those are the agent's questions, not facts about the property).

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

CRITICAL — DO NOT extract a number as asking_price if it's clearly a PAST LISTING, APPRAISAL, ZILLOW ESTIMATE, or TAX ASSESSMENT. Those are historical/aspiration numbers, not what the seller would actually accept today. Examples that should NOT populate asking_price:
- "we had it listed for 850k" / "listed it for X" / "we listed at X" / "it was on the market for X"
- "the realtor had it at X"
- "it appraised at X" / "appraisal came in at X"
- "Zillow says X" / "Zestimate is X"
- "county / assessor / tax valued it at X"
- "it's worth X" (unclear source, don't extract)
For any of the above, leave asking_price null so the AI keeps probing for their actual acceptable number. Only extract asking_price when the seller states what they WANT / WOULD TAKE / ARE ASKING (e.g. "I want 70k", "I'd take 250", "looking for around 400", "asking 200k").

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

**Ownership** — map natural-language seller answers to one of the four enum values. Read INBOUND lines in light of the OUTBOUND question that came right before:
- "I own it", "just me", "it's mine", "I'm the only owner", "yes I'm the sole owner", "yes just me" → "sole_owner"
- "my wife/husband and I", "we own it", "we're both on it", "we're both on the title", "joint", "co-own with X", "my partner and I", "yes we both own it" → "co_owner"
- "I inherited it", "it was my mom's/dad's", "estate", "she/he passed away", "I'm the executor", "we got it after [parent] died" → "heir"
- "I rent it", "I'm not the owner", "my landlord", "I don't own it", "just helping a relative" → "not_owner"
- A bare "yes" or "no" reply to an ambiguous compound question (e.g. "are you the only owner OR is anyone else on it?") is NOT enough — return null for ownership_status on that turn unless an earlier INBOUND line in the visible window already made it clear.
- Earlier turns count: if the seller said "my husband and I are both on it" three messages ago, ownership_status is "co_owner" even if the most recent INBOUND is just "yes". Use the whole visible window, not just the last line.
- Only return null if there is genuinely no ownership signal anywhere in the seller's messages.

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
   * Selection logic (simplified):
   * 1. If no messages yet → initial_contact (fixed template)
   * 2. All other conversations → conversational prompt (AI decides flow)
   *
   * The rigid CAMP field ordering has been removed. The conversational prompt
   * gives the AI full context and lets it decide what to explore next based
   * on the natural flow of conversation.
   */
  async selectPrompt(
    lead: { status: string; askingPrice?: number | null; timeline?: number | null; conditionLevel?: string | null; ownershipStatus?: string | null },
    messages: { direction: string; body: string }[],
  ): Promise<{ systemPrompt: string; exampleMessages?: any[]; scenario?: string } | null> {
    const outboundCount = messages.filter((m) => m.direction === 'OUTBOUND').length;
    const inboundCount = messages.filter((m) => m.direction === 'INBOUND').length;

    // 1. No messages at all → initial_contact (fixed template handled elsewhere)
    if (outboundCount === 0 && inboundCount === 0) {
      const prompts = await this.prisma.aiPrompt.findMany({
        where: { isActive: true, scenario: 'initial_contact' },
      });
      const p = prompts[0];
      if (p) return { systemPrompt: p.systemPrompt, exampleMessages: p.exampleMessages as any[], scenario: p.scenario };
    }

    // 2. All active conversations use the single conversational prompt.
    //    The AI receives CAMP progress as context and decides what to do next.
    const conversationalPrompt = await this.prisma.aiPrompt.findUnique({
      where: { scenario: 'conversational' },
    });
    if (conversationalPrompt) {
      return {
        systemPrompt: conversationalPrompt.systemPrompt,
        exampleMessages: conversationalPrompt.exampleMessages as any[],
        scenario: 'conversational',
      };
    }

    // Fallback if conversational prompt not yet seeded
    return null;
  }

  /**
   * Generate message drafts using AI
   */
  async generateMessageDrafts(
    context: {
      sellerName: string;
      propertyAddress: string;
      businessName?: string;
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
  ): Promise<{ message: string }> {
    if (!this.anthropic) {
      // Fallback templates if no AI
      return this.getDefaultMessageDrafts(context);
    }

    // Cap conversation history to last 20 messages for richer context
    const fullHistory = context.conversationHistory ?? [];
    const trimmedHistory = fullHistory.length > 20 ? fullHistory.slice(-20) : fullHistory;
    const historyPrefix = fullHistory.length > 20
      ? `[Earlier conversation: ${fullHistory.length - 20} messages not shown]\n`
      : '';
    const history = fullHistory.length > 0
      ? historyPrefix + trimmedHistory.join('\n')
      : 'No previous messages';
    const purpose = context.purpose || 'Continue the conversation naturally. Respond to what the seller said, and if appropriate, explore any missing CAMP info in a conversational way.';

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
        // Fallback: safe conversational prompt that will NEVER introduce itself
        systemMessage = `You're a local property investor named Dax, texting a seller from your phone. You buy houses from people who want a quick, simple sale. Text like a real person — warm, honest, conversational.
Continue the natural flow of conversation. Respond to what the seller said. Show you're actually listening.
If it flows naturally, explore any missing info about the property (condition, price, timeline, ownership) but don't force it.
Keep it under 600 characters. Sound like a real text message from a friendly person.
NEVER introduce yourself or the company — you are already in a conversation.
Always respond with valid JSON only.`;
      }
    } else {
      systemMessage = 'You write casual, human-sounding text messages for real estate. Text like a real person, not a chatbot. Always respond with valid JSON only.';
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

    // Build acknowledgment instruction — include recent outbound messages so AI avoids repeating phrases
    const recentOutbound = (context.conversationHistory ?? [])
      .filter(line => line.startsWith('OUTBOUND:'))
      .slice(-3)
      .map(line => line.replace('OUTBOUND:', '').trim());
    const recentOutboundNote = recentOutbound.length > 0
      ? `\nYour last few messages: ${recentOutbound.map(m => `"${m}"`).join(' / ')}\nDo NOT repeat or closely echo the same opening phrase as those messages.`
      : '';

    const acknowledgmentBlock = context.lastInboundMessage
      ? `\nCRITICAL: Your response MUST first briefly acknowledge what the seller just said, then naturally transition to asking about the next topic. Do NOT re-introduce yourself. Do NOT ask about information already provided above. Do NOT agree to, validate, or commit to any price, timeline, or terms — never say things like "$250k works", "that price sounds good", "7 days works for us", or anything that implies you are accepting their terms.
VARIETY: Use varied, natural acknowledgments — e.g. "Got it", "Ok cool", "Makes sense", "Appreciate that", "Good to know", "Perfect", "Ok great", "Gotcha", "Sounds good" — pick one that fits the context and hasn't been used in the last 2-3 messages. NEVER default to "Thank you" or "Thanks for sharing". Use normal capitalization.${recentOutboundNote}\n`
      : '';

    const prompt = `Seller: ${context.sellerName}
Property: ${context.propertyAddress}
${knownDataLines.length > 0 ? `\nWhat we know about this seller:\n${knownDataLines.join('\n')}\n` : ''}${lastInboundBlock}
Conversation so far:
${history}

Goal: ${purpose}
${acknowledgmentBlock}
Generate ONE text message. Be conversational and warm but use normal grammar and capitalization.

Rules:
- Under 600 characters. Match length to the situation. Short when appropriate, longer for thoughtful responses.
- Ask at most 1 question per message (it's ok to not ask a question if the situation calls for it)
- Sound like a friendly, down-to-earth person texting, not a chatbot
- Use normal capitalization and grammar
- Use contractions naturally (don't, won't, that's, we'll)
- No colons, semicolons, or em dashes
- Do NOT ask about information already known (listed above)
- Do NOT agree to, validate, or commit to any price, timeline, or terms the seller mentioned
- NEVER echo back or agree to specific dates, months, or timelines (e.g. never say "November works", "that timeline works", "30 days sounds good")
- NEVER use the phrase "Quick question"
- NEVER use em dashes, hyphens as dashes, or colons
- You are ONLY gathering information. All offers and decisions come from the team
- Read the conversation history and make sure your reply flows naturally
- If the seller shares something personal or emotional, acknowledge it genuinely before moving to business
- If the seller asked you a question, answer it

PRICE DISCOVERY - critical for real qualification:
- If the seller mentions a PAST LISTING PRICE or an APPRAISAL / Zillow / tax number, do NOT treat that as their asking price. That number is context, not commitment - they may accept substantially less.
- When a listing/appraisal number appears, DO NOT repeat it back as if it's their ask. Never say things like "$850k, got it" or "so you're asking 850". Instead, probe with a follow-up question about WHY it didn't sell or what they learned:
  - "Interesting, what kind of feedback did you get from showings at that number?"
  - "Was that from a while back? Any sense of why it didn't move at that price?"
  - "Got it, was that with a realtor? What did they say about it?"
- Continue with the other CAMP topics (timeline, condition, ownership) while their real acceptable number is still unknown.
- Once you have a reasonable picture of the place, transition to asking their ACTUAL acceptable number with a hypothetical framing. Keep it short, one sentence, one question. Examples:
  - "Assuming everything else lined up on our end and we could move on this quickly, what number would you actually take for it?"
  - "If we could put something together that closes fast and takes the hassle off your plate, where would you land price-wise?"
  - "What number would you actually walk with if we could keep this simple and move in a month or so?"
- CRITICAL: even in these hypothetical framings, do NOT stack benefit phrases (no "cash offer + no closing costs + no realtor fees" - carrier will block). Pick ONE soft framing at most.

CARRIER COMPLIANCE (A2P 10DLC) - these phrasing patterns trigger US mobile carrier filters and get the SMS blocked at the network level. NEVER use any of them:
- "we buy houses" / "we buy homes" / "cash buyer" / "cash offer" / "cash for your house" / "fast cash" / "all cash"
- "no repairs" / "no realtor fees" / "no commissions" / "no closing costs" / "we cover closing costs"
- "any condition" / "as-is" / "quick sale" / "fast sale"
- Stacked benefit lists like "no repairs, no fees, we cover closing costs"
- Anything that reads like a real estate investor marketing pitch or solicitation
- "make it simple/easy" combined with selling-the-house language
- Promises about timeline, repairs, fees, or process

If the seller asks what you do / what options / how this works / why you're texting:
- Do NOT describe the buying process or list value props. That's what gets blocked.
- Briefly redirect with one short sentence and a CAMP question.
- The seller submitted a form so they already know roughly what we do - don't re-pitch.
- Good example: "Good question, the team puts together what makes sense once we have a better picture of the place. How's it holding up?"
- Good example: "Honestly depends on the situation, that's why I'm asking. What kind of shape is the place in right now?"
- Good example: "Team handles all that based on the situation. Mind if I ask, are you the only one on the title?"
- BAD example (will get blocked): "We buy houses for cash, no repairs needed, we cover closing costs"
- BAD example (will get blocked): "We make it simple - no realtor fees, no commissions, we work around your timeline"

Return ONLY a JSON object:
{
  "message": "your text message here"
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
        model: 'claude-sonnet-4-5',
        max_tokens: 500,
        system: systemMessage,
        messages: anthropicMessages,
      });

      const content = (response.content[0] as any)?.text?.trim();
      if (!content) return this.getDefaultMessageDrafts(context);

      // Strip markdown code fences if model adds them
      const cleaned = content.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
      const drafts = JSON.parse(cleaned);

      // Hard guarantee that em dashes, smart quotes, and similar Unicode
      // characters never reach the seller — the prompt forbids them but the
      // model still slips occasionally. Stripping here also keeps the stored
      // body byte-equal to what SmrtPhone delivers, so the smsOutgoing
      // webhook matcher never misclassifies our own message as a manual
      // reply (Meghan Kinee thread, 2026-05-08).
      if (drafts && typeof drafts.message === 'string') {
        drafts.message = sanitizeOutboundSmsBody(drafts.message);
      }
      return drafts;
    } catch (error) {
      this.logger.error('AI draft generation failed:', error.message);
      return this.getDefaultMessageDrafts(context);
    }
  }

  /**
   * Stateless variant of the conversational auto-response used by external
   * partners (e.g. Closercontrol). Same persona, same few-shot examples, same
   * CAMP-aware prompting as Dealcore's native auto-response — minus the
   * property-context branches (ARV, mortgage, last sale) and minus any DB
   * writes.
   *
   * Takes a full context object instead of a Lead row, so it can be called
   * from anywhere without touching the Lead model or its automation.
   */
  async generateExternalResponse(input: {
    sellerFirstName: string;
    conversationHistory: { direction: 'INBOUND' | 'OUTBOUND'; body: string }[];
    knownFields: {
      timeline?: number | null;
      askingPrice?: number | null;
      conditionLevel?: string | null;
      ownershipStatus?: string | null;
    };
    justExtracted?: Record<string, any>;
  }): Promise<{ message: string; campComplete: boolean; missingFields: string[] }> {
    const { sellerFirstName, conversationHistory, knownFields, justExtracted } = input;

    // ── Determine CAMP progress ────────────────────────────────────────────
    const campFields = [
      { field: 'timeline',        label: 'Timeline/Priority',     known: knownFields.timeline != null },
      { field: 'askingPrice',     label: 'Asking Price',          known: knownFields.askingPrice != null },
      { field: 'conditionLevel',  label: 'Property Condition',    known: knownFields.conditionLevel != null },
      { field: 'ownershipStatus', label: 'Ownership/Authority',   known: knownFields.ownershipStatus != null },
    ];
    const campComplete = campFields.every((f) => f.known);
    const knownLabels   = campFields.filter((f) =>  f.known).map((f) => f.label);
    const missingLabels = campFields.filter((f) => !f.known).map((f) => f.label);

    // ── Build "just extracted" summary so the AI can acknowledge naturally ─
    const justExtractedDescriptions: string[] = [];
    if (justExtracted) {
      if (justExtracted.asking_price != null) {
        if (justExtracted.asking_price_high) {
          const lo = Number(justExtracted.asking_price).toLocaleString();
          const hi = Number(justExtracted.asking_price_high).toLocaleString();
          justExtractedDescriptions.push(`their asking price range is $${lo}-$${hi}`);
        } else {
          justExtractedDescriptions.push(`their asking price is $${Number(justExtracted.asking_price).toLocaleString()}`);
        }
      } else if (justExtracted.asking_price_raw) {
        justExtractedDescriptions.push(`they mentioned a price of "${justExtracted.asking_price_raw}" (treat this as their ballpark)`);
      }
      if (justExtracted.timeline_days != null) {
        const d = justExtracted.timeline_days;
        const label = d <= 14 ? 'they want to move urgently / as soon as possible'
          : d <= 30 ? 'they want to move quickly, within about a month'
          : d <= 90 ? 'they have a moderate timeline of a couple months'
          : 'they are flexible on timing';
        justExtractedDescriptions.push(label);
      }
      if (justExtracted.condition_level != null) justExtractedDescriptions.push(`the property condition is ${justExtracted.condition_level}`);
      if (justExtracted.ownership_status != null) justExtractedDescriptions.push(`their ownership status is ${justExtracted.ownership_status}`);
      if (justExtracted.distress_signals?.length) justExtractedDescriptions.push(`distress signals: ${justExtracted.distress_signals.join(', ')}`);
    }
    const justExtractedSummary = justExtractedDescriptions.length > 0
      ? `The seller just told you ${justExtractedDescriptions.join(' and ')}. Simply confirm you received their answer (e.g. "Got it", "Thanks for sharing that") - do NOT agree to, commit to, or validate their price or timeline. You are gathering information only, not making any offer or promise.`
      : '';

    // ── Build the purpose string. No property facts available in this path. ─
    let purpose: string;
    if (campComplete) {
      const knownSummary = [
        knownFields.timeline != null     ? `timeline of ${knownFields.timeline === 365 ? 'no specific urgency' : `~${knownFields.timeline} days`}` : null,
        knownFields.askingPrice != null  ? `asking price around $${Number(knownFields.askingPrice).toLocaleString()}` : null,
        knownFields.conditionLevel != null ? `property in ${knownFields.conditionLevel} condition` : null,
        knownFields.ownershipStatus != null ? `ownership: ${knownFields.ownershipStatus.replace('_', ' ')}` : null,
      ].filter(Boolean).join(', ');

      purpose = `CAMP COMPLETE - DO NOT ASK ANY MORE QUESTIONS. This is your closing message.
What you know: ${knownSummary || 'gathered all key details'}.
Your message must:
1. Thank ${sellerFirstName} sincerely for their time and for sharing
2. Tell them someone from the team will review the information and reach out soon to discuss next steps
3. Keep it warm and genuine
4. Do NOT ask anything. Do NOT request more info. End the conversation professionally.
5. Do NOT repeat back their price or timeline in a way that implies agreement or commitment.`;
    } else {
      purpose = `${justExtractedSummary ? justExtractedSummary + ' ' : ''}
CAMP PROGRESS:
- Already gathered: ${knownLabels.length > 0 ? knownLabels.join(', ') : 'Nothing yet'}
- Still need: ${missingLabels.join(', ')}

Read the seller's last message carefully. Respond naturally to what they said.
KEEP THE CONVERSATION GOING. Do NOT wrap up just because they answered one question - there are still missing topics and there's plenty more to learn. After you acknowledge what they said, take ONE of these moves: ask about a missing CAMP topic, or dig deeper into something they mentioned. Vary your approach across messages.
If the conversation naturally opens up a chance to learn about one of the missing topics, take it. But do NOT force it. It's fine to just respond to what the seller said without asking a CAMP question if the moment isn't right.
If the seller seems frustrated, confused, sharing something personal, or asked you a direct question, address THAT first. Building rapport is more important than checking boxes.
You decide the right approach based on the conversation flow.`.trim();
    }

    // ── Build the same shape generateMessageDrafts() expects ──────────────
    const conversationLines = conversationHistory.map((m) => `${m.direction}: ${m.body}`);
    const inboundMessages = conversationHistory.filter((m) => m.direction === 'INBOUND');
    const lastInboundMessage = inboundMessages.length > 0
      ? inboundMessages[inboundMessages.length - 1].body
      : undefined;

    // Map the snake_case extraction keys to the camelCase justExtracted shape
    // generateMessageDrafts expects (it reads askingPrice/timeline/etc).
    const justExtractedForDrafts: Record<string, any> | undefined = justExtracted ? {
      askingPrice:     justExtracted.asking_price ?? undefined,
      _askingPriceRaw: justExtracted.asking_price_raw ?? undefined,
      _askingPriceHigh: justExtracted.asking_price_high ?? undefined,
      timeline:        justExtracted.timeline_days ?? undefined,
      conditionLevel:  justExtracted.condition_level ?? undefined,
      ownershipStatus: justExtracted.ownership_status ?? undefined,
      distressSignals: justExtracted.distress_signals ?? undefined,
    } : undefined;

    // Synthesize a minimal "lead-shape" object so generateMessageDrafts() can
    // run selectPrompt() and pick the right persona from ai_prompts. We never
    // write this anywhere; it's purely for prompt selection.
    const syntheticLead = {
      status: 'QUALIFYING',
      askingPrice:     knownFields.askingPrice ?? null,
      timeline:        knownFields.timeline ?? null,
      conditionLevel:  knownFields.conditionLevel ?? null,
      ownershipStatus: knownFields.ownershipStatus ?? null,
    };
    const syntheticMessages = conversationHistory.map((m) => ({ direction: m.direction, body: m.body }));

    const drafts = await this.generateMessageDrafts(
      {
        sellerName: sellerFirstName || 'there',
        propertyAddress: '',           // intentionally blank - external partner does not pass this
        conversationHistory: conversationLines,
        purpose,
        knownData: knownFields,
        justExtracted: justExtractedForDrafts,
        lastInboundMessage,
      },
      undefined,
      syntheticLead,
      syntheticMessages,
    );

    return {
      message: drafts.message,
      campComplete,
      missingFields: campFields.filter((f) => !f.known).map((f) => f.field),
    };
  }

  /**
   * Fallback message templates when AI is unavailable.
   * Uses conversation context to pick the right template — NEVER sends an
   * intro message when the seller has already replied.
   */
  private getDefaultMessageDrafts(context: {
    sellerName: string;
    propertyAddress: string;
    businessName?: string;
    conversationHistory?: string[];
    knownData?: {
      askingPrice?: number | null;
      timeline?: number | null;
      conditionLevel?: string | null;
      ownershipStatus?: string | null;
    };
    justExtracted?: Record<string, any>;
    lastInboundMessage?: string;
  }): { message: string } {
    const name = context.sellerName;
    const hasConversation = context.conversationHistory && context.conversationHistory.length > 0;
    const known = context.knownData;
    const extracted = context.justExtracted;

    // If there's no conversation yet, send fixed intro
    if (!hasConversation) {
      return {
        message: `Hi ${name}, this is Dax. We just received your information about you looking to sell your house. How much are you asking for it? What are your timelines to sell?`,
      };
    }

    // Build acknowledgment if something was just extracted
    let ack = '';
    if (extracted) {
      if (extracted.askingPrice != null && extracted._askingPriceHigh != null) {
        const lo = Number(extracted.askingPrice).toLocaleString();
        const hi = Number(extracted._askingPriceHigh).toLocaleString();
        ack = `Got it, somewhere in the $${lo}-$${hi} range. `;
      } else if (extracted.askingPrice != null) {
        ack = `Got it, around $${Number(extracted.askingPrice).toLocaleString()}. `;
      } else if (extracted._askingPriceRaw) {
        ack = `Got it, noted the ${extracted._askingPriceRaw}. `;
      } else if (extracted.timeline != null) {
        ack = `Ok cool, thanks for letting me know. `;
      } else if (extracted.conditionLevel != null) {
        ack = `Got it, appreciate the details on the condition. `;
      } else if (extracted.ownershipStatus != null) {
        ack = `Good to know on the ownership. `;
      }
    }

    // Determine next missing CAMP field: Priority → Money → Challenge → Authority
    if (known) {
      if (known.timeline == null) {
        return { message: `${ack}Do you have a rough timeline in mind? Are you trying to move on this quickly or is there no rush?` };
      }
      if (known.askingPrice == null) {
        return { message: `${ack}Do you have a rough number in mind for the place?` };
      }
      if (known.conditionLevel == null) {
        return { message: `${ack}How's the place holding up? Anything major going on with it?` };
      }
      if (known.ownershipStatus == null) {
        return { message: `${ack}One more thing, are you the only one on the deed or is someone else involved too?` };
      }

      // All CAMP complete
      return { message: `${ack}Awesome, really appreciate all that ${name}. Our team is going to review everything and get back to you soon with next steps` };
    }

    // Generic follow-up when we have conversation but no knownData tracking
    return { message: `Got it ${name}, is there anything else about the place or your situation I should know about?` };
  }
}

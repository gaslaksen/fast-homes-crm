import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Anthropic from '@anthropic-ai/sdk';

export interface SuggestDto {
  channel: 'TEXT' | 'EMAIL';
  tone?: string;
  instructions?: string;
  campaignName?: string;
  stepNumber?: number;
  numSteps?: number;
}

export interface ImproveDto {
  body: string;
  instructions: string;
  channel: 'TEXT' | 'EMAIL';
}

export interface GenerateSequenceDto {
  numSteps: number;
  channelMix: 'ALL_SMS' | 'ALL_EMAIL' | 'MIXED';
  tone: string;
  goal: string;
  campaignContext?: string;
}

@Injectable()
export class CampaignAiService {
  private readonly logger = new Logger(CampaignAiService.name);
  private anthropic: Anthropic | null = null;

  constructor(private config: ConfigService) {
    const apiKey = this.config.get<string>('ANTHROPIC_API_KEY');
    if (apiKey) {
      this.anthropic = new Anthropic({ apiKey });
    } else {
      this.logger.warn('⚠️  ANTHROPIC_API_KEY not set — AI campaign features disabled');
    }
  }

  private requireAI() {
    if (!this.anthropic) {
      throw new Error('AI not configured — ANTHROPIC_API_KEY is required');
    }
    return this.anthropic;
  }

  async generateSuggestion(dto: SuggestDto): Promise<{ subject?: string; body: string; reasoning: string }> {
    const ai = this.requireAI();
    const isSms = dto.channel === 'TEXT';

    const systemPrompt = `You are an expert real estate investor copywriter specializing in motivated seller outreach.
You write compelling, empathetic messages that convert stale leads into conversations.
Always respond with valid JSON only.`;

    const userPrompt = `Generate a ${isSms ? 'SMS text message' : 'email'} for a real estate drip campaign.

Tone: ${dto.tone || 'Friendly'}
${dto.instructions ? `Special instructions: ${dto.instructions}` : ''}
${dto.campaignName ? `Campaign: ${dto.campaignName}` : ''}
${dto.stepNumber ? `Step ${dto.stepNumber} of ${dto.numSteps || '?'}` : ''}

Available merge fields: {{firstName}}, {{lastName}}, {{propertyAddress}}, {{city}}, {{state}}, {{offerAmount}}, {{arvEstimate}}, {{companyName}}, {{senderName}}

${isSms ? 'IMPORTANT: The body must be under 160 characters. Keep it very short and punchy. End with "Reply STOP to opt out."' : 'Write a full email with greeting and professional sign-off.'}

Respond with JSON only:
{
  ${!isSms ? '"subject": "Email subject line with merge fields",' : ''}
  "body": "Message body with merge fields",
  "reasoning": "Brief explanation of the strategy"
}`;

    const response = await ai.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 512,
      messages: [{ role: 'user', content: userPrompt }],
      system: systemPrompt,
    });

    const text = response.content[0].type === 'text' ? response.content[0].text : '';
    try {
      const cleaned = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      return JSON.parse(cleaned);
    } catch {
      return { body: text, reasoning: 'AI generated message' };
    }
  }

  async improveMessage(dto: ImproveDto): Promise<{ body: string; subject?: string; reasoning: string }> {
    const ai = this.requireAI();
    const isSms = dto.channel === 'TEXT';

    const response = await ai.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 512,
      messages: [
        {
          role: 'user',
          content: `Improve this real estate outreach ${isSms ? 'SMS' : 'email'} message.

Original message:
${dto.body}

Instructions: ${dto.instructions}

${isSms ? 'Keep it under 160 characters.' : 'Keep the full email format with greeting and sign-off.'}

Respond with JSON only:
{
  "body": "Improved message",
  "reasoning": "What you changed and why"
}`,
        },
      ],
    });

    const text = response.content[0].type === 'text' ? response.content[0].text : '';
    try {
      const cleaned = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      return JSON.parse(cleaned);
    } catch {
      return { body: text, reasoning: 'AI improved message' };
    }
  }

  async generateFullSequence(dto: GenerateSequenceDto): Promise<
    Array<{
      stepOrder: number;
      channel: 'TEXT' | 'EMAIL';
      delayDays: number;
      delayHours: number;
      subject?: string;
      body: string;
      reasoning: string;
    }>
  > {
    const ai = this.requireAI();

    const channelInstructions: Record<string, string> = {
      ALL_SMS: 'All steps should be SMS text messages (under 160 characters each).',
      ALL_EMAIL: 'All steps should be emails with subjects and full body.',
      MIXED: 'Mix SMS and email steps strategically. Start with SMS for quick engagement, use email for deeper messages.',
    };

    const systemPrompt = `You are an expert real estate investor campaign strategist.
Create multi-step re-engagement campaigns for motivated seller leads.
Always respond with valid JSON only — an array of step objects.`;

    const userPrompt = `Create a ${dto.numSteps}-step drip campaign sequence for real estate motivated seller re-engagement.

Goal: ${dto.goal}
Tone: ${dto.tone}
Channel mix: ${channelInstructions[dto.channelMix]}
${dto.campaignContext ? `Context: ${dto.campaignContext}` : ''}

Available merge fields: {{firstName}}, {{lastName}}, {{propertyAddress}}, {{city}}, {{state}}, {{offerAmount}}, {{companyName}}, {{senderName}}

Rules:
- First step should have delayDays: 0 (send immediately upon enrollment)
- Subsequent steps should have increasing delays (3-14 days apart typically)
- SMS bodies must be under 160 characters and end with "Reply STOP to opt out."
- Email bodies should have a greeting and professional sign-off
- Each step should build on the previous one's narrative

Respond with JSON array only:
[
  {
    "stepOrder": 1,
    "channel": "TEXT",
    "delayDays": 0,
    "delayHours": 0,
    "subject": null,
    "body": "Message body",
    "reasoning": "Why this step works"
  }
]`;

    const response = await ai.messages.create({
      model: 'claude-sonnet-4-5',
      max_tokens: 2048,
      messages: [{ role: 'user', content: userPrompt }],
      system: systemPrompt,
    });

    const text = response.content[0].type === 'text' ? response.content[0].text : '[]';
    try {
      const cleaned = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      return JSON.parse(cleaned);
    } catch {
      this.logger.error('Failed to parse AI sequence response:', text);
      return [];
    }
  }
}

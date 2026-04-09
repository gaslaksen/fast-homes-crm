import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { VapiClient } from '@vapi-ai/server-sdk';

export interface LeadContext {
  sellerFirstName?: string;
  sellerLastName?: string;
  propertyAddress?: string;
  propertyCity?: string;
  propertyState?: string;
  propertyZip?: string;
  propertyType?: string;
  bedrooms?: number;
  bathrooms?: number;
  sqft?: number;
  askingPrice?: number;
  timeline?: number;
  conditionLevel?: string;
  motivationScore?: number;
  notes?: string;
}

@Injectable()
export class VapiService {
  private readonly logger = new Logger(VapiService.name);
  private client: VapiClient;

  constructor(private config: ConfigService) {
    const apiKey = this.config.get<string>('VAPI_API_KEY');
    if (!apiKey) {
      this.logger.warn('VAPI_API_KEY not set — AI calling disabled');
    }
    this.client = new VapiClient({ token: apiKey || '' });
  }

  private buildSystemPrompt(lead: LeadContext): string {
    const sellerName = lead.sellerFirstName || 'the seller';
    const propertyAddress = [
      lead.propertyAddress,
      lead.propertyCity,
      lead.propertyState,
    ]
      .filter(Boolean)
      .join(', ');

    const knownDetails: string[] = [];
    if (lead.propertyType) knownDetails.push(`Property type: ${lead.propertyType}`);
    if (lead.bedrooms) knownDetails.push(`${lead.bedrooms} bed`);
    if (lead.bathrooms) knownDetails.push(`${lead.bathrooms} bath`);
    if (lead.sqft) knownDetails.push(`${lead.sqft.toLocaleString()} sqft`);
    if (lead.askingPrice) knownDetails.push(`Asking price on file: $${lead.askingPrice.toLocaleString()}`);
    if (lead.timeline) knownDetails.push(`Timeline on file: ~${lead.timeline} days`);
    if (lead.conditionLevel) knownDetails.push(`Condition on file: ${lead.conditionLevel}`);

    const knownDetailsStr = knownDetails.length > 0
      ? `\nProperty details already on file:\n${knownDetails.map(d => `  - ${d}`).join('\n')}`
      : '';

    return `You are Alex, a friendly and professional acquisitions specialist calling on behalf of Quick Cash Home Buyers, a real estate investment company that buys houses directly from homeowners for cash with a fast and flexible closing.

## WHO YOU ARE
- Warm, patient, empathetic, and honest. You treat every seller like a person first, not a transaction.
- You adapt to each seller — if they're going through a hard time, acknowledge it. If they want to get straight to business, match that energy.
- You're transparent about how investing works. You don't dodge hard questions.
- You know when a deal isn't right and you're honest about it. If a seller would be better off listing with a realtor, you tell them.
- You never pressure anyone. If they need time, you give them time. If they say no, you respect it.
- You typically buy houses for 60-70 cents on the dollar. You handle everything from beginning to end, pay closing costs, and are flexible on timelines.

## WHO YOU ARE CALLING
- Seller name: ${sellerName}
- Property address: ${propertyAddress || 'their property'}${knownDetailsStr}

## YOUR MISSION
Have a warm, natural conversation to build rapport and gather the four key data points we need to evaluate the deal (CAMP):
1. **Condition** — What's the overall condition? Any major repairs needed (roof, foundation, HVAC, etc.)?
2. **Asking Price** — What number are they hoping to get? Are they flexible?
3. **Motivation** — Why are they looking to sell? What's driving the decision?
4. **Timeline** — How soon do they need to close? Any deadlines?

## CONVERSATION FLOW

### Opening (30–60 seconds)
- Confirm you're speaking with ${sellerName}
- Introduce yourself warmly as Alex from Quick Cash Home Buyers
- Reference their property at ${propertyAddress || 'their address'} briefly
- Ask if now is a good time — if not, offer to call back and ask what time works

### Discovery (2–4 minutes)
Ask open-ended questions naturally — do NOT rapid-fire them like a script. Weave them into real conversation.

Good discovery questions to work in:
- "Tell me a little bit about the property — how long have you owned it?"
- "What's the condition like? Any updates or anything that needs attention?"
- "What's prompting the sale at this point?" ← most important — uncover real motivation
- "Do you have a number in mind you'd need to walk away happy?"
- "Is there a timeline you're working with, or are you flexible?"
- "Is it just you making the decision, or is anyone else involved?"

### Qualifying
We are most interested in sellers who:
- Need to sell quickly (job loss, divorce, inheritance, downsizing, relocation, behind on payments)
- Have a property that needs work (we buy as-is)
- Are open to a cash offer below retail
- Are the sole or primary decision-maker

### Voicemail
If you reach voicemail or an answering machine:
- Leave a brief, friendly message
- Say: "Hi ${sellerName}, this is Alex with Quick Cash Home Buyers. I was calling about your property at ${propertyAddress || 'your address'}. If you get a chance, give me a call back at (704) 471-3920. Thanks, have a great day!"
- Keep it under 20 seconds
- Sound warm and unhurried, not salesy

### Handling Common Objections
- **"I'm already listed with an agent"** → "No problem at all — we can still take a look. Sometimes sellers appreciate having a backup cash offer in case the listing doesn't pan out. Would it be okay if I put together a no-obligation offer?"
- **"I want full retail price"** → "That's totally fair. I'll be straight with you — as investors, we typically buy houses for around 60 to 70 cents on the dollar. The tradeoff is we handle everything, pay all closing costs, and can close on your timeline. Sometimes that works for people, sometimes it doesn't. If you'd get more listing it, I'd tell you that honestly. Would you be open to at least seeing what the numbers look like?"
- **"I'm not ready to sell yet"** → "No rush at all. When do you think you might be looking at your options? I can make a note and circle back when the timing is better."
- **"How did you get my number?"** → "We came across your property through our lead network — we're always looking for properties in the area. I hope the call isn't too intrusive."
- **"I need to talk to my spouse/partner"** → "Of course, that makes total sense. When would be a good time to reconnect with both of you?"

### Closing the Conversation
If the seller seems interested:
- Let them know you'll have someone from the team follow up with a formal offer or next steps
- Confirm the best number and time to reach them
- Thank them genuinely

If not interested:
- Thank them for their time, wish them well, and end professionally
- Do NOT push after a clear "no"

## RULES
- Keep it conversational — never robotic or scripted-sounding
- Match the seller's energy — if they're chatty, be chatty; if they're brief, be efficient
- Never lie or make promises about offer amounts you can't guarantee
- Never pressure or use high-sales tactics
- If the seller is clearly upset, rude, or in distress, be empathetic and offer to call back later
- Keep the call under 8 minutes unless the seller is very engaged
- If someone other than ${sellerName} answers, politely ask for them and briefly explain why you're calling
- Never say "we buy as-is" or "we buy in any condition" — instead say condition doesn't scare you off, you just want to understand the situation
- Never promise no fees, no commissions, or specific deal terms
- Never promise you will buy the property
- Never promise a specific closing timeline
- You're ONLY gathering info — all offers and terms come from the team later

## AFTER THE CALL
You will be asked to summarize key findings. Be ready to report:
- Did you reach ${sellerName}? (yes / no / left voicemail)
- Condition of property (as described by seller)
- Asking price mentioned
- Motivation / reason for selling
- Timeline
- Level of interest (hot / warm / cold / not interested)
- Any next steps agreed upon
`;
  }

  private buildFirstMessage(lead: LeadContext): string {
    const firstName = lead.sellerFirstName || 'there';
    const address = lead.propertyAddress
      ? ` about the property at ${lead.propertyAddress}`
      : '';

    return `Hi ${firstName}! This is Alex calling from Quick Cash Home Buyers. I'm reaching out${address} — I just wanted to ask a few quick questions to learn a bit more about the property. Do you have just a couple minutes?`;
  }

  async createOutboundCall(customerPhone: string, lead: LeadContext) {
    const phoneNumberId = this.config.get<string>('VAPI_PHONE_NUMBER_ID');
    if (!phoneNumberId) {
      throw new Error('VAPI_PHONE_NUMBER_ID not configured');
    }

    const customerName = [lead.sellerFirstName, lead.sellerLastName]
      .filter(Boolean)
      .join(' ');

    const result = await this.client.calls.create({
      phoneNumberId,
      customer: {
        number: customerPhone,
        ...(customerName ? { name: customerName } : {}),
      },
      assistant: {
        name: 'Alex - Quick Cash Home Buyers Acquisitions',
        server: {
          url: this.config.get<string>('VAPI_WEBHOOK_URL') ||
            'https://api.mydealcore.com/calls/vapi-webhook',
        },
        model: {
          provider: 'openai',
          model: 'gpt-4o-mini',
          temperature: 0.7,
          messages: [
            {
              role: 'system',
              content: this.buildSystemPrompt(lead),
            },
          ],
          // Reduce response latency
          maxTokens: 150,
        },
        voice: {
          provider: '11labs',
          voiceId: 'Bwff1jnzl1s94AEcntUq',
        },

        firstMessage: this.buildFirstMessage(lead),
        firstMessageMode: 'assistant-speaks-first',
        endCallMessage: "Thanks so much for your time today. Have a wonderful day!",
        endCallPhrases: [
          'goodbye',
          'have a good day',
          'take care',
          'not interested',
          'remove me from your list',
          'do not call again',
        ],
        backgroundSound: 'off',
        maxDurationSeconds: 600, // 10 min hard cap
        analysisPlan: {
          summaryPlan: {
            enabled: true,
            messages: [
              {
                role: 'system',
                content: `You are an expert real estate acquisitions call analyst. Summarize this call in bullet points covering:
1. Did we reach the intended seller? (yes / no / voicemail)
2. Property condition (as described by seller)
3. Asking price mentioned (if any)
4. Motivation / reason for selling
5. Timeline to sell
6. Decision-maker confirmed?
7. Level of interest: hot / warm / cold / not interested
8. Agreed next steps (if any)
Be concise and factual.`,
              },
              {
                role: 'user',
                content: 'Here is the transcript:\n\n{{transcript}}\n\nEnded reason: {{endedReason}}',
              },
            ],
          },
          structuredDataPlan: {
            enabled: true,
            schema: {
              type: 'object',
              properties: {
                reachedSeller: { type: 'boolean', description: 'True if we actually spoke with the intended seller' },
                leftVoicemail: { type: 'boolean', description: 'True if we left a voicemail' },
                // Challenge — property condition
                conditionLevel: {
                  type: 'string',
                  enum: ['excellent', 'good', 'fair', 'poor', 'distressed'],
                  description: 'Overall property condition based on what the seller described. excellent=like new/fully updated, good=well maintained minor issues, fair=functional but needs some work, poor=significant repairs needed, distressed=major issues/uninhabitable',
                },
                conditionNotes: { type: 'string', description: 'Specific condition details mentioned by the seller (e.g. new roof, HVAC, water heater leak)' },
                // Money
                askingPriceMentioned: { type: 'number', description: 'Dollar amount the seller mentioned as their asking or target price' },
                priceFlexible: { type: 'boolean', description: 'Whether the seller indicated flexibility on price' },
                // Priority / motivation
                motivationSummary: { type: 'string', description: 'Why the seller wants to sell (e.g. divorce, relocation, financial hardship, downsizing)' },
                timelineDays: { type: 'number', description: 'How many days until the seller wants to close. Use 7 for "ASAP / as fast as possible / immediately", 14 for "two weeks", 30 for "about a month", 60 for "a couple months", 90 for "a few months", 180 for "not urgent / flexible". Always provide a number — never leave null.' },
                // Authority
                isDecisionMaker: { type: 'boolean', description: 'True ONLY if the seller explicitly confirmed they are the SOLE owner and no one else is on the title or needs to agree. False if they mention a spouse, partner, co-owner, heir, or anyone else involved — even if they say they are willing to move forward or their partner is agreeable. When in doubt, use false.' },
                otherDecisionMakers: { type: 'string', description: 'Who else is involved in ownership or the decision (e.g. spouse, co-owner, heir, attorney). Fill this in whenever isDecisionMaker is false.' },
                // Outcome
                interestLevel: { type: 'string', enum: ['hot', 'warm', 'cold', 'not_interested'], description: 'hot=very motivated, wants to move fast; warm=interested but not urgent; cold=exploring options; not_interested=declined' },
                nextSteps: { type: 'string', description: 'Any specific next steps agreed upon during the call' },
              },
            },
          },
          successEvaluationPlan: {
            enabled: true,
            rubric: 'PassFail',
            messages: [
              {
                role: 'system',
                content: 'A successful call means we either (1) reached the seller and gathered at least motivation + timeline, or (2) left a voicemail. Answer with true or false only.',
              },
              {
                role: 'user',
                content: 'Transcript:\n\n{{transcript}}\n\nEnded reason: {{endedReason}}',
              },
            ],
          },
        },
      },
    });

    const call = result as { id: string; status?: string };
    this.logger.log(`Outbound call created: ${call.id} → ${customerPhone}`);
    return call;
  }
}

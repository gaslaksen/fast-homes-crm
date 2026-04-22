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
    const sellerFirstName = lead.sellerFirstName || 'the seller';
    const propertyAddress = lead.propertyAddress || 'their property';
    const location = [lead.propertyCity, lead.propertyState].filter(Boolean).join(', ');
    const locationSuffix = location ? ` in ${location}` : '';

    const propertyType = lead.propertyType || 'unknown';
    const bedrooms = lead.bedrooms != null ? String(lead.bedrooms) : 'unknown';
    const bathrooms = lead.bathrooms != null ? String(lead.bathrooms) : 'unknown';
    const sqft = lead.sqft != null ? lead.sqft.toLocaleString() : 'unknown';
    const askingPrice = lead.askingPrice != null ? `$${lead.askingPrice.toLocaleString()}` : 'unknown';
    const timelineDays = lead.timeline != null ? String(lead.timeline) : 'unknown';
    const conditionLevel = lead.conditionLevel || 'unknown';
    const motivationNotes = lead.notes || 'unknown';

    return `IDENTITY
You are Riley, a professional acquisition specialist for QuickCashHomeBuyers. You're calling ${sellerFirstName} about their property at ${propertyAddress}${locationSuffix}. They previously expressed interest in a cash offer — you're following up to learn more about their situation so our team can put together a real number. You are direct, confident, and respectful. You speak naturally, like a real person, not a script reader.

WHO WE ARE
QuickCashHomeBuyers buys properties directly from homeowners for cash. No agents, no commissions, no fees to the seller. We work with sellers in all kinds of situations including inherited properties, pre-foreclosure, divorce, landlord exits, and homes needing repairs. We close fast, cover all closing costs, and keep the process simple. As investors we typically buy houses for around 60 to 70 cents on the dollar — the tradeoff is we handle everything, pay all closing costs, and close on the seller's timeline.

PROPERTY ON FILE
You already have the following on file for this property:
- Type: ${propertyType}
- Bedrooms: ${bedrooms}
- Bathrooms: ${bathrooms}
- Square footage: ${sqft}
- Asking price: ${askingPrice}
- Timeline: ${timelineDays} days
- Condition: ${conditionLevel}
- Motivation notes: ${motivationNotes}

Use these details to confirm rather than ask cold. If any value above shows as "unknown", ask for it naturally during the conversation without drawing attention to the gap.

If asking price is "unknown", do not mention price on file — ask naturally: "Do you have a number in mind you'd need to walk away happy?"
If condition is "unknown", ask: "Can you tell me about the condition of the property?"
If bedrooms, bathrooms, or square footage show as "unknown", you must ask before ending the call.

YOUR GOAL
Have a warm, natural conversation to build rapport and gather the four key things we need to evaluate the deal: Condition, Asking Price, Motivation, and Timeline. Motivation is the most important — always uncover the real reason they need to sell. You are not making offers on the call. By the end of the conversation your team should have a clear picture of their situation to follow up with a cash offer.

HARD RULE — NEVER BREAK CHARACTER
You are Riley, a real person. Never an AI, never a bot. Do not acknowledge mistakes or reflect on the conversation. If you missed something, ask for it naturally without drawing attention to the gap.
Instead of: "I apologize, I should have asked about repairs..."
Say: "Actually before I let you go, can you tell me about the condition of the property?"

HARD RULE — NEVER SELF REFLECT
Do not analyze your own responses or summarize what you should have done differently. Stay present, stay in character, keep moving forward.

HARD RULE — CONFIRM BEFORE ENDING
Before closing the call, you must confirm or collect bedrooms, bathrooms, square footage, and condition. If any of these show as "unknown" on file, you must ask before hanging up.

HARD RULE — ALWAYS REQUEST PHOTOS BEFORE ENDING
Never end the call without requesting photos. Always specify what's needed: interior, exterior, kitchen, bathrooms, and any damaged areas. Always confirm how they will send them. Tell them they can text photos to 704-471-3920. Say the number slow and clearly. If they hesitate, say: "That just helps us give you something accurate instead of guessing."

OPENING
Confirm you are speaking with ${sellerFirstName}. Introduce yourself as Riley from QuickCashHomeBuyers. Reference their property at ${propertyAddress} briefly. Ask if now is a good time — if not, offer to call back and ask what time works. Build a bit of rapport before diving into questions.

QUALIFYING QUESTIONS — ASK IN THIS ORDER
One question at a time. Never stack multiple questions back to back. Weave them into real conversation, not a script.
1. "Tell me about the condition — any repairs needed or anything major going on with it?" — reference condition on file if already known, to confirm
2. "What's driving the decision to sell right now?" — this is the most important question, uncover real motivation
3. "How soon are you looking to make something happen?" — reference timeline on file if already known, to confirm
4. "Do you have a number in mind you'd need to walk away happy?" — only ask if asking price shows as "unknown"
5. "Is it just you making the decision, or is anyone else involved?"

If the seller mentions inheritance, foreclosure, divorce, or being a landlord, acknowledge it briefly with empathy before moving on.

OBJECTION HANDLING

"I'm not ready yet / just looking into options"
"No pressure at all. All I need is some basic info so when you're ready, we can move fast. Would that be okay?"

"I'm already working with an agent"
"That's fine. We can still take a look — sometimes sellers appreciate having a backup cash offer in case the listing doesn't pan out. Would it be okay if I put together a no-obligation offer?"

"I want full retail price"
"That's fair. I'll be straight with you — as investors we typically buy houses for around 60 to 70 cents on the dollar. The tradeoff is we handle everything, pay all closing costs, and close on your timeline. If you'd get more listing it, I'd tell you that honestly. Would you be open to at least seeing what the numbers look like?"

"I don't want to give out my information"
"I get that. The only reason I ask is so our team can put together a real number for you. No obligation and we don't share your info with anyone."

"How did you get my number?"
"We came across your property through our lead network — we're always looking for properties in the area. If you'd prefer not to be contacted I can remove you right now."

"I want to think about it"
"Take all the time you need. Can I grab a couple of quick details now so our team is ready when you are? No commitment on your end."

"Why wouldn't I just list with an agent?"
"Listing works great for some people. Where we're different — no showings, no repairs, no waiting on financing, and no commissions at closing. We cover all closing costs and move on your timeline. Just want to make sure you have both options in front of you."

"I need to talk to my spouse or partner"
"Of course, that makes total sense. When would be a good time to reconnect with both of you?"

IF THEY ASK FOR A NUMBER OR OFFER
"I can't give you an accurate number right now — our team needs to review the details first to make sure the offer is fair and not just a guess. We close within 60 days and cover all closing costs. You'll hear back with a real number soon."
If they push: "I'd rather give you a real number than throw out something that doesn't reflect what we'd actually pay. Our team is fast and you'll hear back soon."

ANGRY OR EMOTIONAL SELLERS
Lower your pace. Acknowledge before moving on. Never dismiss what they're going through. If hostile, stay calm: "I understand this is a tough time. I'm here to help if you'd like."
If they ask to be removed: "I'll take care of that right now. Sorry for the interruption."

Situation acknowledgments:
- Inherited property: "I'm sorry for your loss. I know this can be a lot to deal with on top of everything else."
- Pre-foreclosure: "That's a stressful spot to be in. We've helped a lot of people in similar situations and we can move quickly."
- Divorce: "I understand this is a difficult time. We'll make this part as simple and fast as possible."
- Landlord exit: "That makes sense. We make it clean and simple."

VOICEMAILS
"Hey, this is Riley with QuickCashHomeBuyers calling about the property at ${propertyAddress}. Give us a call back at 704-471-3920 or we'll try you again soon. Have a great day."
Keep it under 20 seconds. No personal details beyond the property address.

CLOSING A SUCCESSFUL CALL
"I have everything I need to pass along to our team. Someone will be reaching out within 24 hours with a cash offer. Also, if you can send over some photos of the property that would really help — interior, exterior, kitchen, bathrooms, and any areas that need work. You can text them to us at 704-471-3920. I'll say that again slowly — 704-471-3920. Is there anything else you want us to know before I let you go?"

HARD RULES
- Never quote a price or offer amount
- Never promise a closing date shorter than 60 days
- Never promise you will buy the property
- Never ask more than one question at a time
- Never use filler affirmations like "Absolutely!" "Great!" or "Of course!"
- Never sound robotic or like you are reading from a list
- Never use industry jargon like "ARV," "comps," or "investor terms" with the seller
- Never sound desperate to buy the property
- Never sound like you need the deal
- Never talk over objections
- Never over-explain
- Never assume anything about the property
- Never end the call without requesting photos
- Never end the call without confirming beds, baths, sqft, and condition
- Always keep sentences short, clear, and conversational
- Always remove someone from the list if they ask and confirm it out loud
- Always position yourself as gathering information to give accurate options
- Always frame the process as reviewing everything before giving numbers
- Always speak in terms of options rather than a single outcome
- Always give the text number as 704-471-3920 and say it slow and clearly
- Always confirm how the seller will send photos before ending the call
`;
  }

  private buildFirstMessage(lead: LeadContext): string {
    const firstName = lead.sellerFirstName || 'there';
    const address = lead.propertyAddress
      ? ` about the property at ${lead.propertyAddress}`
      : '';

    return `Hi, is this ${firstName}? This is Riley with QuickCashHomeBuyers — I'm calling${address}. Do you have a couple minutes?`;
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
        name: 'Riley - QuickCashHomeBuyers',
        server: {
          url: this.config.get<string>('VAPI_WEBHOOK_URL') ||
            'https://api.mydealcore.com/calls/vapi-webhook',
        },
        // Cast: SDK 0.11 types don't yet include claude-sonnet-4-6; Vapi API accepts it.
        model: {
          provider: 'anthropic',
          model: 'claude-sonnet-4-6' as any,
          temperature: 0.7,
          messages: [
            {
              role: 'system',
              content: this.buildSystemPrompt(lead),
            },
          ],
          maxTokens: 150,
        },
        // Cast: SDK 0.11 types don't yet include the Clara voice preset.
        voice: {
          provider: 'vapi',
          voiceId: 'Clara' as any,
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

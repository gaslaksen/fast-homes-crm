import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { VapiClient } from '@vapi-ai/server-sdk';

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

  async createOutboundCall(customerPhone: string, customerName?: string) {
    const phoneNumberId = this.config.get<string>('VAPI_PHONE_NUMBER_ID');
    if (!phoneNumberId) {
      throw new Error('VAPI_PHONE_NUMBER_ID not configured');
    }

    const result = await this.client.calls.create({
      phoneNumberId,
      customer: {
        number: customerPhone,
        ...(customerName ? { name: customerName } : {}),
      },
      assistant: {
        model: {
          provider: 'openai',
          model: 'gpt-4o-mini',
          messages: [
            {
              role: 'system',
              content: `You are a friendly real estate assistant calling on behalf of Fast Homes. Your goal is to have a brief, natural conversation with the property owner to understand their situation and see if we can help. Be warm, professional, and conversational. Key things to discover: their timeline for selling, the property's condition, their asking price expectations, and whether they are the decision-maker. Do NOT be pushy. If they are not interested, thank them and end the call politely.`,
            },
          ],
        },
        voice: {
          provider: '11labs',
          voiceId: 'paula',
        },
        firstMessage:
          "Hi there! This is an assistant calling from Fast Homes. We received some information about your property and I'd love to have a quick chat if you have a moment. Is now a good time?",
      },
    });

    // SDK returns Call | CallBatchResponse; single calls return Call
    const call = result as { id: string; status?: string };
    this.logger.log(`Outbound call created: ${call.id} → ${customerPhone}`);
    return call;
  }
}

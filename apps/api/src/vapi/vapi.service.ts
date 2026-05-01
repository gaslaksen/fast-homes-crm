import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { VapiClient } from '@vapi-ai/server-sdk';

/**
 * UUID of the saved Vapi assistant ("Grace") that holds the system prompt,
 * voice config, voicemail detection, and analysis plan. Edit prompt/voice
 * settings in the Vapi dashboard rather than this file.
 *
 * Override via VAPI_ASSISTANT_ID env var (e.g. for staging vs. prod).
 */
const DEFAULT_ASSISTANT_ID = '7059279c-a47d-4216-803c-962597fbe0c3';

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

  /**
   * Expand common US street/directional abbreviations so TTS reads
   * "123 Oak Ct" as "123 Oak Court" rather than "see-tee" or clipping.
   * Word-boundary matching avoids touching street names like "Stewart".
   */
  private expandAddressForSpeech(address: string | undefined): string | undefined {
    if (!address) return address;
    const map: Record<string, string> = {
      St: 'Street', Ave: 'Avenue', Blvd: 'Boulevard', Rd: 'Road', Dr: 'Drive',
      Ct: 'Court', Ln: 'Lane', Pl: 'Place', Pkwy: 'Parkway', Hwy: 'Highway',
      Cir: 'Circle', Ter: 'Terrace', Trl: 'Trail', Sq: 'Square', Cv: 'Cove',
      Xing: 'Crossing', Pt: 'Point', Aly: 'Alley', Plz: 'Plaza', Mnr: 'Manor',
      Mdw: 'Meadow', Rdg: 'Ridge', Grv: 'Grove', Hts: 'Heights',
      // Directionals — only as standalone tokens (handled by \b)
      N: 'North', S: 'South', E: 'East', W: 'West',
      NE: 'Northeast', NW: 'Northwest', SE: 'Southeast', SW: 'Southwest',
    };
    let out = address;
    for (const [abbr, full] of Object.entries(map)) {
      // Match the abbreviation as a whole word, optionally followed by a period.
      const re = new RegExp(`\\b${abbr}\\b\\.?`, 'gi');
      out = out.replace(re, full);
    }
    return out;
  }

  /**
   * Build the variableValues map sent to Vapi as assistantOverrides.
   *
   * Every key here MUST match a `{{key}}` placeholder in the Grace assistant's
   * system prompt, first message, or voicemail message in the Vapi dashboard.
   * Adding a new {{placeholder}} in the dashboard without populating it here
   * will cause Vapi to render the literal "{{key}}" text aloud.
   */
  private buildVariableValues(lead: LeadContext): Record<string, string> {
    const expandedAddress = this.expandAddressForSpeech(lead.propertyAddress);
    const location = [lead.propertyCity, lead.propertyState].filter(Boolean).join(', ');

    return {
      // Greeting / persona context
      sellerFirstName: lead.sellerFirstName ?? 'there',
      // Use in the system prompt body (e.g. "calling about their property at {{propertyAddress}}")
      propertyAddress: expandedAddress ?? 'their property',
      // Use in the first message / voicemail (e.g. "calling about {{propertyAddressForGreeting}}")
      propertyAddressForGreeting: expandedAddress ?? 'your property',
      // " in City, State" or empty — append directly after propertyAddress in the prompt
      locationSuffix: location ? ` in ${location}` : '',

      // Property facts on file
      propertyType: lead.propertyType ?? 'unknown',
      bedrooms: lead.bedrooms != null ? String(lead.bedrooms) : 'unknown',
      bathrooms: lead.bathrooms != null ? String(lead.bathrooms) : 'unknown',
      sqft: lead.sqft != null ? lead.sqft.toLocaleString() : 'unknown',
      askingPrice: lead.askingPrice != null ? `$${lead.askingPrice.toLocaleString()}` : 'unknown',
      timelineDays: lead.timeline != null ? String(lead.timeline) : 'unknown',
      conditionLevel: lead.conditionLevel ?? 'unknown',
      motivationNotes: lead.notes ?? 'unknown',
    };
  }

  async createOutboundCall(customerPhone: string, lead: LeadContext) {
    const phoneNumberId = this.config.get<string>('VAPI_PHONE_NUMBER_ID');
    if (!phoneNumberId) {
      throw new Error('VAPI_PHONE_NUMBER_ID not configured');
    }

    const assistantId = this.config.get<string>('VAPI_ASSISTANT_ID') ?? DEFAULT_ASSISTANT_ID;

    const customerName = [lead.sellerFirstName, lead.sellerLastName]
      .filter(Boolean)
      .join(' ');

    const result = await this.client.calls.create({
      phoneNumberId,
      customer: {
        number: customerPhone,
        ...(customerName ? { name: customerName } : {}),
      },
      assistantId,
      assistantOverrides: {
        variableValues: this.buildVariableValues(lead),
      },
    });

    const call = result as { id: string; status?: string };
    this.logger.log(`Outbound call created: ${call.id} → ${customerPhone}`);
    return call;
  }
}

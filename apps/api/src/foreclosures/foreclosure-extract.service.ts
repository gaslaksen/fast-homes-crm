import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Anthropic from '@anthropic-ai/sdk';

/** Structured fields extracted from a foreclosure notice / eCourts filing. */
export interface ExtractedNotice {
  noticeType?: string;
  propertyAddress?: string;
  city?: string;
  state?: string;
  zip?: string;
  ownerNames?: string;
  caseNumber?: string;
  saleDate?: string;
  hearingDate?: string;
  trustee?: string;
  loanDate?: string;
  loanAmount?: number | null;
  county?: string;
}

@Injectable()
export class ForeclosureExtractService {
  private readonly logger = new Logger(ForeclosureExtractService.name);
  private anthropic: Anthropic | null = null;

  constructor(private config: ConfigService) {
    const apiKey = this.config.get<string>('ANTHROPIC_API_KEY');
    if (apiKey) {
      this.anthropic = new Anthropic({ apiKey });
    } else {
      this.logger.warn('ANTHROPIC_API_KEY not set - foreclosure notice extraction disabled');
    }
  }

  get isConfigured(): boolean {
    return !!this.anthropic;
  }

  /**
   * Extract structured notice fields from raw notice/PDF text. Returns {} when
   * AI is unavailable or parsing fails so callers can fall back gracefully.
   */
  async extractFromText(text: string): Promise<ExtractedNotice> {
    if (!this.anthropic || !text?.trim()) return {};

    // Cap the text so we do not blow the context on a long multi-exhibit PDF;
    // the first pages carry the address, owner, case number, and dates.
    const snippet = text.slice(0, 12000);

    const prompt = [
      'Extract foreclosure notice fields from the text below. The text may be noisy OCR.',
      'Record the property OWNER(S) (the person the property is titled to), NOT the bank,',
      'trustee, HOA, or attorney. For a Notice of Hearing Prior to Foreclosure use',
      'notice_type "pre_foreclosure_hearing" and put the hearing date in hearing_date.',
      '',
      'Return ONLY a JSON object with these keys (use null when a field is absent):',
      '{',
      '  "notice_type": "mortgage_foreclosure|hoa_lien|tax_foreclosure|sheriff_sale|pre_foreclosure_hearing",',
      '  "property_address": string, "city": string, "state": string, "zip": string,',
      '  "owner_names": string, "case_number": string,',
      '  "sale_date": "YYYY-MM-DD", "hearing_date": "YYYY-MM-DD",',
      '  "trustee": string, "loan_date": "YYYY-MM-DD", "loan_amount": number, "county": string',
      '}',
      '',
      'TEXT:',
      snippet,
    ].join('\n');

    try {
      const response = await this.anthropic.messages.create({
        model: 'claude-haiku-4-5',
        max_tokens: 700,
        system:
          'You extract structured data from North Carolina foreclosure public notices and eCourts filings. Always respond with valid JSON only. No markdown, no explanation.',
        messages: [{ role: 'user', content: prompt }],
      });

      const content = (response.content[0] as any)?.text?.trim();
      if (!content) return {};
      const cleaned = content.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
      const raw = JSON.parse(cleaned);

      return {
        noticeType: raw.notice_type || undefined,
        propertyAddress: raw.property_address || undefined,
        city: raw.city || undefined,
        state: raw.state || undefined,
        zip: raw.zip ? String(raw.zip) : undefined,
        ownerNames: raw.owner_names || undefined,
        caseNumber: raw.case_number || undefined,
        saleDate: raw.sale_date || undefined,
        hearingDate: raw.hearing_date || undefined,
        trustee: raw.trustee || undefined,
        loanDate: raw.loan_date || undefined,
        loanAmount: typeof raw.loan_amount === 'number' ? raw.loan_amount : null,
        county: raw.county || undefined,
      };
    } catch (error: any) {
      this.logger.error(`Foreclosure notice extraction failed: ${error.message}`);
      return {};
    }
  }
}

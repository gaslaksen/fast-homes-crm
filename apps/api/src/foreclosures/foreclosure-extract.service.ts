import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Anthropic from '@anthropic-ai/sdk';
import {
  FILING_FIELDS,
  FILING_JSON_SCHEMA,
  FILING_SYSTEM_PROMPT,
  EXTRACTION_VERSION,
  FilingField,
} from './foreclosure-filing.schema';

/** One extracted field: the value as printed, plus the model's 0-1 confidence. */
export interface ExtractedField<T = string | string[] | number | null> {
  value: T | null;
  confidence: number;
}

/** All 26 model-facing fields, keyed by their snake_case schema name. */
export type ExtractedFiling = Record<FilingField, ExtractedField>;

export interface FilingExtractionResult {
  fields: ExtractedFiling;
  extractionVersion: number;
  usage: { inputTokens: number; outputTokens: number; costUsd: number };
}

/** Haiku 4.5 list price, for the per-document cost log. */
const INPUT_USD_PER_MTOK = 1;
const OUTPUT_USD_PER_MTOK = 5;

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

    // Cap the text so we do not blow the context on a long multi-exhibit PDF.
    // Sampled Mecklenburg filings run 12-13k characters and all three clipped
    // at the old 12k limit; on the ALAW template the trustee firm address and
    // phone sat 75 characters from the cut. 20k clears a full filing for about
    // 2k extra input tokens, roughly $0.002 per document.
    const snippet = text.slice(0, 20000);

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

  /**
   * Pull the full structured filing out of a document's raw text.
   *
   * Uses structured outputs (output_config.format), so the response is
   * guaranteed to match the schema rather than merely asked to. Temperature 0
   * for repeatability. Returns null when AI is unavailable or the call fails,
   * so the caller can fall back to the 13-field path.
   */
  async extractFiling(text: string): Promise<FilingExtractionResult | null> {
    if (!this.anthropic || !text?.trim()) return null;

    // Sampled filings run 12-13k characters; 20k clears a full one with room
    // for the longer multi-exhibit bundles without paying for empty context.
    const snippet = text.slice(0, 20000);

    try {
      const response = await this.anthropic.messages.create({
        model: 'claude-haiku-4-5',
        max_tokens: 4000,
        temperature: 0,
        system: FILING_SYSTEM_PROMPT,
        output_config: { format: { type: 'json_schema', schema: FILING_JSON_SCHEMA as any } },
        messages: [{ role: 'user', content: `FILING TEXT:\n\n${snippet}` }],
      });

      const content = (response.content[0] as any)?.text?.trim();
      if (!content) return null;
      const raw = JSON.parse(content);

      const inputTokens = response.usage?.input_tokens ?? 0;
      const outputTokens = response.usage?.output_tokens ?? 0;
      const costUsd =
        (inputTokens / 1e6) * INPUT_USD_PER_MTOK + (outputTokens / 1e6) * OUTPUT_USD_PER_MTOK;
      this.logger.log(
        `Filing extraction: ${inputTokens} in / ${outputTokens} out, $${costUsd.toFixed(4)}`,
      );

      return {
        fields: normalizeExtractedFiling(raw),
        extractionVersion: EXTRACTION_VERSION,
        usage: { inputTokens, outputTokens, costUsd },
      };
    } catch (error: any) {
      this.logger.error(`Filing extraction failed: ${error.message}`);
      return null;
    }
  }
}

/**
 * Coerce the model's response into a complete, well-typed field set.
 *
 * Structured outputs guarantee the shape but not the ranges: confidence is
 * declared as a plain number because the API rejects `minimum`/`maximum` in a
 * schema, so it is clamped here. Blank strings and empty arrays become null so
 * that "absent" has exactly one representation downstream.
 */
export function normalizeExtractedFiling(raw: any): ExtractedFiling {
  const out = {} as ExtractedFiling;
  const scores = raw?.field_confidence ?? {};

  for (const field of FILING_FIELDS) {
    // Accept both the wire shape (flat value + sibling field_confidence) and
    // an already-paired {value, confidence}, so tests and any future paired
    // response both parse.
    const entry = raw?.[field];
    const paired = entry !== null && typeof entry === 'object' && !Array.isArray(entry) && 'value' in entry;
    let value = paired ? entry.value ?? null : entry ?? null;

    if (typeof value === 'string') {
      value = value.trim() || null;
    } else if (Array.isArray(value)) {
      const cleaned = value.map((v) => String(v ?? '').trim()).filter(Boolean);
      value = cleaned.length ? cleaned : null;
    } else if (typeof value === 'number') {
      value = Number.isFinite(value) ? value : null;
    } else if (value !== null && value !== undefined) {
      value = null;
    }

    const rawConfidence = Number(paired ? entry.confidence : scores[field]);
    // A value with no usable score is treated as unscored, not as certain.
    let confidence = Number.isFinite(rawConfidence) ? Math.min(1, Math.max(0, rawConfidence)) : 0;
    // The prompt asks for 0 on every null; enforce it rather than trusting it.
    if (value === null) confidence = 0;

    out[field] = { value, confidence };
  }

  return out;
}

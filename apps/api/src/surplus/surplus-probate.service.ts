import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Anthropic from '@anthropic-ai/sdk';

/**
 * Reads a Florida probate filing and returns the people who inherited.
 *
 * ── Why a document and not a lookup ────────────────────────────────────────
 *
 * The heirs of a dead claimant are recorded in one place: the probate file at
 * the clerk of court. Duval publishes that through CORE, whose public search
 * sits behind a Google reCAPTCHA and a click-through user agreement, with the
 * clerk's own page citing Florida Supreme Court order AOSC24-65 as the reason.
 * That is a policy wall, not a technical one, so nothing here fetches from it.
 *
 * The Official Records index at or.duvalclerk.com is captcha-free and was
 * checked as an alternative. It does not carry these documents: a live search
 * for ALFRED SPENCER returns 42 recorded instruments and a search for LEILA
 * SPENCER returns 4, and the 2025 petition for summary administration is in
 * neither. Petitions and orders are COURT records, not recorded instruments, so
 * they never reach that index at all.
 *
 * So the person finds the case and downloads the filing, and this reads it. The
 * judgement about which case belongs to which claimant stays human, which is
 * where it belongs: deciding that the ALFRED SPENCER who died in 2021 is the
 * one who lost 1624 W 35th St is an identification, not a lookup.
 *
 * ── Why the answer is never saved directly ─────────────────────────────────
 *
 * Every heir this returns is shown for confirmation before anything is written.
 * A wrong heir is worse than no heir: it is a stranger being told they have
 * money coming, and then skip traced at an address that is not theirs.
 */

export interface ExtractedHeir {
  name: string;
  relationship: string | null;
  share: string | null;
  street: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  deceased: boolean;
  dateOfDeath: string | null;
}

export interface ProbateExtract {
  /** Who died. Matched against the claimant by the person confirming. */
  decedent: string | null;
  dateOfDeath: string | null;
  caseNumber: string | null;
  /** The address the filing says the estate is about, for a sanity check. */
  propertyAddress: string | null;
  /** Parcel as printed. NOT trusted, see the note in the prompt. */
  parcelId: string | null;
  heirs: ExtractedHeir[];
  /** Anything the reader should know before trusting the rest. */
  warnings: string[];
}

const MAX_PDF_BYTES = 12 * 1024 * 1024;

const PROMPT = `You are reading a Florida probate court filing: a petition for
summary administration, a petition to determine homestead, an order of summary
administration, or similar.

Return a single JSON object, no prose, no code fence:

{
  "decedent": "the deceased person's name as printed",
  "dateOfDeath": "the decedent's date of death, YYYY-MM-DD",
  "caseNumber": "the probate case number as printed",
  "propertyAddress": "the property address the filing concerns",
  "parcelId": "the parcel or RE number as printed",
  "heirs": [
    {
      "name": "as printed",
      "relationship": "as printed, e.g. Son, Daughter, Surviving Spouse",
      "share": "the interest as printed, e.g. 50% Remainder Interest, Life Estate",
      "street": "their own street address",
      "city": "...", "state": "XX", "zip": "12345",
      "deceased": true only if this filing says THIS PERSON is deceased,
      "dateOfDeath": "their date of death if given, YYYY-MM-DD, else null"
    }
  ],
  "warnings": ["anything a reader should check before trusting this"]
}

Rules that matter:

- Every person listed as an heir, beneficiary, petitioner or devisee goes in
  "heirs", INCLUDING one the filing marks as deceased. A dead heir is not
  noise: their share needs its own estate opened, and recording them is what
  stops somebody dialling them. Mark them deceased:true.

- Do NOT include attorneys, law firms, the personal representative acting only
  in that capacity, creditors, or the clerk. Only people taking an interest.

- Each heir's address is THEIR OWN, not the decedent's. That is the whole
  reason we are reading this: the tax roll still lists them at the dead owner's
  house. Where a filing gives an heir the decedent's address, use it and add a
  warning saying so.

- "share" and "relationship" are copied verbatim. They decide who can sign: a
  life estate holder cannot sell alone. Never paraphrase or normalise them.

- Use null for anything not printed. Never guess, never infer, never complete a
  partial address from knowledge of the area.

- Add a warning when the property address and the parcel number appear to
  describe different properties. Attorneys copy the wrong parcel into these
  filings and that error has been seen in a real one; the address is the more
  reliable of the two and both should be reported as printed.`;

@Injectable()
export class SurplusProbateService {
  private readonly logger = new Logger(SurplusProbateService.name);
  private readonly anthropic?: Anthropic;

  constructor(private config: ConfigService) {
    const key = this.config.get<string>('ANTHROPIC_API_KEY');
    if (key) this.anthropic = new Anthropic({ apiKey: key });
  }

  get available(): boolean {
    return !!this.anthropic;
  }

  /**
   * Read one filing. Throws with a usable message rather than returning null,
   * because this is a person waiting on an upload they just made, not a
   * background poll that can fall back to something else.
   */
  async readFiling(pdf: Buffer, filename: string): Promise<ProbateExtract> {
    if (!this.available) {
      throw new Error('ANTHROPIC_API_KEY is not set, so filings cannot be read.');
    }
    if (!pdf?.length) throw new Error('That file is empty.');
    if (pdf.length > MAX_PDF_BYTES) {
      throw new Error(
        `That file is ${(pdf.length / 1024 / 1024).toFixed(1)}MB, over the ${MAX_PDF_BYTES / 1024 / 1024}MB limit.`,
      );
    }

    const response = await this.anthropic!.messages.create({
      // Same choice as the surplus notice reader and for the same reason: this
      // runs once per filing and a misread name or street means contacting the
      // wrong person about somebody else's money.
      model: 'claude-opus-5',
      max_tokens: 3000,
      output_config: { effort: 'low' },
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'document',
              source: { type: 'base64', media_type: 'application/pdf', data: pdf.toString('base64') },
            },
            { type: 'text', text: PROMPT },
          ],
        },
      ],
    } as any);

    const text = ((response as any).content || [])
      .filter((b: any) => b.type === 'text')
      .map((b: any) => b.text)
      .join('\n');

    const parsed = this.parse(text);
    this.logger.log(
      `Read ${filename}: decedent ${parsed.decedent || 'unknown'}, ${parsed.heirs.length} heir(s)`,
    );
    return parsed;
  }

  /**
   * Pull the JSON out of the reply and normalise it.
   *
   * Deliberately tolerant of the model wrapping the object in prose, and
   * deliberately strict about what survives: an heir with no name is dropped,
   * because a nameless row cannot be confirmed against the document and cannot
   * be traced.
   */
  parse(raw: string): ProbateExtract {
    const empty: ProbateExtract = {
      decedent: null,
      dateOfDeath: null,
      caseNumber: null,
      propertyAddress: null,
      parcelId: null,
      heirs: [],
      warnings: [],
    };

    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start < 0 || end <= start) {
      throw new Error('The filing could not be read. Is it a probate petition or order?');
    }

    let o: any;
    try {
      o = JSON.parse(raw.slice(start, end + 1));
    } catch {
      throw new Error('The filing could not be read cleanly. Try re-downloading the PDF.');
    }

    const str = (v: any): string | null => {
      const s = String(v ?? '').trim();
      return s && s.toLowerCase() !== 'null' ? s : null;
    };
    const date = (v: any): string | null => {
      const s = str(v);
      return s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
    };

    const heirs: ExtractedHeir[] = (Array.isArray(o.heirs) ? o.heirs : [])
      .map((h: any) => ({
        name: str(h?.name) || '',
        relationship: str(h?.relationship),
        share: str(h?.share),
        street: str(h?.street),
        city: str(h?.city),
        state: (str(h?.state) || '').toUpperCase().slice(0, 2) || null,
        zip: (str(h?.zip) || '').replace(/\D/g, '').slice(0, 5) || null,
        deceased: !!h?.deceased,
        dateOfDeath: date(h?.dateOfDeath),
      }))
      .filter((h: ExtractedHeir) => !!h.name);

    const warnings = (Array.isArray(o.warnings) ? o.warnings : [])
      .map((w: any) => str(w))
      .filter(Boolean) as string[];

    if (!heirs.length) {
      warnings.push('No heirs were found in this filing. Check it is the petition and not a cover sheet or fee schedule.');
    }
    if (heirs.every((h) => h.deceased) && heirs.length) {
      warnings.push('Every heir in this filing is marked deceased, so there is nobody here to contact yet.');
    }

    return {
      ...empty,
      decedent: str(o.decedent),
      dateOfDeath: date(o.dateOfDeath),
      caseNumber: str(o.caseNumber),
      propertyAddress: str(o.propertyAddress),
      parcelId: str(o.parcelId),
      heirs,
      warnings,
    };
  }
}

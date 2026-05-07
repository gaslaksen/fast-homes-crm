import { Injectable, Logger } from '@nestjs/common';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { AiArvCalculationService } from '../ai-arv-calculation.service';
import type { ValuationMode } from '../types/arv-result';

// Score the AI ARV pipeline against geoff's hand-judged values in
// docs/arv-validation-set.md. Pass criterion: AI ARV midpoint within
// ±15% of judged ARV midpoint (or any value inside the judged range).
//
// Per Build Prompt 016, the validation set is incomplete — the harness
// reports per-entry pass/fail and aggregate stats but does NOT block
// builds. The future ship gate (≥10 entries, ≥80% pass rate) is
// documented in the README, not enforced here.

const PASS_PCT = 0.15;

const CANDIDATE_PATHS = [
  // Worktree-relative
  'docs/arv-validation-set.md',
  // From apps/api cwd
  '../../docs/arv-validation-set.md',
  // From repo root
  './docs/arv-validation-set.md',
];

export interface ValidationEntry {
  propertyKey: string; // "Property 001"
  address: string;
  leadId: string | null;
  category: string | null;
  judgedAsIs?: { low: number; high: number } | null;
  judgedRenovated?: { low: number; high: number } | null;
  judgedConfidence?: string | null;
  reasoning: string;
}

export interface ValidationEntryResult {
  entry: ValidationEntry;
  ranMode: ValuationMode | null;
  judgedRange: { low: number; high: number } | null;
  systemArv: number | null;
  systemConfidence: number | null;
  deltaPct: number | null;
  pass: boolean | null;
  notes: string;
}

export interface ValidationReport {
  totalEntries: number;
  evaluable: number;
  passed: number;
  meanAbsPct: number;
  results: ValidationEntryResult[];
}

@Injectable()
export class ArvValidationService {
  private readonly logger = new Logger(ArvValidationService.name);

  constructor(private readonly arv: AiArvCalculationService) {}

  async scoreAgainstValidationSet(opts?: {
    mode?: ValuationMode;
    forceRefresh?: boolean;
  }): Promise<ValidationReport> {
    const filePath = locateValidationFile();
    if (!filePath) {
      this.logger.warn('arv-validation-set.md not found in known locations');
      return emptyReport();
    }
    const md = fs.readFileSync(filePath, 'utf-8');
    const entries = parseValidationFile(md);
    this.logger.log(
      `arv-validation: parsed ${entries.length} entries from ${filePath}`,
    );

    const results: ValidationEntryResult[] = [];
    for (const entry of entries) {
      results.push(await this.evaluateEntry(entry, opts));
    }
    const evaluable = results.filter((r) => r.pass !== null);
    const passed = evaluable.filter((r) => r.pass === true).length;
    const meanAbsPct =
      evaluable.length === 0
        ? 0
        : evaluable.reduce((s, r) => s + Math.abs(r.deltaPct ?? 0), 0) /
          evaluable.length;
    return {
      totalEntries: entries.length,
      evaluable: evaluable.length,
      passed,
      meanAbsPct: Number(meanAbsPct.toFixed(4)),
      results,
    };
  }

  private async evaluateEntry(
    entry: ValidationEntry,
    opts?: { mode?: ValuationMode; forceRefresh?: boolean },
  ): Promise<ValidationEntryResult> {
    if (!entry.leadId) {
      return placeholderResult(entry, 'no leadId in validation entry');
    }
    // Pick the mode: explicit opt-in, else prefer AS_IS if judged, else RENOVATED.
    const mode: ValuationMode =
      opts?.mode ??
      (entry.judgedAsIs ? 'AS_IS' : entry.judgedRenovated ? 'ARV_RENOVATED' : 'ARV_RENOVATED');
    const judged =
      mode === 'AS_IS' ? entry.judgedAsIs : entry.judgedRenovated;
    if (!judged) {
      return placeholderResult(
        entry,
        `no judged ARV for mode ${mode} on ${entry.propertyKey}`,
      );
    }
    try {
      const result = await this.arv.calculate({
        leadId: entry.leadId,
        mode,
        forceRefresh: opts?.forceRefresh,
      });
      const judgedMid = (judged.low + judged.high) / 2;
      const inRange = result.arv >= judged.low && result.arv <= judged.high;
      const deltaPct = (result.arv - judgedMid) / judgedMid;
      const pass = inRange || Math.abs(deltaPct) <= PASS_PCT;
      return {
        entry,
        ranMode: mode,
        judgedRange: judged,
        systemArv: result.arv,
        systemConfidence: result.confidence,
        deltaPct: Number(deltaPct.toFixed(4)),
        pass,
        notes: pass
          ? 'within judged range or ±15% of midpoint'
          : `outside ±15% (${(deltaPct * 100).toFixed(1)}%)`,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return placeholderResult(entry, `calculation failed: ${msg}`);
    }
  }
}

// ── Markdown parsing ───────────────────────────────────────────────────────

export function parseValidationFile(md: string): ValidationEntry[] {
  const entries: ValidationEntry[] = [];
  // Split on "## Property NNN" headers.
  const sections = md.split(/^## (Property \d+)/m);
  // sections[0] is preamble; pairs follow as [propertyKey, body].
  for (let i = 1; i < sections.length; i += 2) {
    const propertyKey = sections[i].trim();
    const body = sections[i + 1] ?? '';
    const entry = parseEntryBody(propertyKey, body);
    if (entry) entries.push(entry);
  }
  return entries;
}

function parseEntryBody(propertyKey: string, body: string): ValidationEntry | null {
  const address = pickField(body, /\*\*Address:\*\*\s*([^\n]+)/);
  if (!address || address.startsWith('[')) return null;
  const leadIdRaw = pickField(body, /\*\*Lead ID in Dealcore:\*\*\s*([^\n]+)/);
  const leadId =
    leadIdRaw && !leadIdRaw.startsWith('[') ? leadIdRaw.trim() : null;
  const category = pickField(body, /\*\*Category:\*\*\s*([^\n]+)/);

  const asIsLine = pickField(body, /\*\*As-is value:\*\*\s*([^\n]+)/);
  const renovatedLine = pickField(body, /\*\*Full-rehab ARV:\*\*\s*([^\n]+)/);
  const confLine = pickField(body, /\*\*Confidence:\*\*\s*([^\n]+)/);

  const reasoningMatch = body.match(/### Reasoning\s+([\s\S]*?)(?=###|$)/);
  const reasoning = reasoningMatch ? reasoningMatch[1].trim() : '';

  return {
    propertyKey,
    address,
    leadId,
    category,
    judgedAsIs: parseRangeFromLine(asIsLine),
    judgedRenovated: parseRangeFromLine(renovatedLine),
    judgedConfidence: confLine,
    reasoning,
  };
}

function pickField(body: string, re: RegExp): string | null {
  const m = body.match(re);
  return m ? m[1].trim() : null;
}

// Parses lines like "~$15,000–18,000", "$45,000-55,000", "$89k-99k", "$218,000".
export function parseRangeFromLine(
  line: string | null,
): { low: number; high: number } | null {
  if (!line) return null;
  const cleaned = line.replace(/[~\(\)]/g, '');
  // Range form: low–high (allowing en-dash, em-dash, hyphen, "to")
  const rangeRe =
    /\$?([\d,\.]+)\s*[kK]?\s*(?:[-–—]|to)\s*\$?([\d,\.]+)\s*[kK]?/;
  const m = cleaned.match(rangeRe);
  if (m) {
    const low = parseAmount(m[1], m[0].toLowerCase().includes('k'));
    const high = parseAmount(m[2], m[0].toLowerCase().includes('k'));
    if (low != null && high != null) {
      return { low, high };
    }
  }
  const singleRe = /\$?([\d,\.]+)\s*[kK]?/;
  const sm = cleaned.match(singleRe);
  if (sm) {
    const v = parseAmount(sm[1], sm[0].toLowerCase().includes('k'));
    if (v != null) {
      return { low: v * 0.95, high: v * 1.05 };
    }
  }
  return null;
}

function parseAmount(raw: string, isK: boolean): number | null {
  const n = Number(raw.replace(/,/g, ''));
  if (!Number.isFinite(n)) return null;
  return isK ? n * 1000 : n;
}

function locateValidationFile(): string | null {
  for (const candidate of CANDIDATE_PATHS) {
    const abs = path.resolve(process.cwd(), candidate);
    if (fs.existsSync(abs)) return abs;
  }
  return null;
}

function emptyReport(): ValidationReport {
  return { totalEntries: 0, evaluable: 0, passed: 0, meanAbsPct: 0, results: [] };
}

function placeholderResult(
  entry: ValidationEntry,
  notes: string,
): ValidationEntryResult {
  return {
    entry,
    ranMode: null,
    judgedRange: null,
    systemArv: null,
    systemConfidence: null,
    deltaPct: null,
    pass: null,
    notes,
  };
}

/**
 * Compare two models on the same Notices of Surplus Funds.
 *
 * Takes a folder of notice files (PDF or TIFF) and two model ids, sends every
 * file through the SAME prompt and page preparation the notice reader uses
 * in production (surplus-notice.service.ts), parses both replies the same
 * way, and prints a field-by-field diff of the parsed JSON: recipients,
 * noticeDate and surplusAtNotice, plus the other fields the reader returns.
 *
 * It NEVER writes to the database. It talks to the Anthropic API only, and it
 * records nothing in vendor_usage: the token usage and the estimated cost of
 * each read are printed instead, so the spend is visible without being
 * metered against the production budget.
 *
 * Usage (from apps/api, with ANTHROPIC_API_KEY in the environment):
 *   npx ts-node scripts/compare-notice-reads.ts <folder> <model-a> <model-b>
 *   npx ts-node scripts/compare-notice-reads.ts ~/notices claude-opus-5 claude-opus-5-5
 *
 * Optional environment: SURPLUS_NOTICE_INPUT_PRICE and
 * SURPLUS_NOTICE_OUTPUT_PRICE price BOTH models' usage (dollars per million
 * tokens) in the summary; they default to the claude-opus-5 list prices, so a
 * cheaper second model will read as costing more than it does. Check the
 * price list.
 *
 * Run it on a VERIFIED set: notices whose addresses a person has already
 * checked, so a disagreement between the two models can be settled by looking
 * at the page rather than by trusting either one. The failure modes to look
 * for are the clerk's letterhead returned as the owner's address, a co-owner
 * page merged or skipped, a street number misread, a foreign address forced
 * into a US shape, and a guessed value where the form was blank.
 */
import * as fs from 'fs';
import * as path from 'path';
import Anthropic from '@anthropic-ai/sdk';
import {
  AnthropicNoticeReaderClient,
  DEFAULT_NOTICE_INPUT_PRICE,
  DEFAULT_NOTICE_OUTPUT_PRICE,
  NOTICE_PROMPT,
  NoticeExtract,
  NoticeReadUsage,
  noticeReadCost,
  parseNoticeReply,
  prepareNoticeContent,
} from '../src/surplus/surplus-notice.service';

const EXTENSIONS = new Set(['.pdf', '.tif', '.tiff']);

/** The fields compared, in the order printed. */
const FIELDS: (keyof NoticeExtract)[] = [
  'recipients',
  'noticeDate',
  'surplusAtNotice',
  'saleDate',
  'certificateNumber',
  'taxDeedNumber',
  'realEstateNumber',
];

interface OneRead {
  model: string;
  extract: NoticeExtract | null;
  text: string;
  usage: NoticeReadUsage;
  cost: number;
  ms: number;
  error?: string;
}

function contentTypeOf(file: string): string {
  return path.extname(file).toLowerCase() === '.pdf' ? 'application/pdf' : 'image/tiff';
}

function price(raw: string | undefined, fallback: number): number {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/** A value as one line, stable across key order, so two equal objects print alike. */
function show(v: unknown): string {
  if (v == null) return 'null';
  if (Array.isArray(v)) return v.length ? v.map((x) => show(x)).join(' | ') : '[]';
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    return Object.keys(o)
      .sort()
      .filter((k) => o[k] != null)
      .map((k) => `${k}=${String(o[k])}`)
      .join(', ');
  }
  return String(v);
}

async function readWith(
  client: AnthropicNoticeReaderClient,
  content: Awaited<ReturnType<typeof prepareNoticeContent>>,
  prices: { input: number; output: number },
): Promise<OneRead> {
  const started = Date.now();
  try {
    const { text, usage } = await client.read(content, NOTICE_PROMPT);
    return {
      model: client.model,
      extract: parseNoticeReply(text),
      text,
      usage,
      cost: noticeReadCost(usage, prices),
      ms: Date.now() - started,
    };
  } catch (e: any) {
    return {
      model: client.model,
      extract: null,
      text: '',
      usage: { inputTokens: 0, outputTokens: 0 },
      cost: 0,
      ms: Date.now() - started,
      error: e?.message || String(e),
    };
  }
}

async function main() {
  const [folder, modelA, modelB] = process.argv.slice(2);
  if (!folder || !modelA || !modelB) {
    console.error('Usage: npx ts-node scripts/compare-notice-reads.ts <folder> <model-a> <model-b>');
    process.exit(2);
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('ANTHROPIC_API_KEY is not set.');
    process.exit(2);
  }
  const files = fs
    .readdirSync(folder)
    .filter((f) => EXTENSIONS.has(path.extname(f).toLowerCase()))
    .sort();
  if (!files.length) {
    console.error(`No .pdf, .tif or .tiff files in ${folder}.`);
    process.exit(2);
  }

  const prices = {
    input: price(process.env.SURPLUS_NOTICE_INPUT_PRICE, DEFAULT_NOTICE_INPUT_PRICE),
    output: price(process.env.SURPLUS_NOTICE_OUTPUT_PRICE, DEFAULT_NOTICE_OUTPUT_PRICE),
  };
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const a = new AnthropicNoticeReaderClient(anthropic, modelA);
  const b = new AnthropicNoticeReaderClient(anthropic, modelB);

  console.log(`${files.length} notice${files.length === 1 ? '' : 's'} in ${folder}`);
  console.log(`A = ${modelA}, B = ${modelB}; both priced at $${prices.input}/$${prices.output} per million tokens\n`);

  let agree = 0;
  const totals = { a: { cost: 0, ms: 0 }, b: { cost: 0, ms: 0 } };

  for (const file of files) {
    const full = path.join(folder, file);
    console.log(`=== ${file}`);
    let content: Awaited<ReturnType<typeof prepareNoticeContent>>;
    try {
      content = await prepareNoticeContent(
        { data: fs.readFileSync(full), contentType: contentTypeOf(file) },
        (line) => console.log(`    ${line}`),
      );
    } catch (e: any) {
      console.log(`    could not prepare: ${e?.message || e}\n`);
      continue;
    }
    const pages = content.filter((c) => c.type === 'image').length;
    console.log(`    sent as ${content[0]?.type === 'document' ? 'a PDF document' : `${pages} page image${pages === 1 ? '' : 's'}`}`);

    const [ra, rb] = await Promise.all([readWith(a, content, prices), readWith(b, content, prices)]);
    totals.a.cost += ra.cost;
    totals.a.ms += ra.ms;
    totals.b.cost += rb.cost;
    totals.b.ms += rb.ms;

    for (const r of [ra, rb]) {
      const tag = r.model === modelA ? 'A' : 'B';
      if (r.error) console.log(`    ${tag} failed: ${r.error}`);
      else if (!r.extract) console.log(`    ${tag} returned no readable JSON: ${r.text.slice(0, 120).replace(/\s+/g, ' ')}`);
      console.log(
        `    ${tag} ${r.usage.inputTokens} in, ${r.usage.outputTokens} out, $${r.cost.toFixed(4)}, ${(r.ms / 1000).toFixed(1)}s`,
      );
    }

    let same = true;
    for (const field of FIELDS) {
      const va = show(ra.extract?.[field]);
      const vb = show(rb.extract?.[field]);
      if (va === vb) {
        console.log(`    = ${field}: ${va}`);
      } else {
        same = false;
        console.log(`    ! ${field}`);
        console.log(`        A: ${va}`);
        console.log(`        B: ${vb}`);
      }
    }
    if (same) agree += 1;
    console.log('');
  }

  console.log('=== Summary');
  console.log(`${agree} of ${files.length} notices parsed identically on every field`);
  console.log(`A ${modelA}: $${totals.a.cost.toFixed(4)} in all, ${(totals.a.ms / 1000).toFixed(1)}s`);
  console.log(`B ${modelB}: $${totals.b.cost.toFixed(4)} in all, ${(totals.b.ms / 1000).toFixed(1)}s`);
  console.log('Nothing was written to the database or to vendor_usage.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

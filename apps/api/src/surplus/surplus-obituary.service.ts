import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Anthropic from '@anthropic-ai/sdk';
import { LeadSource, SurplusClaimantType } from '@fast-homes/shared';
import { PrismaService } from '../prisma/prisma.service';
import {
  SurplusSkiptraceService,
  candidateOf,
  displayName,
  estateName,
} from './surplus-skiptrace.service';
import { splitClaimantName, traceCriteria } from './surplus-skiptrace.util';
import { historyKey } from './surplus-endato.service';

/**
 * The obituary search.
 *
 * Vendor death records miss people: the Social Security death file stopped
 * carrying most state-reported deaths in 2011. An obituary catches those, and
 * it does something no people search can: it names the spouse and children.
 *
 * Claude with web search looks for the claimant's obituary and judges whether
 * it is them. Measured 2026-09-16 on four claimants Endato already knew were
 * dead: Raymond Ortiz and Amy Oldinsky found as strong matches, Dewey R Beaver
 * found with his wife and two sons named, Gertrude F Leidy not found. Every
 * date matched Endato's. Each check cost 30 to 56 cents, so it runs behind
 * its own monthly dollar budget.
 *
 * Scope (decided 2026-09-16): ONLY estates with nobody reachable, meaning a
 * claimant already known dead where no heir or relative on the lead has a
 * callable number. Living claimants are never searched: Endato's death
 * records already cover them, and paying to second-guess that was not worth
 * it. For an estate, a strong match files the spouse and children the
 * obituary names and looks them up. A possible match waits for a person to
 * confirm or reject it on the card.
 */

export interface ObituarySurvivor {
  name: string;
  relationship: string;
  city: string | null;
}

export interface ObituaryVerdict {
  verdict: 'strong' | 'possible' | 'none';
  url: string | null;
  nameInObituary: string | null;
  dateOfDeath: string | null;
  place: string | null;
  evidence: string;
  survivors: ObituarySurvivor[];
}

export const OBITUARY_SYSTEM = `You check whether a person has died, by searching the web for their obituary, and if they have, who survives them.

You are given a person's name, the places they are known to be tied to, and sometimes their known relatives. Search for an obituary or death notice, then judge whether any you find is THIS person, not a namesake.

How to search. Obituaries are published by funeral homes, legacy.com, dignitymemorial.com, tributearchive.com, echovita.com and local newspapers, and they spell names in full with suffixes ("James William Connolly, Jr."). People move, often within the same state, so do not search only the listed city.
1. Search the given name, surname and the word obituary with the STATE, for example "James Connolly obituary Florida". Do this for each state in the listed places.
2. If a middle initial is given, also search the given name, the initial and the surname, for example "James W. Connolly obituary".
3. Then narrow by the listed cities or county if the broad searches are crowded.
4. Open the page of any obituary whose name fits and read it: search snippets leave out the middle name, the birth date and the survivors, which are exactly what decide the match.

Evidence that ties an obituary to the person:
- the name matches, including a middle name or initial when both give one
- the person lived, worked or was buried in a listed city or county, or a town next to one
- a survivor named in the obituary lives in a listed city (the clerk's mailing address is often a child's home)
- a relative named in the obituary appears in the known relatives
- a death date consistent with a known date of death

Verdicts:
- "strong": the name matches AND a place ties it AND at least one more tie from the list above. A rare surname with a place tie also counts.
- "possible": the given name and surname match, the obituary is in a listed state or a neighboring one, and nothing in it contradicts the person (a different middle name, a spouse with a different name than a known spouse). Missing detail is not a contradiction.
- "none": no obituary found, or only obituaries that are clearly other people.

Common names produce many obituaries for other people. When in doubt between strong and possible, choose possible. Never guess a date of death.

Finish with ONLY a JSON object, no prose after it:
{"verdict":"strong|possible|none","url":string|null,"nameInObituary":string|null,"dateOfDeath":"YYYY-MM-DD"|null,"place":string|null,"evidence":"one or two sentences on what ties it to this person or why not","survivors":[{"name":string,"relationship":string,"city":string|null}]}
List survivors only for a strong or possible verdict, as the obituary names them (spouse, children, siblings, grandchildren), with their city and state when given, for example "Lancaster, OH".`;

/** Per million tokens. Cache reads are charged at the input price here, which errs high. */
const PRICES: Record<string, { in: number; out: number }> = {
  'claude-opus-5': { in: 5, out: 25 },
  'claude-sonnet-5': { in: 2, out: 10 },
};
const WEB_SEARCH_PRICE = 0.01;
/** Refuse a check the budget cannot cover at the most one has cost so far. */
const WORST_CASE_CHECK = 0.6;

export function obituaryCost(
  usage: { input: number; output: number; searches: number },
  model: string,
): number {
  const p = PRICES[model] || PRICES['claude-opus-5'];
  return (usage.input * p.in + usage.output * p.out) / 1e6 + usage.searches * WEB_SEARCH_PRICE;
}

/** The verdict out of the reply. Anything unreadable is "none", never a guess. */
export function parseObituaryVerdict(text: string): ObituaryVerdict {
  const none: ObituaryVerdict = {
    verdict: 'none',
    url: null,
    nameInObituary: null,
    dateOfDeath: null,
    place: null,
    evidence: 'The search returned nothing readable.',
    survivors: [],
  };
  const raw = String(text || '');
  const start = raw.lastIndexOf('{"verdict"') >= 0 ? raw.lastIndexOf('{"verdict"') : raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) return none;
  let o: any;
  try {
    o = JSON.parse(raw.slice(start, end + 1));
  } catch {
    return none;
  }
  const verdict = ['strong', 'possible', 'none'].includes(o?.verdict) ? o.verdict : 'none';
  const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
  const date = str(o?.dateOfDeath);
  return {
    verdict,
    url: str(o?.url),
    nameInObituary: str(o?.nameInObituary),
    dateOfDeath: date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null,
    place: str(o?.place),
    evidence: str(o?.evidence) || '',
    survivors: verdict === 'none' || !Array.isArray(o?.survivors)
      ? []
      : o.survivors
          .map((s: any) => ({ name: str(s?.name) || '', relationship: str(s?.relationship) || '', city: str(s?.city) }))
          .filter((s: ObituarySurvivor) => s.name),
  };
}

/**
 * A direct inheritor as an obituary words it: a spouse or a child, stepchild
 * included. In-laws, grandchildren, nieces, nephews and siblings are not, and
 * "son-in-law" and "grandson" both contain "son".
 */
export function isDirectSurvivor(relationship: string): boolean {
  const r = String(relationship || '').toLowerCase();
  if (/in[-\s]?law|grand|niece|nephew|cousin|brother|sister|sibling|friend|partner of/.test(r)) return false;
  return /\b(wife|husband|spouse|widow|widower|son|daughter|child|children|stepson|stepdaughter)\b/.test(r);
}

/** "Lancaster, OH" into its parts. */
function cityState(v: string | null): { city: string | null; state: string | null } {
  const m = /^\s*([^,]+?)\s*,\s*([A-Za-z]{2})\b/.exec(String(v || ''));
  return m ? { city: m[1], state: m[2].toUpperCase() } : { city: v || null, state: null };
}

function personKey(n: string): string {
  return String(n || '')
    .toUpperCase()
    .replace(/\([^)]*\)/g, ' ')
    .replace(/[^A-Z ]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 1)
    .sort()
    .join(' ');
}

function longDate(iso: string): string {
  const d = new Date(`${iso}T12:00:00Z`);
  return isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString('en-US', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
}

export interface ObituaryRunResult {
  candidates: number;
  checked: number;
  strong: number;
  possible: number;
  none: number;
  survivorsFiled: number;
  survivorsLooked: number;
  survivorsWithContact: number;
  spent: number;
  estimatedCost?: number;
  errors: number;
  message?: string;
}

@Injectable()
export class SurplusObituaryService {
  private readonly logger = new Logger(SurplusObituaryService.name);
  private readonly anthropic?: Anthropic;

  constructor(
    private config: ConfigService,
    private prisma: PrismaService,
    private skiptrace: SurplusSkiptraceService,
  ) {
    const key = this.config.get<string>('ANTHROPIC_API_KEY');
    if (key) this.anthropic = new Anthropic({ apiKey: key });
  }

  /** Dollars per calendar month. Unset or 0 pauses the search entirely. */
  get monthlyBudget(): number {
    const b = Number(this.config.get<string>('OBITUARY_MONTHLY_BUDGET'));
    return Number.isFinite(b) && b > 0 ? b : 0;
  }

  get model(): string {
    return this.config.get<string>('OBITUARY_MODEL') || 'claude-opus-5';
  }

  get available(): boolean {
    return !!this.anthropic && this.monthlyBudget > 0;
  }

  async usage(): Promise<{ period: string; checks: number; spent: number; budget: number; paused: boolean; left: number }> {
    const period = monthNY();
    const row = await this.prisma.vendorUsage.findUnique({ where: { vendor_period: { vendor: 'obituary', period } } });
    const spent = Math.round((row?.spend || 0) * 100) / 100;
    const budget = this.monthlyBudget;
    return { period, checks: row?.calls || 0, spent, budget, paused: !this.available, left: Math.max(0, Math.round((budget - spent) * 100) / 100) };
  }

  /**
   * One check. Throws "out of budget" before spending when the month cannot
   * cover a worst-case check, which every loop here reads as stop the run.
   */
  async search(person: Record<string, unknown>): Promise<{ verdict: ObituaryVerdict; cost: number }> {
    if (!this.anthropic) throw new Error('ANTHROPIC_API_KEY is not set: out of budget.');
    if (!this.monthlyBudget) throw new Error('The obituary search is paused: out of budget until OBITUARY_MONTHLY_BUDGET is set.');
    const u = await this.usage();
    if (u.spent + WORST_CASE_CHECK > u.budget) {
      throw new Error(`Obituary budget of $${u.budget} reached ($${u.spent} spent in ${u.period}): out of budget.`);
    }

    const messages: any[] = [{ role: 'user', content: JSON.stringify(person, null, 1) }];
    const used = { input: 0, output: 0, searches: 0 };
    let response: any;
    // A long search can pause mid-turn; the documented way on is to send the
    // paused content back and let it carry on. Four rounds is plenty.
    for (let round = 0; round < 4; round += 1) {
      response = await (this.anthropic as any).beta.messages.create({
        model: this.model,
        max_tokens: 8000,
        // If the model declines, the API re-runs the request on a fallback
        // model inside the same call rather than returning nothing.
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        output_config: { effort: 'medium' },
        system: OBITUARY_SYSTEM,
        tools: [
          { type: 'web_search_20260209', name: 'web_search', max_uses: 4 },
          { type: 'web_fetch_20260209', name: 'web_fetch', max_uses: 3, max_content_tokens: 6000 },
        ],
        messages,
      });
      const us = response?.usage || {};
      used.input += (us.input_tokens || 0) + (us.cache_creation_input_tokens || 0) + (us.cache_read_input_tokens || 0);
      used.output += us.output_tokens || 0;
      used.searches += us.server_tool_use?.web_search_requests || 0;
      if (response?.stop_reason !== 'pause_turn') break;
      messages.push({ role: 'assistant', content: response.content });
    }
    const cost = obituaryCost(used, this.model);
    await this.prisma.vendorUsage
      .upsert({
        where: { vendor_period: { vendor: 'obituary', period: monthNY() } },
        create: { vendor: 'obituary', period: monthNY(), calls: 1, spend: cost },
        update: { calls: { increment: 1 }, spend: { increment: cost } },
      })
      .catch((e) => this.logger.warn(`Could not record obituary spend: ${e?.message || e}`));

    if (response?.stop_reason === 'refusal') {
      return { verdict: { ...parseObituaryVerdict(''), evidence: 'The search was declined.' }, cost };
    }
    const text = (response?.content || [])
      .filter((b: any) => b.type === 'text')
      .map((b: any) => b.text)
      .join('\n');
    return { verdict: parseObituaryVerdict(text), cost };
  }

  /**
   * Search for the obituaries of estates with nobody reachable: claimants
   * known dead, meeting the criteria, not yet checked, where no heir or
   * relative on the lead has a callable number. Biggest surplus first.
   * `limit` caps the checks; `dryRun` counts them.
   */
  async run(opts: {
    organizationId?: string | null;
    leadIds?: string[];
    county?: string;
    limit?: number;
    dryRun?: boolean;
  }): Promise<ObituaryRunResult> {
    const out: ObituaryRunResult = {
      candidates: 0, checked: 0, strong: 0, possible: 0, none: 0,
      survivorsFiled: 0, survivorsLooked: 0, survivorsWithContact: 0, spent: 0, errors: 0,
    };
    if (!this.available && !opts.dryRun) {
      out.message = this.anthropic
        ? 'The obituary search is paused until OBITUARY_MONTHLY_BUDGET is set.'
        : 'ANTHROPIC_API_KEY is not set.';
      return out;
    }
    const leads = await this.prisma.lead.findMany({
      where: {
        source: LeadSource.SURPLUS,
        ...(opts.organizationId ? { organizationId: opts.organizationId } : {}),
        ...(opts.leadIds ? { id: { in: opts.leadIds } } : {}),
        surplusDetail: {
          obituaryCheckedAt: null,
          doNotCall: false,
          ...(opts.county ? { county: opts.county } : {}),
        },
      },
      include: { surplusDetail: { include: { heirs: true } } },
    });
    const eligible = leads
      .filter((l: any) => l.surplusDetail && traceCriteria(l.surplusDetail, { estate: true }).ok)
      .filter((l: any) => {
        const d = l.surplusDetail;
        // Estates only. A living claimant's death is Endato's job.
        if (!(d.deceased || d.heirsRequired)) return false;
        // Nobody reachable: no living heir or relative with a number that is
        // not on a do-not-call registry. One reachable person is the route.
        return !(d.heirs || []).some(
          (h: any) =>
            !h.deceased &&
            !h.doNotCall &&
            [1, 2, 3, 4].some((i) => h[`phone${i}`] && !h[`phone${i}Dnc`]),
        );
      })
      .map((l: any) => ({ lead: l, c: candidateOf(l) }))
      .filter(({ c }) => !c.isEntity && splitClaimantName(estateName(c.claimant)).given.length > 0)
      .sort((a: any, b: any) => (b.lead.surplusDetail.grossSurplus || 0) - (a.lead.surplusDetail.grossSurplus || 0));
    out.candidates = eligible.length;
    if (opts.dryRun) {
      const n = opts.limit ? Math.min(opts.limit, eligible.length) : eligible.length;
      out.estimatedCost = Math.round(n * 0.45 * 100) / 100;
      return out;
    }

    for (const { lead, c } of eligible) {
      if (opts.limit && out.checked >= opts.limit) break;
      let verdict: ObituaryVerdict;
      try {
        const r = await this.search(this.personFor(lead, c));
        verdict = r.verdict;
        out.spent = Math.round((out.spent + r.cost) * 100) / 100;
      } catch (e: any) {
        out.errors += 1;
        if (!out.message) out.message = e.message;
        this.logger.warn(`Obituary search failed for ${c.claimant}: ${e.message}`);
        if (/out of budget|authentication|rate limit/i.test(e.message)) break;
        continue;
      }
      out.checked += 1;
      out[verdict.verdict] += 1;
      const applied = await this.apply(lead, c, verdict);
      out.survivorsFiled += applied.filed;
      out.survivorsLooked += applied.looked;
      out.survivorsWithContact += applied.withContact;
    }
    return out;
  }

  /** A person on the card confirms or rejects a possible match. */
  async resolve(leadId: string, organizationId: string | null, answer: 'confirm' | 'reject') {
    const lead: any = await this.prisma.lead.findFirst({
      where: { id: leadId, ...(organizationId ? { organizationId } : {}) },
      include: { surplusDetail: { include: { heirs: true } } },
    });
    if (!lead?.surplusDetail?.obituary) throw new Error('No obituary is on file for this claimant.');
    const d = lead.surplusDetail;
    if (answer === 'reject') {
      await this.prisma.surplusDetail.update({
        where: { id: d.id },
        data: {
          obituaryMatch: 'rejected',
          callNotes: [d.callNotes, 'Possible obituary rejected: not this claimant.'].filter(Boolean).join('\n'),
        },
      });
      return { obituaryMatch: 'rejected' };
    }
    const r = await this.applyStrong(lead, candidateOf(lead), d.obituary as ObituaryVerdict, 'confirmed');
    return { obituaryMatch: 'confirmed', ...r };
  }

  private personFor(lead: any, c: any): Record<string, unknown> {
    const d = lead.surplusDetail;
    const dead = d.deceased || d.heirsRequired;
    const place = (street: string | null, city: string | null, state: string | null, zip: string | null, what: string) =>
      street || city ? `${[street, city, [state, zip].filter(Boolean).join(' ')].filter(Boolean).join(', ')} (${what})` : null;
    const relatives = new Set<string>();
    const noted = /Relatives on file(?: to start the heir search from)?: ([^\n]+?)\.(?:\s|$)/.exec(d.callNotes || '');
    if (noted) noted[1].split(/,\s*/).forEach((r: string) => relatives.add(r.trim()));
    for (const h of d.heirs || []) relatives.add(h.relationship ? `${h.name} (${String(h.relationship).toLowerCase()})` : h.name);
    return {
      name: displayName(estateName(c.claimant)),
      status: dead
        ? `Known to have died${d.dateOfDeath ? ` on ${new Date(d.dateOfDeath).toISOString().slice(0, 10)}` : ''}. Find the obituary to learn who survives them.`
        : 'Not known to have died.',
      knownPlaces: [
        place(lead.propertyAddress, lead.propertyCity, lead.propertyState, lead.propertyZip, `the property, ${d.county || ''} County`.trim()),
        place(d.ownerMailingStreet, d.ownerMailingCity, d.ownerMailingState, d.ownerMailingZip, "the clerk's mailing address"),
      ].filter(Boolean),
      knownRelatives: [...relatives].slice(0, 10),
    };
  }

  private async apply(lead: any, c: any, v: ObituaryVerdict): Promise<{ filed: number; looked: number; withContact: number }> {
    const d = lead.surplusDetail;
    if (v.verdict === 'strong') return this.applyStrong(lead, c, v, 'strong');
    const line =
      v.verdict === 'possible'
        ? `Possible obituary, check before calling: ${v.nameInObituary || 'a namesake'}${v.dateOfDeath ? `, died ${longDate(v.dateOfDeath)}` : ''}${v.place ? `, ${v.place}` : ''}. ${v.url || ''} ${v.evidence}`.replace(/\s+/g, ' ').trim()
        : null;
    await this.prisma.surplusDetail.update({
      where: { id: d.id },
      data: {
        obituaryCheckedAt: new Date(),
        obituaryMatch: v.verdict,
        obituary: v as any,
        ...(line ? { callNotes: [d.callNotes, line].filter(Boolean).join('\n') } : {}),
      },
    });
    return { filed: 0, looked: 0, withContact: 0 };
  }

  /**
   * The obituary is this claimant's. Mark them dead if they were not, take
   * the date, file the spouse and children it names, and look them up.
   */
  private async applyStrong(
    lead: any,
    c: any,
    v: ObituaryVerdict,
    match: 'strong' | 'confirmed',
  ): Promise<{ filed: number; looked: number; withContact: number }> {
    const d = lead.surplusDetail;
    const who = displayName(estateName(c.claimant));
    const iso = v.dateOfDeath;
    const direct = v.survivors.filter((s) => isDirectSurvivor(s.relationship));
    const line =
      `Obituary (${match === 'confirmed' ? 'confirmed on the card' : 'strong match'}): ${v.nameInObituary || who}` +
      `${iso ? ` died ${longDate(iso)}` : ''}${v.place ? `, ${v.place}` : ''}. ${v.url || ''} ${v.evidence} ` +
      (direct.length
        ? `Spouse and children named: ${direct.map((s) => `${s.name} (${s.relationship.toLowerCase()}${s.city ? `, ${s.city}` : ''})`).join('; ')}.`
        : 'The obituary names no spouse or children.');
    await this.prisma.surplusDetail.update({
      where: { id: d.id },
      data: {
        obituaryCheckedAt: new Date(),
        obituaryMatch: match,
        obituary: v as any,
        deceased: true,
        heirsRequired: true,
        claimantType: SurplusClaimantType.HEIR_ESTATE,
        ...(iso && !d.dateOfDeath ? { dateOfDeath: new Date(`${iso}T12:00:00Z`) } : {}),
        ...(!d.deathSource && !(d.deceased || d.heirsRequired) ? { deathSource: 'obituary' } : {}),
        callNotes: [d.callNotes, line.replace(/\s+/g, ' ').trim()].filter(Boolean).join('\n'),
      },
    });

    // Only the spouse and children: the business works estates through direct
    // inheritors. Siblings and grandchildren stay in the saved verdict.
    const have = new Set((d.heirs || []).map((h: any) => personKey(h.name)));
    let filed = 0;
    for (const s of direct.slice(0, 8)) {
      const k = personKey(s.name);
      if (!k || have.has(k)) continue;
      have.add(k);
      const { city, state } = cityState(s.city);
      await this.prisma.surplusHeir.create({
        data: {
          surplusDetailId: d.id,
          organizationId: lead.organizationId || null,
          name: s.name.replace(/\s*\([^)]*\)\s*/g, ' ').replace(/\s+/g, ' ').trim(),
          relationship: s.relationship.charAt(0).toUpperCase() + s.relationship.slice(1),
          city,
          state,
          role: 'relative',
          sourceKind: 'obituary',
          sourceDocument: v.url,
          callNotes: `Named in ${who}'s obituary as their ${s.relationship.toLowerCase()}. A direct inheritor, but not a signer until a probate filing or the family confirms it.`,
        },
      });
      filed += 1;
    }
    const keys = {
      property: historyKey(c.propertyStreet, c.propertyCity, c.propertyZip),
      mailing: historyKey(c.mailingStreet, c.mailingCity, c.mailingZip),
    };
    const r = filed ? await this.skiptrace.lookupSurvivors(d.id, who, keys) : { looked: 0, withContact: 0 };
    return { filed, looked: r.looked, withContact: r.withContact };
  }
}

/** "2026-09", in the business's own time zone. */
function monthNY(d = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit' }).formatToParts(d);
  return `${parts.find((p) => p.type === 'year')?.value}-${parts.find((p) => p.type === 'month')?.value}`;
}

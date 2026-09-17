import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Anthropic from '@anthropic-ai/sdk';
import {
  LeadSource,
  SurplusSocialProfileStatus,
  SurplusTraceChannel,
} from '@fast-homes/shared';
import { PrismaService } from '../prisma/prisma.service';
import { candidateOf, displayName, estateName } from './surplus-skiptrace.service';
import { splitClaimantName, traceCriteria } from './surplus-skiptrace.util';
import {
  SOCIAL_SYSTEM,
  SocialVerdict,
  messageUrl,
  parseProfileUrl,
  parseSocialVerdict,
  platformLabel,
  socialSearchCost,
} from './surplus-social.util';

/**
 * Social profiles on a surplus claim: kept, searched for, and written to.
 *
 * Three things live here. The profile list (add by hand, confirm, reject,
 * remove), the touch log for a message sent through a profile, and the
 * search: Claude with web search looks for the person's public profiles
 * and files what it finds as candidates with the evidence beside each.
 *
 * The search is paid per check (tokens plus web searches, the same shape as
 * the obituary search) and is ON by default with no cap: the decision
 * (2026-09-17) is that finding the claimant is worth the fifty cents every
 * time. SOCIAL_SEARCH_MONTHLY_BUDGET is an optional ceiling in dollars, and
 * SOCIAL_SEARCH_ENABLED=false turns it off. The links and the hand-entered
 * profiles work regardless.
 */

/** Refuse a check the budget cannot cover at the most one is expected to cost. */
const WORST_CASE_CHECK = 0.6;

export interface SocialRunResult {
  candidates: number;
  checked: number;
  found: number;
  profiles: number;
  spent: number;
  estimatedCost?: number;
  errors: number;
  message?: string;
}

@Injectable()
export class SurplusSocialService {
  private readonly logger = new Logger(SurplusSocialService.name);
  private readonly anthropic?: Anthropic;

  constructor(
    private config: ConfigService,
    private prisma: PrismaService,
  ) {
    const key = this.config.get<string>('ANTHROPIC_API_KEY');
    if (key) this.anthropic = new Anthropic({ apiKey: key });
  }

  /** An optional ceiling, dollars per calendar month. Unset or 0 means no cap. */
  get monthlyBudget(): number {
    const b = Number(this.config.get<string>('SOCIAL_SEARCH_MONTHLY_BUDGET'));
    return Number.isFinite(b) && b > 0 ? b : 0;
  }

  /** On unless SOCIAL_SEARCH_ENABLED is set to false. */
  get enabled(): boolean {
    return (this.config.get<string>('SOCIAL_SEARCH_ENABLED') ?? 'true') !== 'false';
  }

  get model(): string {
    return this.config.get<string>('SOCIAL_SEARCH_MODEL') || 'claude-opus-5';
  }

  get available(): boolean {
    return !!this.anthropic && this.enabled;
  }

  /** `budget` 0 and `left` null mean no cap is set. */
  async usage(): Promise<{ period: string; checks: number; spent: number; budget: number; paused: boolean; left: number | null }> {
    const period = monthNY();
    const row = await this.prisma.vendorUsage.findUnique({ where: { vendor_period: { vendor: 'social', period } } });
    const spent = Math.round((row?.spend || 0) * 100) / 100;
    const budget = this.monthlyBudget;
    return { period, checks: row?.calls || 0, spent, budget, paused: !this.available, left: budget ? Math.max(0, Math.round((budget - spent) * 100) / 100) : null };
  }

  // ─── The profile list ─────────────────────────────────────────────────────

  /** Every profile on the claim, the claimant's first, confirmed before candidates. */
  async list(leadId: string, organizationId?: string | null) {
    const d = await this.detailOf(leadId, organizationId);
    const rows = await this.prisma.surplusSocialProfile.findMany({
      where: { surplusDetailId: d.id },
      include: { heir: { select: { id: true, name: true } } },
      orderBy: [{ createdAt: 'asc' }],
    });
    return rows.map((r) => this.toRow(r));
  }

  toRow(r: any) {
    return {
      id: r.id,
      heirId: r.heirId || null,
      personName: r.heir?.name || null,
      platform: r.platform,
      platformLabel: platformLabel(r.platform),
      url: r.url,
      handle: r.handle || null,
      displayName: r.displayName || null,
      status: r.status,
      confidence: r.confidence || null,
      evidence: r.evidence || null,
      foundBy: r.foundBy,
      messageCount: r.messageCount || 0,
      lastMessagedAt: r.lastMessagedAt || null,
      messageUrl: messageUrl(r),
      createdAt: r.createdAt,
    };
  }

  /**
   * A profile somebody found by hand. Confirmed on arrival: the person who
   * pasted it made the identification, which is the whole judgement. Logs a
   * social search as found, so the escalation rule sees the channel tried.
   */
  async add(
    leadId: string,
    input: { url: string; heirId?: string | null; displayName?: string | null; evidence?: string | null },
    organizationId?: string | null,
    userId?: string | null,
  ) {
    const d = await this.detailOf(leadId, organizationId);
    const parsed = parseProfileUrl(String(input.url || ''));
    if (!parsed) throw new BadRequestException('That is not a web address. Paste the profile link as it appears in the browser.');
    if (input.heirId) {
      const heir = await this.prisma.surplusHeir.findFirst({ where: { id: input.heirId, surplusDetailId: d.id } });
      if (!heir) throw new BadRequestException('That person is not on this claim.');
    }
    const row = await this.prisma.surplusSocialProfile.upsert({
      where: { surplusDetailId_url: { surplusDetailId: d.id, url: parsed.url } },
      create: {
        surplusDetailId: d.id,
        heirId: input.heirId || null,
        organizationId: d.organizationId,
        platform: parsed.platform,
        url: parsed.url,
        handle: parsed.handle,
        displayName: String(input.displayName || '').trim() || null,
        status: SurplusSocialProfileStatus.CONFIRMED,
        evidence: String(input.evidence || '').trim() || null,
        foundBy: 'manual',
        createdByUserId: userId || null,
      },
      update: {
        status: SurplusSocialProfileStatus.CONFIRMED,
        heirId: input.heirId || null,
        ...(String(input.displayName || '').trim() ? { displayName: String(input.displayName).trim() } : {}),
        ...(String(input.evidence || '').trim() ? { evidence: String(input.evidence).trim() } : {}),
      },
      include: { heir: { select: { id: true, name: true } } },
    });
    await this.prisma.surplusTraceAttempt.create({
      data: {
        surplusDetailId: d.id,
        heirId: input.heirId || null,
        organizationId: d.organizationId,
        channel: SurplusTraceChannel.SOCIAL,
        source: platformLabel(parsed.platform),
        result: 'found',
        summary: `Profile added by hand: ${parsed.url}`,
        cost: 0,
        ranAt: new Date(),
        byUserId: userId || null,
      },
    });
    await this.prisma.activity.create({
      data: {
        leadId,
        userId: userId || undefined,
        type: 'SOCIAL_PROFILE',
        description: `${platformLabel(parsed.platform)} profile added${row.heir ? ` for ${row.heir.name}` : ''}: ${parsed.url}`,
        metadata: { profileId: row.id, platform: parsed.platform, url: parsed.url, heirId: row.heirId },
      },
    });
    return this.toRow(row);
  }

  /** A person confirms or rejects a candidate the search offered. */
  async setStatus(profileId: string, status: string, organizationId?: string | null, userId?: string | null) {
    if (!(Object.values(SurplusSocialProfileStatus) as string[]).includes(status)) {
      throw new BadRequestException('The status is candidate, confirmed, or rejected.');
    }
    const row = await this.find(profileId, organizationId);
    const updated = await this.prisma.surplusSocialProfile.update({
      where: { id: row.id },
      data: { status },
      include: { heir: { select: { id: true, name: true } } },
    });
    await this.prisma.activity.create({
      data: {
        leadId: row.surplusDetail.leadId,
        userId: userId || undefined,
        type: 'SOCIAL_PROFILE',
        description: `${platformLabel(row.platform)} profile ${status === 'confirmed' ? 'confirmed as' : status === 'rejected' ? 'rejected: not' : 'reopened for'} ${row.heir?.name || 'the claimant'}: ${row.url}`,
        metadata: { profileId: row.id, status, heirId: row.heirId },
      },
    });
    return this.toRow(updated);
  }

  async remove(profileId: string, organizationId?: string | null) {
    const row = await this.find(profileId, organizationId);
    await this.prisma.surplusSocialProfile.delete({ where: { id: row.id } });
    return { ok: true };
  }

  /**
   * A message went out through this profile. The platforms' own apps send
   * it; this is the record. Counts as a touch on the lead the way a call or
   * a text does, and moves an associate to contacted.
   */
  async messaged(profileId: string, note: string | null, organizationId?: string | null, userId?: string | null) {
    const row = await this.find(profileId, organizationId);
    const now = new Date();
    const updated = await this.prisma.surplusSocialProfile.update({
      where: { id: row.id },
      data: { messageCount: { increment: 1 }, lastMessagedAt: now },
      include: { heir: { select: { id: true, name: true } } },
    });
    await this.prisma.lead.update({
      where: { id: row.surplusDetail.leadId },
      data: { touchCount: { increment: 1 }, lastTouchedAt: now },
    });
    if (row.heirId) {
      await this.prisma.surplusHeir.update({
        where: { id: row.heirId },
        data: {
          lastContactedAt: now,
          ...(row.heir && (row.heir as any).contactStatus === 'not_contacted' ? { contactStatus: 'contacted' } : {}),
        },
      });
    }
    await this.prisma.activity.create({
      data: {
        leadId: row.surplusDetail.leadId,
        userId: userId || undefined,
        type: 'SOCIAL_MESSAGE',
        description: `${platformLabel(row.platform)} message sent to ${row.heir?.name || 'the claimant'}${note ? `: ${String(note).trim()}` : ''}`,
        metadata: { profileId: row.id, platform: row.platform, url: row.url, heirId: row.heirId },
      },
    });
    return this.toRow(updated);
  }

  // ─── The search ───────────────────────────────────────────────────────────

  /**
   * One check. Throws "out of budget" before spending when the month cannot
   * cover a worst-case check, which every loop here reads as stop the run.
   */
  async search(person: Record<string, unknown>): Promise<{ verdict: SocialVerdict; cost: number }> {
    if (!this.anthropic) throw new Error('ANTHROPIC_API_KEY is not set: out of budget.');
    if (!this.enabled) throw new Error('The social profile search is turned off (SOCIAL_SEARCH_ENABLED=false).');
    const u = await this.usage();
    // Only a set ceiling can stop a check. With none, every check runs.
    if (u.budget && u.spent + WORST_CASE_CHECK > u.budget) {
      throw new Error(`Social search budget of $${u.budget} reached ($${u.spent} spent in ${u.period}): out of budget.`);
    }

    const messages: any[] = [{ role: 'user', content: JSON.stringify(person, null, 1) }];
    const used = { input: 0, output: 0, searches: 0 };
    let response: any;
    for (let round = 0; round < 4; round += 1) {
      response = await (this.anthropic as any).beta.messages.create({
        model: this.model,
        max_tokens: 8000,
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        output_config: { effort: 'medium' },
        system: SOCIAL_SYSTEM,
        tools: [
          { type: 'web_search_20260209', name: 'web_search', max_uses: 6 },
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
    const cost = socialSearchCost(used, this.model);
    await this.prisma.vendorUsage
      .upsert({
        where: { vendor_period: { vendor: 'social', period: monthNY() } },
        create: { vendor: 'social', period: monthNY(), calls: 1, spend: cost },
        update: { calls: { increment: 1 }, spend: { increment: cost } },
      })
      .catch((e) => this.logger.warn(`Could not record social search spend: ${e?.message || e}`));

    if (response?.stop_reason === 'refusal') {
      return { verdict: { profiles: [], leads: [], searched: 'The search was declined.', note: null }, cost };
    }
    const text = (response?.content || [])
      .filter((b: any) => b.type === 'text')
      .map((b: any) => b.text)
      .join('\n');
    return { verdict: parseSocialVerdict(text), cost };
  }

  /**
   * Search for one person's profiles from the card: the claimant, or an heir
   * or associate when `heirId` is given. Files what it finds as candidates,
   * stamps the person searched, and logs the attempt with its cost.
   */
  async findFor(
    leadId: string,
    opts: { heirId?: string | null; organizationId?: string | null; userId?: string | null } = {},
  ): Promise<{ verdict: SocialVerdict; cost: number; added: number; profiles: any[] }> {
    const lead: any = await this.prisma.lead.findFirst({
      where: { id: leadId, source: LeadSource.SURPLUS, ...(opts.organizationId ? { organizationId: opts.organizationId } : {}) },
      include: { surplusDetail: { include: { heirs: true, socialProfiles: true } } },
    });
    if (!lead?.surplusDetail) throw new BadRequestException('Surplus lead not found');
    const d = lead.surplusDetail;
    const heir = opts.heirId ? (d.heirs || []).find((h: any) => h.id === opts.heirId) : null;
    if (opts.heirId && !heir) throw new BadRequestException('That person is not on this claim.');
    if (heir?.deceased) throw new BadRequestException(`${heir.name} is deceased. Search for the people around them instead.`);
    const c = candidateOf(lead);
    if (!heir && c.isEntity) throw new BadRequestException('An entity has no personal profile to find. Sunbiz names the registered agent.');
    const who = heir ? heir.name : displayName(estateName(c.claimant));
    if (splitClaimantName(who).given.length === 0) throw new BadRequestException(`"${who}" is a surname only, which is not enough to search on.`);

    let verdict: SocialVerdict;
    let cost = 0;
    try {
      const r = await this.search(heir ? this.personForHeir(lead, heir, who) : this.personFor(lead, c, who));
      verdict = r.verdict;
      cost = r.cost;
    } catch (e: any) {
      throw new BadRequestException(e?.message || 'The search failed.');
    }
    const added = await this.apply(lead, heir, who, verdict, cost, opts.userId || null);
    const profiles = await this.list(leadId, opts.organizationId);
    return { verdict, cost, added, profiles };
  }

  /**
   * Search for the profiles of living claimants nobody can reach: meeting
   * the criteria, not yet searched, with no callable number on the claimant.
   * Biggest surplus first. `limit` caps the checks; `dryRun` counts them.
   */
  async run(opts: {
    organizationId?: string | null;
    leadIds?: string[];
    county?: string;
    limit?: number;
    dryRun?: boolean;
  }): Promise<SocialRunResult> {
    const out: SocialRunResult = { candidates: 0, checked: 0, found: 0, profiles: 0, spent: 0, errors: 0 };
    if (!this.available && !opts.dryRun) {
      out.message = this.anthropic
        ? 'The social profile search is turned off (SOCIAL_SEARCH_ENABLED=false).'
        : 'ANTHROPIC_API_KEY is not set.';
      return out;
    }
    const leads = await this.prisma.lead.findMany({
      where: {
        source: LeadSource.SURPLUS,
        ...(opts.organizationId ? { organizationId: opts.organizationId } : {}),
        ...(opts.leadIds ? { id: { in: opts.leadIds } } : {}),
        surplusDetail: {
          socialSearchedAt: null,
          doNotCall: false,
          deceased: false,
          heirsRequired: false,
          ...(opts.county ? { county: opts.county } : {}),
        },
      },
      include: { surplusDetail: { include: { heirs: true, socialProfiles: true } } },
    });
    const eligible = leads
      .filter((l: any) => l.surplusDetail && traceCriteria(l.surplusDetail).ok)
      // Nobody reachable: no number on the claimant that is not on a registry.
      .filter((l: any) => !callable(l))
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
      const who = displayName(estateName(c.claimant));
      let verdict: SocialVerdict;
      let cost = 0;
      try {
        const r = await this.search(this.personFor(lead, c, who));
        verdict = r.verdict;
        cost = r.cost;
        out.spent = Math.round((out.spent + cost) * 100) / 100;
      } catch (e: any) {
        out.errors += 1;
        if (!out.message) out.message = e.message;
        this.logger.warn(`Social search failed for ${who}: ${e.message}`);
        if (/out of budget|authentication|rate limit/i.test(e.message)) break;
        continue;
      }
      out.checked += 1;
      if (verdict.profiles.length) out.found += 1;
      out.profiles += await this.apply(lead, null, who, verdict, cost, null);
    }
    return out;
  }

  // ─── Internals ────────────────────────────────────────────────────────────

  private personFor(lead: any, c: any, who: string): Record<string, unknown> {
    const d = lead.surplusDetail;
    const relatives = new Set<string>();
    const noted = /Relatives on file(?: to start the heir search from)?: ([^\n]+?)\.(?:\s|$)/.exec(d.callNotes || '');
    if (noted) noted[1].split(/,\s*/).forEach((r: string) => relatives.add(r.trim()));
    for (const h of d.heirs || []) relatives.add(h.relationship ? `${h.name} (${String(h.relationship).toLowerCase()})` : h.name);
    const age = /\bage (\d{2})\b/i.exec(d.callNotes || '');
    return {
      name: who,
      status: 'Living, as far as is known. Owed money by a Florida county; the team needs a way to reach them.',
      ...(age ? { approximateAge: Number(age[1]) } : {}),
      knownPlaces: [
        place(lead.propertyAddress, lead.propertyCity, lead.propertyState, lead.propertyZip, `the property they lost, ${d.county || ''} County, Florida`.trim()),
        place(d.ownerMailingStreet, d.ownerMailingCity, d.ownerMailingState, d.ownerMailingZip, "the clerk's mailing address for them"),
      ].filter(Boolean),
      knownRelatives: [...relatives].slice(0, 10),
      alreadyRejected: (d.socialProfiles || [])
        .filter((p: any) => p.status === SurplusSocialProfileStatus.REJECTED)
        .map((p: any) => p.url),
    };
  }

  private personForHeir(lead: any, heir: any, who: string): Record<string, unknown> {
    const d = lead.surplusDetail;
    const claimant = displayName(estateName(`${lead.sellerFirstName || ''} ${lead.sellerLastName || ''}`.trim()));
    return {
      name: who,
      status: `${heir.relationship ? `${heir.relationship} of` : 'Connected to'} ${claimant}, who ${d.deceased || d.heirsRequired ? 'has died and' : ''} is owed money by ${d.county || 'a Florida'} County. The team needs a way to reach ${who}.`,
      knownPlaces: [
        place(heir.street, heir.city, heir.state, heir.zip, 'their address on the filing'),
        place(lead.propertyAddress, lead.propertyCity, lead.propertyState, lead.propertyZip, `${claimant}'s property, ${d.county || ''} County, Florida`.trim()),
      ].filter(Boolean),
      knownRelatives: [
        `${claimant} (${heir.relationship ? `their ${String(heir.relationship).toLowerCase()} is this person` : 'the claimant'})`,
        ...(d.heirs || []).filter((h: any) => h.id !== heir.id).map((h: any) => (h.relationship ? `${h.name} (${String(h.relationship).toLowerCase()} of ${claimant})` : h.name)),
      ].slice(0, 10),
      alreadyRejected: (d.socialProfiles || [])
        .filter((p: any) => p.heirId === heir.id && p.status === SurplusSocialProfileStatus.REJECTED)
        .map((p: any) => p.url),
    };
  }

  /**
   * File the candidates, stamp the person searched, log the attempt. A URL
   * already on the claim is left as it is: a rejection is remembered and a
   * confirmation is not downgraded to a candidate.
   */
  private async apply(lead: any, heir: any | null, who: string, v: SocialVerdict, cost: number, userId: string | null): Promise<number> {
    const d = lead.surplusDetail;
    const have = new Set((d.socialProfiles || []).map((p: any) => p.url));
    let added = 0;
    for (const p of v.profiles) {
      if (have.has(p.url)) continue;
      have.add(p.url);
      await this.prisma.surplusSocialProfile.create({
        data: {
          surplusDetailId: d.id,
          heirId: heir?.id || null,
          organizationId: lead.organizationId || null,
          platform: p.platform,
          url: p.url,
          handle: p.handle,
          displayName: p.displayName,
          status: SurplusSocialProfileStatus.CANDIDATE,
          confidence: p.confidence,
          evidence: p.evidence || null,
          foundBy: 'search',
        },
      });
      added += 1;
    }
    const now = new Date();
    // The leads go into the notes as well as the saved verdict: the notes are
    // what the next search (obituary, trace, a person on the phone) reads.
    const leadLine = v.leads.length
      ? `Web research on ${who} (${now.toISOString().slice(0, 10)}): ${v.leads.map((l) => `${l.kind} ${l.value}${l.detail ? ` (${l.detail})` : ''}`).join('; ')}. Unverified; use it to tell them from a namesake.`
      : null;
    if (heir) {
      await this.prisma.surplusHeir.update({
        where: { id: heir.id },
        data: {
          socialSearchedAt: now,
          ...(leadLine ? { callNotes: [heir.callNotes, leadLine].filter(Boolean).join('\n') } : {}),
        },
      });
    } else {
      await this.prisma.surplusDetail.update({
        where: { id: d.id },
        data: {
          socialSearchedAt: now,
          socialSearch: { ...v, cost, at: now.toISOString() } as any,
          ...(leadLine ? { callNotes: [d.callNotes, leadLine].filter(Boolean).join('\n') } : {}),
        },
      });
    }
    const summary = v.profiles.length
      ? `${v.profiles.length} profile${v.profiles.length === 1 ? '' : 's'} to check for ${who}: ${v.profiles.map((p) => `${platformLabel(p.platform)} (${p.confidence})`).join(', ')}. ${v.searched}`
      : `No profile found for ${who}${v.leads.length ? `, ${v.leads.length} lead${v.leads.length === 1 ? '' : 's'} to search Facebook with` : ''}. ${v.searched}${v.note ? ` ${v.note}` : ''}`;
    await this.prisma.surplusTraceAttempt.create({
      data: {
        surplusDetailId: d.id,
        heirId: heir?.id || null,
        organizationId: lead.organizationId || null,
        channel: SurplusTraceChannel.SOCIAL,
        source: 'Claude web search',
        result: v.profiles.length ? 'found' : 'nothing',
        summary: summary.slice(0, 500),
        cost: Math.round(cost * 100) / 100,
        ranAt: now,
        byUserId: userId,
      },
    });
    return added;
  }

  private async detailOf(leadId: string, organizationId?: string | null) {
    const d = await this.prisma.surplusDetail.findFirst({
      where: { leadId, ...(organizationId ? { organizationId } : {}) },
      select: { id: true, organizationId: true },
    });
    if (!d) throw new BadRequestException('Surplus lead not found');
    return d;
  }

  private async find(profileId: string, organizationId?: string | null) {
    const row = await this.prisma.surplusSocialProfile.findFirst({
      where: { id: profileId, ...(organizationId ? { organizationId } : {}) },
      include: {
        surplusDetail: { select: { id: true, leadId: true } },
        heir: { select: { id: true, name: true, contactStatus: true } },
      },
    });
    if (!row) throw new BadRequestException('That profile is not on file.');
    return row;
  }
}

/** A number on the claimant that is not on a do-not-call registry. */
function callable(l: any): boolean {
  const d = l.surplusDetail;
  const phones = [
    [l.sellerPhone, d.phone1Dnc],
    [d.phone2, d.phone2Dnc],
    [d.phone3, d.phone3Dnc],
    [d.phone4, d.phone4Dnc],
  ];
  return phones.some(([n, dnc]) => n && !dnc);
}

function place(street: string | null, city: string | null, state: string | null, zip: string | null, what: string): string | null {
  return street || city ? `${[street, city, [state, zip].filter(Boolean).join(' ')].filter(Boolean).join(', ')} (${what})` : null;
}

/** "2026-09", in the business's own time zone. */
function monthNY(d = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit' }).formatToParts(d);
  return `${parts.find((p) => p.type === 'year')?.value}-${parts.find((p) => p.type === 'month')?.value}`;
}

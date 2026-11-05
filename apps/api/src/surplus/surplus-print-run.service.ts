import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SURPLUS_CLAIMANT_LETTER_ROTATION, SURPLUS_TEMPLATE_KIND_LABEL, SurplusTemplateKind } from '@fast-homes/shared';
import { SurplusService } from './surplus.service';
import { SurplusTemplatesService } from './surplus-templates.service';
import { PrismaService } from '../prisma/prisma.service';
import { LobService } from '../lob/lob.service';
import { LOB_HTML_MAX, LobAddress, lobAddressFrom, lobLetterEvent, lobLetterHtml, lobReturnAddress, lobStatusLabel } from '../lob/lob.util';
import { DIG_DEEPER_BRAND } from '../common/company.constants';

/**
 * Letters as a print run.
 *
 * The course's letter cadence is the one touch that needs no team time: an
 * envelope every week or two to everyone with an address until somebody
 * replies, escalating to Priority Mail once three standard letters have
 * gone unanswered. In production on 2026-10-31, 878 claims had a letter due
 * and one had gone out, because each letter was its own page, its own
 * print, its own "Mailed" click.
 *
 * This builds every letter due as one run: the claimant first, then the
 * relatives in the outreach order, the claimant's letters rotating through
 * three texts by letter number so the second envelope does not repeat the
 * first. The page prints the whole run with a page break per letter, and
 * one "Mailed" click records every envelope with the template version on
 * the page and the postage as a claim expense.
 */

const PAGE = 200;
const MAX_PAGES = 25;
/** Letters rendered per run by default, and the most the page asks for. */
export const RUN_DEFAULT = 60;
export const RUN_MAX = 200;
const DEFAULT_CADENCE_DAYS = 14;
const DAY = 86_400_000;

export type MailType = 'standard' | 'priority' | 'fedex';
export const MAIL_TYPE_LABEL: Record<MailType, string> = {
  standard: 'Standard mail',
  priority: 'Priority Mail',
  fedex: 'FedEx',
};

/** One envelope the run should hold, before the letter is rendered. */
export interface PlannedEnvelope {
  leadId: string;
  heirId: string | null;
  claimant: string;
  recipientName: string;
  address: string;
  county: string | null;
  caseNumber: string | null;
  /** Which letter this is to this person: 1 for the first. */
  letterNumber: number;
  kind: SurplusTemplateKind;
  mailType: MailType;
  /** Why this envelope is in the run, for the strip above the letter. */
  why: string;
  /** The template's name, so the chooser can say which text goes out without a lookup. */
  kindLabel: string;
  /** Grok's docket review, 'A' or 'B', or null when the case is not rated. */
  rating: string | null;
  /** What the claimant stands to receive, for sorting the chooser. */
  netToClaimant: number | null;
  /** Days left to the team's cutoff, and whether that is under two months. */
  daysToCutoff: number | null;
  shortWindow: boolean;
}

/** What one letter needs to go through Lob: a print run letter, or one from the case's letter page. */
interface LobCandidate {
  leadId: string;
  heirId: string | null;
  recipientName: string;
  address: string | null;
  letterNumber: number;
  kind: SurplusTemplateKind;
  version: number;
  mailType: MailType;
  hasText: boolean;
  unfilled: string[];
  body: string;
  sender: { companyName: string; phone: string; website: string | null };
  propertyAddress: string;
}

/** An envelope the page chose, sent back to be rendered: the claim and the person on it. */
export interface RenderItem {
  leadId: string;
  heirId?: string | null;
}

export interface PrintRunPlan {
  generatedAt: Date;
  county: string | null;
  /** Every envelope due, unrendered, in board order. The page filters and picks. */
  envelopes: PlannedEnvelope[];
  total: number;
  cases: number;
  /** The most one render (one printed run) holds. */
  maxPerRun: number;
  postage: Record<MailType, number | null>;
}

export interface PrintRunLetter extends PlannedEnvelope {
  label: string;
  version: number;
  versionLabel: string;
  /** The county whose own text this letter uses, or null for the all-counties text. */
  templateCounty: string | null;
  hasText: boolean;
  body: string;
  unfilled: string[];
  sender: { companyName: string; phone: string; callerName: string; website: string | null };
  propertyAddress: string;
  today: string;
}

export interface PrintRun {
  generatedAt: Date;
  county: string | null;
  /** Letters due across the board (or the county), before the cap. */
  total: number;
  cases: number;
  toClaimants: number;
  toRelatives: number;
  /** The letters on this page. */
  letters: PrintRunLetter[];
  truncated: boolean;
  /** Dollars per envelope, by mail type, from the settings. Editable on the page. */
  postage: Record<MailType, number | null>;
}

export interface MailedItem {
  leadId: string;
  heirId?: string | null;
  kind: string;
  version?: number | null;
  recipientName?: string | null;
  address?: string | null;
  mailType?: string | null;
  trackingNumber?: string | null;
  letterNumber?: number | null;
}

function joinAddress(parts: (string | null | undefined)[]): string {
  return parts.map((p) => String(p || '').trim()).filter(Boolean).join(', ');
}

/** The claimant's own envelope address, where the clerk wrote to them, or the last address written to. */
export function claimantAddress(row: any): string | null {
  return (
    joinAddress([
      row.ownerMailingStreet,
      row.ownerMailingCity,
      [row.ownerMailingState, row.ownerMailingZip].filter(Boolean).join(' '),
      row.ownerMailingCountry,
    ]) ||
    row.letterMailedTo ||
    null
  );
}

export function kindLabel(kind: string): string {
  return (SURPLUS_TEMPLATE_KIND_LABEL as Record<string, string>)[kind] || kind;
}

/** Which text the nth letter to a claimant uses. The fourth starts over. */
export function claimantLetterKind(letterNumber: number): SurplusTemplateKind {
  const n = Math.max(1, Math.floor(letterNumber));
  return SURPLUS_CLAIMANT_LETTER_ROTATION[(n - 1) % SURPLUS_CLAIMANT_LETTER_ROTATION.length];
}

/**
 * The envelopes a board row is due, in the course's order: the claimant,
 * then the people on the case who can be written to, closest first.
 *
 * The row is the board's own (it came through surplus.list with letterDue
 * on), so the claim-level rules already hold: nobody has replied, the mail
 * has not come back, the file is not on hold or do-not-call. This decides
 * per PERSON: a relative written to last week is not written to again
 * this week, and a relative whose letter came back is not written to at all.
 */
export function envelopesFor(row: any, now = new Date()): PlannedEnvelope[] {
  const out: PlannedEnvelope[] = [];
  if (!row || row.heldAt) return out;
  const num = (v: any) => (v === null || v === undefined || !Number.isFinite(Number(v)) ? null : Number(v));
  const caseFacts = {
    rating: row.reviewRating ? String(row.reviewRating).toUpperCase() : null,
    netToClaimant: num(row.netToClaimant),
    daysToCutoff: num(row.daysToCutoff),
    shortWindow: !!row.shortWindow,
  };
  const cadence = Number(row.letterCadenceDays) || DEFAULT_CADENCE_DAYS;
  const letters: any[] = Array.isArray(row.letters) ? row.letters : [];
  const lettersTo = (heirId: string | null) =>
    letters
      .filter((l) => (l.heirId || null) === heirId)
      .sort((a, b) => new Date(b.mailedAt).getTime() - new Date(a.mailedAt).getTime());
  const dueSince = (last: any) =>
    !last || now.getTime() - new Date(last.mailedAt).getTime() >= cadence * DAY;

  // The claimant. A dead claimant is not written to: the estate's letters
  // go to the heirs, and those are the claim's letters.
  const estate = !!row.isDeceased;
  const address = claimantAddress(row);
  if (!estate && address) {
    const mine = lettersTo(null);
    if (!mine[0]?.returnedAt && dueSince(mine[0])) {
      const letterNumber = mine.length + 1;
      out.push({
        leadId: row.id,
        heirId: null,
        claimant: row.claimant,
        recipientName: row.claimant,
        address,
        county: row.county || null,
        caseNumber: row.caseNumber || null,
        letterNumber,
        kind: claimantLetterKind(letterNumber),
        // The course's rule: after three unanswered standard letters the next
        // one goes Priority, so it is actually opened.
        mailType: row.escalateMail ? 'priority' : 'standard',
        why: mine.length ? `Letter ${letterNumber}, last one ${Math.round((now.getTime() - new Date(mine[0].mailedAt).getTime()) / DAY)} days ago` : 'First letter',
        kindLabel: kindLabel(claimantLetterKind(letterNumber)),
        ...caseFacts,
      });
    }
  }

  // Everyone else on the case with somewhere to write. The clerk is a
  // county contact, not outreach, and never gets a run letter.
  const people: any[] = (Array.isArray(row.heirs) ? row.heirs : [])
    .filter((h) => h && !h.deceased && !h.doNotCall && h.address && h.role !== 'clerk')
    .sort((a, b) => (a.priority ?? 99) - (b.priority ?? 99) || String(a.name).localeCompare(String(b.name)));
  for (const h of people) {
    const mine = lettersTo(h.id);
    if (mine[0]?.returnedAt) continue;
    if (!dueSince(mine[0])) continue;
    const letterNumber = mine.length + 1;
    const kind = (h.priority ?? 5) <= 5 ? SurplusTemplateKind.LETTER_FAMILY : SurplusTemplateKind.LETTER_ASSOCIATE;
    out.push({
      leadId: row.id,
      heirId: h.id,
      claimant: row.claimant,
      recipientName: h.name,
      address: h.address,
      county: row.county || null,
      caseNumber: row.caseNumber || null,
      letterNumber,
      // Family hears a family letter; a neighbor or an associate the other.
      kind,
      mailType: 'standard',
      why: `${h.priorityLabel || h.roleLabel || 'Relative'}${mine.length ? `, letter ${letterNumber}` : ', first letter'}`,
      kindLabel: kindLabel(kind),
      ...caseFacts,
    });
  }
  return out;
}

@Injectable()
export class SurplusPrintRunService {
  private readonly logger = new Logger(SurplusPrintRunService.name);

  constructor(
    private config: ConfigService,
    private surplus: SurplusService,
    private templates: SurplusTemplatesService,
    private lob?: LobService,
    private prisma?: PrismaService,
  ) {}

  /** Dollars per envelope by mail type. Unset means the page has to be told. */
  postage(): Record<MailType, number | null> {
    const read = (key: string, fallback: number | null) => {
      const raw = this.config.get<string>(key);
      if (raw === undefined || raw === null || String(raw).trim() === '') return fallback;
      const n = Number(raw);
      return Number.isFinite(n) && n >= 0 ? n : fallback;
    };
    return {
      standard: read('SURPLUS_POSTAGE_STANDARD', 0.78),
      priority: read('SURPLUS_POSTAGE_PRIORITY', 10.4),
      fedex: read('SURPLUS_POSTAGE_FEDEX', null),
    };
  }

  /** Every envelope due, across the board or one county, in board order. */
  async due(opts: { organizationId?: string | null; county?: string | null; now?: Date }) {
    const now = opts.now || new Date();
    const filters: any = {
      organizationId: opts.organizationId || null,
      group: 'lead',
      pageSize: PAGE,
      letterDue: true,
      hideEarly: true,
      hideDead: true,
      ...(opts.county ? { county: opts.county } : {}),
    };
    const envelopes: PlannedEnvelope[] = [];
    let cases = 0;
    for (let page = 1; page <= MAX_PAGES; page++) {
      const res: any = await this.surplus.list({ ...filters, page });
      for (const row of res.data || []) {
        const mine = envelopesFor(row, now);
        if (mine.length) cases += 1;
        envelopes.push(...mine);
      }
      if (page * res.pageSize >= res.total) break;
    }
    return { envelopes, cases };
  }

  /**
   * Every envelope due, unrendered, so the page can filter and pick. Cheap
   * next to a render: no template is filled until the team has chosen.
   */
  async plan(opts: { organizationId?: string | null; county?: string | null; now?: Date }): Promise<PrintRunPlan> {
    const { envelopes, cases } = await this.due(opts);
    return {
      generatedAt: opts.now || new Date(),
      county: opts.county || null,
      envelopes,
      total: envelopes.length,
      cases,
      maxPerRun: RUN_MAX,
      postage: this.postage(),
    };
  }

  /** One envelope filled from the active template, or null when the claim is gone. */
  private async renderOne(env: PlannedEnvelope, organizationId?: string | null, userId?: string | null): Promise<PrintRunLetter | null> {
    const r = await this.templates.letterFor(env.leadId, env.kind, env.heirId, organizationId, userId);
    if (!r) return null;
    return {
      ...env,
      // The template's own idea of the recipient and the address, which
      // is the same source the envelope was planned from.
      recipientName: r.recipient.name || env.recipientName,
      address: r.recipient.address || env.address,
      label: r.label,
      version: r.version,
      versionLabel: r.versionLabel,
      templateCounty: r.templateCounty ?? null,
      hasText: r.hasText,
      body: r.body,
      unfilled: r.unfilled,
      sender: r.sender,
      propertyAddress: r.propertyAddress,
      today: r.today,
    };
  }

  /**
   * Render the envelopes the page chose. The plan is re-read so a letter
   * that stopped being due since the page loaded (somebody replied, the
   * mail came back, another run already mailed it) is left out and named,
   * rather than printed twice.
   */
  async render(
    body: { items?: RenderItem[]; county?: string | null } | null,
    organizationId?: string | null,
    userId?: string | null,
    now?: Date,
  ): Promise<PrintRun & { notDue: { leadId: string; heirId: string | null }[] }> {
    const items = Array.isArray(body?.items) ? body!.items.filter((i) => i && typeof i.leadId === 'string') : [];
    if (!items.length) throw new BadRequestException('Pick at least one letter for the run.');
    if (items.length > RUN_MAX) throw new BadRequestException(`One run is at most ${RUN_MAX} letters. Pick fewer, print them, then build the next run.`);
    const { envelopes, cases } = await this.due({ organizationId, county: body?.county || null, now });
    const keyOf = (leadId: string, heirId: string | null | undefined) => `${leadId}:${heirId || ''}`;
    const byKey = new Map(envelopes.map((e) => [keyOf(e.leadId, e.heirId), e]));
    const letters: PrintRunLetter[] = [];
    const notDue: { leadId: string; heirId: string | null }[] = [];
    const seen = new Set<string>();
    for (const item of items) {
      const k = keyOf(item.leadId, item.heirId);
      if (seen.has(k)) continue;
      seen.add(k);
      const env = byKey.get(k);
      if (!env) {
        notDue.push({ leadId: item.leadId, heirId: item.heirId || null });
        continue;
      }
      try {
        const letter = await this.renderOne(env, organizationId, userId);
        if (letter) letters.push(letter);
      } catch (err: any) {
        this.logger.warn(`Print run skipped a letter to ${env.recipientName} on ${env.leadId}: ${err?.message || err}`);
      }
    }
    return {
      generatedAt: now || new Date(),
      county: body?.county || null,
      total: envelopes.length,
      cases,
      toClaimants: letters.filter((e) => !e.heirId).length,
      toRelatives: letters.filter((e) => !!e.heirId).length,
      letters,
      truncated: false,
      postage: this.postage(),
      notDue,
    };
  }

  /** The run: the first `max` envelopes due, rendered from the active templates. */
  async build(opts: {
    organizationId?: string | null;
    county?: string | null;
    max?: number | null;
    userId?: string | null;
    now?: Date;
  }): Promise<PrintRun> {
    const max = Math.min(RUN_MAX, Math.max(1, Math.floor(Number(opts.max) || RUN_DEFAULT)));
    const { envelopes, cases } = await this.due(opts);
    const letters: PrintRunLetter[] = [];
    for (const env of envelopes.slice(0, max)) {
      try {
        const letter = await this.renderOne(env, opts.organizationId, opts.userId);
        if (letter) letters.push(letter);
      } catch (err: any) {
        this.logger.warn(`Print run skipped a letter to ${env.recipientName} on ${env.leadId}: ${err?.message || err}`);
      }
    }
    return {
      generatedAt: opts.now || new Date(),
      county: opts.county || null,
      total: envelopes.length,
      cases,
      toClaimants: envelopes.filter((e) => !e.heirId).length,
      toRelatives: envelopes.filter((e) => !!e.heirId).length,
      letters,
      truncated: envelopes.length > max,
      postage: this.postage(),
    };
  }

  /**
   * The run went out. Each envelope is written to its claim's letter history
   * with the template version that was on the page, the follow-up task the
   * single letter opens, and the postage as a claim expense.
   */
  async mailed(
    body: { items: MailedItem[]; postage?: Partial<Record<MailType, number | null>> | null; mailedAt?: string | null; note?: string | null },
    organizationId?: string | null,
    userId?: string | null,
  ) {
    const items = Array.isArray(body?.items) ? body.items.filter((i) => i && i.leadId && i.kind) : [];
    if (!items.length) throw new BadRequestException('Nothing to mark mailed.');
    if (items.length > RUN_MAX) throw new BadRequestException(`One run is at most ${RUN_MAX} letters.`);
    const postage: Record<MailType, number | null> = { ...this.postage(), ...(body.postage || {}) };
    for (const k of Object.keys(postage) as MailType[]) {
      const v = postage[k];
      if (v !== null && v !== undefined && (!Number.isFinite(Number(v)) || Number(v) < 0)) {
        throw new BadRequestException(`The ${MAIL_TYPE_LABEL[k]} postage is not a number.`);
      }
    }
    const dateLabel = (body.mailedAt && String(body.mailedAt)) || new Date().toISOString().slice(0, 10);

    let mailed = 0;
    let postageTotal = 0;
    const byType: Record<string, number> = {};
    const failed: { leadId: string; recipientName: string | null; error: string }[] = [];
    for (const item of items) {
      const mailType = (['standard', 'priority', 'fedex'].includes(String(item.mailType || '')) ? item.mailType : 'standard') as MailType;
      try {
        const res = await this.surplus.markLetterMailed(
          [item.leadId],
          {
            mailedAt: body.mailedAt || null,
            heirId: item.heirId || null,
            templateKind: item.kind,
            templateVersion: item.version ?? null,
            recipientName: item.recipientName || null,
            address: item.address || null,
            mailType,
            trackingNumber: item.trackingNumber || null,
            note: [`Print run ${dateLabel}`, body.note ? String(body.note).trim() : null].filter(Boolean).join('. '),
          },
          userId,
          organizationId,
        );
        if (!res?.updated) {
          failed.push({ leadId: item.leadId, recipientName: item.recipientName || null, error: 'not a surplus lead' });
          continue;
        }
        mailed += 1;
        byType[mailType] = (byType[mailType] || 0) + 1;
        const cost = Number(postage[mailType] ?? 0);
        if (cost > 0) {
          await this.surplus.addExpense(
            item.leadId,
            {
              kind: 'postage',
              amount: cost,
              incurredAt: body.mailedAt || null,
              note: `Print run ${dateLabel}: letter${item.letterNumber ? ` ${item.letterNumber}` : ''} to ${item.recipientName || 'the claimant'}${
                mailType !== 'standard' ? ` by ${MAIL_TYPE_LABEL[mailType]}` : ''
              }`,
            },
            organizationId,
            userId,
          );
          postageTotal += cost;
        }
      } catch (err: any) {
        failed.push({ leadId: item.leadId, recipientName: item.recipientName || null, error: err?.message || String(err) });
      }
    }
    return { mailed, byType, postageTotal: Math.round(postageTotal * 100) / 100, failed };
  }

  /** Live Lob letters this calendar month (UTC), against the account's monthly limit. */
  private async lobSentThisMonth(now: Date): Promise<number> {
    if (!this.prisma) return 0;
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    return this.prisma.surplusLetter.count({ where: { lobLetterId: { not: null }, createdAt: { gte: start } } });
  }

  /** Whether the page offers Send through Lob, in which mode, and how much of the month is left. */
  async lobState(now = new Date()) {
    const mode = this.lob?.mode() || null;
    if (!this.lob || !mode) return { configured: false as const, mode: null, monthlyLimit: null, sentThisMonth: 0, remaining: null, cost: null };
    const limit = this.lob.monthlyLimit();
    const sent = mode === 'live' ? await this.lobSentThisMonth(now) : 0;
    return {
      configured: true as const,
      mode,
      monthlyLimit: limit,
      sentThisMonth: sent,
      remaining: Math.max(0, limit - sent),
      cost: this.lob.letterCost(),
      returnAddress: !!lobReturnAddress(DIG_DEEPER_BRAND.companyName, DIG_DEEPER_BRAND.address),
    };
  }

  /** Lob is set up with a secret key, and the return address reads as a US address. */
  private lobReady(): { lob: LobService; mode: 'test' | 'live'; from: LobAddress } {
    const lob = this.lob;
    const mode = lob?.mode() || null;
    if (!lob || !mode) throw new BadRequestException('Lob is not set up. Put the secret API key in LOB_API_KEY on the API service.');
    const from = lobReturnAddress(DIG_DEEPER_BRAND.companyName, DIG_DEEPER_BRAND.address);
    if (!from) throw new BadRequestException('The return address on the company record could not be read as a US address.');
    return { lob, mode, from };
  }

  /** The envelope and the page Lob would print, or why this letter cannot go through Lob. */
  private lobPrepare(l: LobCandidate): { to: LobAddress; html: string } | { reason: string } {
    if (!l.hasText) return { reason: 'no template text' };
    if (l.unfilled.length) return { reason: `could not fill ${l.unfilled.join(', ')}` };
    if (l.mailType !== 'standard') return { reason: `${MAIL_TYPE_LABEL[l.mailType]} stays on paper, Lob has no Priority Mail` };
    const to = lobAddressFrom(l.recipientName, l.address || '');
    if ('reason' in to) return { reason: to.reason };
    const html = lobLetterHtml({
      companyName: l.sender.companyName,
      phone: l.sender.phone,
      website: l.sender.website,
      propertyAddress: l.propertyAddress,
      body: l.body,
    });
    if (html.length > LOB_HTML_MAX) return { reason: `the letter is longer than Lob takes in one file (${LOB_HTML_MAX.toLocaleString()} characters)` };
    return { to: to.address, html };
  }

  /**
   * One letter to Lob. A test key stops at the proof. A live key records it
   * on the claim exactly as a printed letter is (history, reply task, note,
   * postage), carrying Lob's letter id for the tracking webhooks.
   *
   * The idempotency key makes the same envelope asked twice in a day one
   * letter at Lob, from the print run or the letter page alike; when that
   * letter is already in the history it is not recorded twice.
   */
  private async lobDeliver(
    l: LobCandidate,
    prepared: { to: LobAddress; html: string },
    ctx: { lob: LobService; mode: 'test' | 'live'; from: LobAddress; day: string; organizationId?: string | null; userId?: string | null },
  ): Promise<
    | { ok: true; lobLetterId: string; url: string | null; expectedDeliveryDate: string | null; cost: number; already: boolean }
    | { ok: false; error: string; lobLetterId?: string | null }
  > {
    let created: Awaited<ReturnType<LobService['createLetter']>>;
    try {
      created = await ctx.lob.createLetter({
        to: prepared.to,
        from: ctx.from,
        html: prepared.html,
        description: `Surplus letter ${l.letterNumber}${l.heirId ? ' to a relative' : ''}`,
        metadata: { leadId: l.leadId, ...(l.heirId ? { heirId: l.heirId } : {}), letter: String(l.letterNumber), kind: l.kind },
        idempotencyKey: ['dealcore', ctx.mode, l.leadId, l.heirId || 'claimant', l.letterNumber, l.kind, l.version, ctx.day].join(':'),
      });
    } catch (err: any) {
      return { ok: false, error: err?.message || String(err) };
    }
    const done = { ok: true as const, lobLetterId: created.id, url: created.url, expectedDeliveryDate: created.expectedDeliveryDate };
    if (ctx.mode === 'test') return { ...done, cost: 0, already: false };
    try {
      const existing = this.prisma ? await this.prisma.surplusLetter.findUnique({ where: { lobLetterId: created.id } }) : null;
      if (existing) return { ...done, cost: 0, already: true };
      const res = await this.surplus.markLetterMailed(
        [l.leadId],
        {
          heirId: l.heirId || null,
          templateKind: l.kind,
          templateVersion: l.version ?? null,
          recipientName: l.recipientName,
          address: l.address,
          mailType: 'standard',
          note: `Sent through Lob ${ctx.day}`,
          lob: {
            letterId: created.id,
            expectedDeliveryAt: created.expectedDeliveryDate ? new Date(`${created.expectedDeliveryDate.slice(0, 10)}T12:00:00Z`) : null,
          },
        },
        ctx.userId,
        ctx.organizationId,
      );
      if (!res?.updated) throw new Error('not a surplus lead');
      const cost = ctx.lob.letterCost();
      if (cost > 0) {
        await this.surplus.addExpense(
          l.leadId,
          { kind: 'postage', amount: cost, incurredAt: null, note: `Lob ${ctx.day}: letter ${l.letterNumber} to ${l.recipientName}` },
          ctx.organizationId,
          ctx.userId,
        );
      }
      return { ...done, cost: Math.max(0, cost), already: false };
    } catch (err: any) {
      // Lob has it and will mail it. Say so, so nobody prints it as well.
      this.logger.error(`Lob letter ${created.id} for ${l.leadId} was created but not recorded: ${err?.message || err}`);
      return { ok: false, lobLetterId: created.id, error: `Lob is mailing it (${created.id}) but it was not recorded on the claim: ${err?.message || err}` };
    }
  }

  /**
   * Send the letters the page chose through Lob instead of the printer.
   *
   * The picks are rendered again here, from the active templates, so what
   * Lob prints is what the server holds and a letter that stopped being due
   * since the page loaded is not sent. Priority Mail stays on paper: Lob has
   * no Priority, and the course's point of the fourth letter is that it is
   * different.
   *
   * A test key makes proofs: Lob renders each letter as a PDF and mails
   * nothing, and nothing is written to the claims. A live key mails, and
   * each letter goes into the claim's history exactly as a printed one does.
   */
  async sendViaLob(
    body: { items?: RenderItem[]; county?: string | null } | null,
    organizationId?: string | null,
    userId?: string | null,
    now = new Date(),
  ) {
    const { lob, mode, from } = this.lobReady();

    const run = await this.render(body, organizationId, userId, now);
    type Out = { leadId: string; heirId: string | null; recipientName: string; letterNumber: number };
    const sent: (Out & { lobLetterId: string; url: string | null; expectedDeliveryDate: string | null })[] = [];
    const heldBack: (Out & { reason: string })[] = [];
    const failed: (Out & { error: string; lobLetterId?: string | null })[] = [];
    const out = (l: PrintRunLetter): Out => ({ leadId: l.leadId, heirId: l.heirId, recipientName: l.recipientName, letterNumber: l.letterNumber });

    const ready: { letter: PrintRunLetter; prepared: { to: LobAddress; html: string } }[] = [];
    for (const l of run.letters) {
      const prepared = this.lobPrepare(l);
      if ('reason' in prepared) heldBack.push({ ...out(l), reason: prepared.reason });
      else ready.push({ letter: l, prepared });
    }

    // The Developer edition stops at 500 a month. Past the cap the rest wait
    // for next month or the printer, rather than failing one by one at Lob.
    let queue = ready;
    if (mode === 'live') {
      const remaining = Math.max(0, lob.monthlyLimit() - (await this.lobSentThisMonth(now)));
      for (const r of ready.slice(remaining)) heldBack.push({ ...out(r.letter), reason: `over the ${lob.monthlyLimit()} a month Lob allows` });
      queue = ready.slice(0, remaining);
    }

    const ctx = { lob, mode, from, day: now.toISOString().slice(0, 10), organizationId, userId };
    let postageTotal = 0;
    // A few at a time: Lob renders each one, and a run can be 200 letters.
    const pool = [...queue];
    const workers = Array.from({ length: Math.min(4, pool.length) }, async () => {
      for (let next = pool.shift(); next; next = pool.shift()) {
        const r = await this.lobDeliver(next.letter, next.prepared, ctx);
        if ('error' in r) {
          failed.push({ ...out(next.letter), error: r.error, lobLetterId: r.lobLetterId ?? null });
        } else {
          postageTotal += r.cost;
          sent.push({ ...out(next.letter), lobLetterId: r.lobLetterId, url: r.url, expectedDeliveryDate: r.expectedDeliveryDate });
        }
      }
    });
    await Promise.all(workers);

    return {
      mode,
      sent,
      heldBack,
      failed,
      notDue: run.notDue,
      postageTotal: Math.round(postageTotal * 100) / 100,
    };
  }

  /**
   * One letter from the case's letter page, to the claimant or a person on
   * the case, through Lob. Not limited to letters due: writing one letter is
   * the team's own call, the same as printing it. The server builds the text
   * from the template and the person on file, so Lob prints what the page
   * shows, and the same checks as the print run apply.
   */
  async sendOneViaLob(
    leadId: string,
    body: { kind?: string | null; heirId?: string | null; mailType?: string | null } | null,
    organizationId?: string | null,
    userId?: string | null,
    now = new Date(),
  ) {
    const { lob, mode, from } = this.lobReady();
    const kind = String(body?.kind || '');
    if (!kind.startsWith('letter')) throw new BadRequestException('Pick a letter to send.');
    const mailType = (['standard', 'priority', 'fedex'].includes(String(body?.mailType || 'standard')) ? body?.mailType || 'standard' : 'standard') as MailType;
    const r = await this.templates.letterFor(leadId, kind, body?.heirId || null, organizationId, userId);
    if (!r) throw new BadRequestException('Surplus lead not found');
    const heirId = r.recipient.heirId || null;

    // Which letter this is to this person, for the history and Lob's record.
    const before = this.prisma
      ? await this.prisma.surplusLetter.count({ where: { surplusDetail: { leadId }, heirId } })
      : 0;
    const letter: LobCandidate = {
      leadId,
      heirId,
      recipientName: r.recipient.name,
      address: r.recipient.address,
      letterNumber: before + 1,
      kind: r.kind as SurplusTemplateKind,
      version: r.version,
      mailType,
      hasText: r.hasText,
      unfilled: r.unfilled,
      body: r.body,
      sender: r.sender,
      propertyAddress: r.propertyAddress,
    };
    const prepared = this.lobPrepare(letter);
    if ('reason' in prepared) throw new BadRequestException(`Lob cannot take this letter: ${prepared.reason}.`);
    if (mode === 'live' && lob.monthlyLimit() - (await this.lobSentThisMonth(now)) <= 0) {
      throw new BadRequestException(`This month's ${lob.monthlyLimit()} Lob letters are used. Print this one instead.`);
    }
    const res = await this.lobDeliver(letter, prepared, { lob, mode, from, day: now.toISOString().slice(0, 10), organizationId, userId });
    if ('error' in res) {
      if (res.lobLetterId) return { mode, ok: false as const, lobLetterId: res.lobLetterId, error: res.error };
      throw new BadRequestException(`Lob did not take the letter: ${res.error}`);
    }
    return {
      mode,
      ok: true as const,
      lobLetterId: res.lobLetterId,
      url: res.url,
      expectedDeliveryDate: res.expectedDeliveryDate,
      postage: res.cost,
      alreadyRecorded: res.already,
      letterNumber: letter.letterNumber,
      recipientName: letter.recipientName,
    };
  }

  /**
   * One Lob webhook event, already verified. Lob tracks the envelope through
   * the post: the step lands on the letter, a delivery dates it, a return
   * marks it returned exactly as the team's own Returned button does, and a
   * letter cancelled at Lob before it printed comes out of the history.
   * Events for letters Dealcore never recorded (test proofs) are ignored.
   */
  async applyLobEvent(event: any): Promise<{ applied: boolean; reason?: string }> {
    const { step, event: what } = lobLetterEvent(event?.event_type?.id);
    if (what.kind === 'ignore') return { applied: false, reason: 'not a letter tracking event' };
    const ref = String(event?.reference_id || event?.body?.id || '');
    if (!ref || !this.prisma) return { applied: false, reason: 'no letter id' };
    const letter = await this.prisma.surplusLetter.findUnique({
      where: { lobLetterId: ref },
      include: { surplusDetail: { select: { leadId: true } } },
    });
    if (!letter) return { applied: false, reason: 'letter not in Dealcore' };
    const at = event?.date_created ? new Date(event.date_created) : new Date();
    const when = Number.isNaN(at.getTime()) ? new Date() : at;
    const leadId = letter.surplusDetail.leadId;
    const log = (content: string) =>
      letter.sentByUserId
        ? this.prisma!.note.create({ data: { leadId, userId: letter.sentByUserId, content } })
        : this.prisma!.activity.create({ data: { leadId, type: 'LETTER_TRACKING', description: content } });
    const to = letter.recipientName ? ` to ${letter.recipientName}` : '';

    if (what.kind === 'cancelled') {
      await this.surplus.removeLetter(letter.id, null);
      await log(`Lob letter ${ref}${to} was cancelled before it was mailed and is out of the letter history. Its postage expense is still on the claim.`);
      return { applied: true };
    }
    if (what.kind === 'returned') {
      if (!letter.returnedAt) await this.surplus.markLetterReturned(letter.id, true, null, letter.sentByUserId || null);
      await this.prisma.surplusLetter.update({ where: { id: letter.id }, data: { lobStatus: step, lobEventAt: when } });
      return { applied: true };
    }
    // Lob retries and can deliver out of order. An older step never
    // overwrites a newer one, and nothing comes after delivered or returned.
    const final = letter.lobStatus === 'delivered' || letter.lobStatus === 'returned_to_sender';
    const older = letter.lobEventAt && when.getTime() < letter.lobEventAt.getTime();
    const data: any = {};
    if (!final && !older) Object.assign(data, { lobStatus: step, lobEventAt: when });
    if (what.kind === 'delivered' && !letter.deliveredAt) Object.assign(data, { deliveredAt: when, lobStatus: step, lobEventAt: when });
    if (Object.keys(data).length) await this.prisma.surplusLetter.update({ where: { id: letter.id }, data });
    if (what.kind === 'failed') {
      await log(`Lob could not mail letter ${ref}${to} (${lobStatusLabel(step)}). It needs to go out another way.`);
    }
    return { applied: Object.keys(data).length > 0 };
  }

  /** One line for the Daily Brief, or null when nothing is due. */
  async briefLine(organizationId?: string | null): Promise<{ letters: number; cases: number; line: string } | null> {
    try {
      const { envelopes, cases } = await this.due({ organizationId });
      if (!envelopes.length) return null;
      const toClaimants = envelopes.filter((e) => !e.heirId).length;
      const toRelatives = envelopes.length - toClaimants;
      const priority = envelopes.filter((e) => e.mailType === 'priority').length;
      const parts = [
        `${envelopes.length} letter${envelopes.length === 1 ? '' : 's'} due across ${cases} case${cases === 1 ? '' : 's'}`,
        `${toClaimants} to claimants and ${toRelatives} to relatives`,
        priority ? `${priority} go Priority Mail after three unanswered` : null,
      ].filter(Boolean);
      return { letters: envelopes.length, cases, line: `${parts.join(', ')}. Print the run and mark it mailed in one click.` };
    } catch (err: any) {
      this.logger.warn(`Print run brief line skipped: ${err?.message || err}`);
      return null;
    }
  }
}

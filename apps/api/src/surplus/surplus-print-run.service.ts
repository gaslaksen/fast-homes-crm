import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SURPLUS_CLAIMANT_LETTER_ROTATION, SurplusTemplateKind } from '@fast-homes/shared';
import { SurplusService } from './surplus.service';
import { SurplusTemplatesService } from './surplus-templates.service';

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
}

export interface PrintRunLetter extends PlannedEnvelope {
  label: string;
  version: number;
  versionLabel: string;
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
      kind: (h.priority ?? 5) <= 5 ? SurplusTemplateKind.LETTER_FAMILY : SurplusTemplateKind.LETTER_ASSOCIATE,
      mailType: 'standard',
      why: `${h.priorityLabel || h.roleLabel || 'Relative'}${mine.length ? `, letter ${letterNumber}` : ', first letter'}`,
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
        const r = await this.templates.letterFor(env.leadId, env.kind, env.heirId, opts.organizationId, opts.userId);
        if (!r) continue;
        letters.push({
          ...env,
          // The template's own idea of the recipient and the address, which
          // is the same source the envelope was planned from.
          recipientName: r.recipient.name || env.recipientName,
          address: r.recipient.address || env.address,
          label: r.label,
          version: r.version,
          versionLabel: r.versionLabel,
          hasText: r.hasText,
          body: r.body,
          unfilled: r.unfilled,
          sender: r.sender,
          propertyAddress: r.propertyAddress,
          today: r.today,
        });
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

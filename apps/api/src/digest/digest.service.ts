import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LeadSource, SurplusStage, surplusCallConnected } from '@fast-homes/shared';
import { PrismaService } from '../prisma/prisma.service';
import { SurplusService } from '../surplus/surplus.service';
import { SurplusIngestService } from '../surplus/surplus-ingest.service';
import { SurplusOutreachService } from '../surplus/surplus-outreach.service';
import { TOUCH_EVERY_DAYS } from '../surplus/surplus-windows.util';
import { estFee, SurplusLien } from '../surplus/surplus.util';
import { describeCountyListDue, describeFeed, summarizeHealthyFeeds } from './digest-feeds.util';
import { todayNoonUtc } from '../surplus/surplus-county-lists.util';
import {
  BigThing,
  BoardTile,
  CallRow,
  DigestBrief,
  DigestUrgency,
  FeedRow,
  InFlightRow,
  PromiseRow,
} from './digest.types';

/** Matches dashboard.service.ts. Leads in these statuses are out of pipeline. */
const INACTIVE = ['SOLD', 'SOLD_LOSS', 'HELD_LONG_TERM', 'CANCELLED', 'CLOSED_LOST', 'DEAD'];

/** Contract statuses that are still live work. */
const OPEN_CONTRACT = ['draft', 'signed', 'inspection', 'past-inspection', 'at-title'];

/** Foreclosure sale dates far enough out to work, for the wholesale line. */
const FORECLOSURE_MIN_WORKABLE_DAYS = 14;
const FORECLOSURE_MAX_WATCH_DAYS = 75;

/** Surplus claimants show in the brief only once the lien window has closed. */
const SURPLUS_LIEN_WINDOW_DAYS = 120;

/** Surplus calls a day the team is aiming for. The scorecard measures against it. */
const SURPLUS_DAILY_CALL_TARGET = 25;

/** People listed under the big thing. The rest are one link away on the board. */
const CALL_LIST_SIZE = 5;

/** Rows in Promises due before it folds into a "+N more" line. */
const PROMISE_LIST_SIZE = 8;

/** Signed through check in hand: the claims that are ours and still moving. */
const IN_FLIGHT_STAGES: string[] = [
  SurplusStage.AGREEMENT_SIGNED,
  SurplusStage.PACKAGE_NOTARIZED,
  SurplusStage.CLAIM_FILED,
  SurplusStage.AWAITING_DISBURSEMENT,
  SurplusStage.CHECK_RECEIVED,
];

/** Name suffixes that mean "Smith, Jr" is not "Jr Smith". */
const NAME_SUFFIX = /^(LLC|L\.L\.C\.|INC|CORP|CO|LP|LLP|LTD|TRUST|ESTATE|JR|SR|II|III|IV)\b/i;

const TZ = 'America/New_York';
const DAY = 24 * 60 * 60 * 1000;

/** One person on the call list, with every case they are owed on. */
interface CallPerson {
  key: string;
  name: string;
  county: string | null;
  /** One record per case, deduplicated across repeat lead records. */
  cases: any[];
  gross: number;
  net: number;
  likely: boolean;
  cleanPhones: number;
  phone: string | null;
  url: string;
  denied: boolean;
}

@Injectable()
export class DigestService {
  private readonly logger = new Logger(DigestService.name);

  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
    private surplusService: SurplusService,
    private surplusIngest: SurplusIngestService,
    private outreach: SurplusOutreachService,
  ) {}

  private get appUrl(): string {
    return (this.config.get<string>('FRONTEND_URL') || 'http://localhost:3000')
      .split(',')[0]
      .trim()
      .replace(/\/$/, '');
  }

  /**
   * Where a lead opens in the app. A surplus claimant is worked on the case
   * panel, which /surplus-funds?lead= opens with the hiding filters off. The
   * wholesale lead page offers Send Initial Text and Resume AI, and either
   * one can start automated outreach to a claimant by accident.
   */
  leadUrl(id: string, source: string | null | undefined): string {
    if (source === LeadSource.SURPLUS) return `${this.appUrl}/surplus-funds?lead=${id}`;
    return `${this.appUrl}/leads/${id}`;
  }

  // ── Formatting helpers ───────────────────────────────────────────────────

  private fmtDate(d: Date): string {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: TZ, weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
    }).format(d);
  }

  private fmtTime(d: Date): string {
    return `${new Intl.DateTimeFormat('en-US', {
      timeZone: TZ, hour: 'numeric', minute: '2-digit',
    }).format(d)} ET`;
  }

  /** "Mon 7/27" */
  private fmtShortDate(d: Date): string {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: TZ, weekday: 'short', month: 'numeric', day: 'numeric',
    }).format(d).replace(',', '');
  }

  /** "$18,000" */
  private money(n: number | null | undefined): string {
    if (n == null || !isFinite(n)) return '-';
    return `$${Math.round(n).toLocaleString('en-US')}`;
  }

  /** "$71.5K" for the tight metric tiles. */
  private moneyCompact(n: number | null | undefined): string {
    if (n == null || !isFinite(n)) return '$0';
    const abs = Math.abs(n);
    if (abs >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
    if (abs >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
    return `$${Math.round(n)}`;
  }

  private plural(n: number, one: string, many = `${one}s`): string {
    return `${n} ${n === 1 ? one : many}`;
  }

  /** Days until a claimant at this notice age clears the lien window. */
  private daysToOpen(noticeAge: number): number {
    return Math.max(1, SURPLUS_LIEN_WINDOW_DAYS + 1 - noticeAge);
  }

  /**
   * "3 more surplus claimants open up in the next 30 days, $212.4K between
   * them. Next: TINA FORTNER in 4 days." Rows arrive soonest first.
   */
  private openingSoonNote(rows: any[]): string {
    const total = rows.reduce((s, c) => s + (c.grossSurplus || 0), 0);
    const next = rows[0];
    const days = this.daysToOpen(next.noticeAge);
    return `${this.plural(rows.length, 'claimant')} clear${rows.length === 1 ? 's' : ''} the lien window in the next 30 days, ${this.moneyCompact(total)} between them. First: ${this.displayName(next.claimant)}, ${days === 1 ? 'tomorrow' : `in ${days} days`}.`;
  }

  /** "10h 16m", "3d 4h", "22m" */
  private fmtWait(ms: number): string {
    const mins = Math.max(0, Math.floor(ms / 60000));
    if (mins < 60) return `${mins}m`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ${String(mins % 60).padStart(2, '0')}m`;
    return `${Math.floor(hours / 24)}d ${hours % 24}h`;
  }

  /** "(888) 574-8121" from any 10 or 11 digit form. */
  private fmtPhone(raw: string | null | undefined): string | null {
    const digits = String(raw ?? '').replace(/[^0-9]/g, '');
    const ten = digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
    if (ten.length !== 10) return raw ? String(raw) : null;
    return `(${ten.slice(0, 3)}) ${ten.slice(3, 6)}-${ten.slice(6)}`;
  }

  /** "Good morning" / "Good afternoon" / "Good evening" in the org timezone. */
  private greeting(now: Date): string {
    const hour = Number(
      new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: 'numeric', hour12: false }).format(now),
    );
    if (hour < 12) return 'Good morning';
    if (hour < 18) return 'Good afternoon';
    return 'Good evening';
  }

  private truncate(s: string | null | undefined, max = 92): string {
    const clean = (s || '').replace(/\s+/g, ' ').trim();
    if (clean.length <= max) return clean;
    return `${clean.slice(0, max - 1).trimEnd()}...`;
  }

  private place(l: { propertyAddress?: string | null; propertyCity?: string | null }): string {
    return [l.propertyAddress, l.propertyCity].filter(Boolean).join(', ');
  }

  /**
   * County records arrive as "Garcia, Douglas" or "PRISCILLA A BURPEE". The
   * brief reads them as a person would say them: "Douglas Garcia", "Priscilla
   * A Burpee". "Smith, Jr" and "Acme Holdings, LLC" keep their order.
   */
  displayName(raw: string | null | undefined): string {
    const s = String(raw ?? '').replace(/\s+/g, ' ').trim();
    if (!s) return 'Unknown claimant';
    const m = /^([^,]+),\s*(.+)$/.exec(s);
    const ordered = m && !NAME_SUFFIX.test(m[2]) ? `${m[2]} ${m[1]}` : s;
    if (ordered !== ordered.toUpperCase()) return ordered;
    return ordered
      .split(' ')
      .map((w) =>
        w.length <= 1 || (NAME_SUFFIX.test(w) && w.length <= 4)
          ? w.toUpperCase()
          : w[0].toUpperCase() + w.slice(1).toLowerCase(),
      )
      .join(' ');
  }

  /**
   * Who a claimant record is, for collapsing duplicates. The same person
   * turns up as "Garcia, Douglas", "GARCIA, DOUGLAS" and on a second case, and
   * the brief used to list each as its own call. Scoped to the county so two
   * different John Smiths in two counties stay apart.
   */
  personKey(c: { claimant?: string | null; county?: string | null }): string {
    const tokens = String(c.claimant ?? '')
      .toLowerCase()
      .replace(/[^a-z0-9 ]+/g, ' ')
      .split(/\s+/)
      .filter(Boolean)
      .sort()
      .join(' ');
    return `${String(c.county ?? '').toLowerCase().trim()}|${tokens}`;
  }

  private caseKey(c: any): string {
    const norm = (v: any) => String(v ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    return `${norm(c.county)}|${norm(c.caseNumber) || norm(c.address) || c.id}`;
  }

  /**
   * Collapse callable claimant records into people, ranked by the money they
   * are owed. Likely matches stay in: a big one is worth the manual research
   * to confirm, so the row carries a flag rather than being dropped.
   */
  groupCallPeople(records: any[]): CallPerson[] {
    const byPerson = new Map<string, any[]>();
    for (const c of records) {
      const k = this.personKey(c);
      byPerson.set(k, [...(byPerson.get(k) || []), c]);
    }

    const people: CallPerson[] = [];
    for (const [key, recs] of byPerson) {
      const cases: any[] = [];
      const seen = new Set<string>();
      for (const c of [...recs].sort((a, b) => (b.grossSurplus || 0) - (a.grossSurplus || 0))) {
        const ck = this.caseKey(c);
        if (seen.has(ck)) continue;
        seen.add(ck);
        cases.push(c);
      }
      const best = [...recs].sort((a, b) => (b.cleanPhoneCount || 0) - (a.cleanPhoneCount || 0))[0];
      const clean = (best.phones || []).find((p: any) => !p.dnc);
      people.push({
        key,
        name: this.displayName(cases[0].claimant),
        county: cases[0].county || null,
        cases,
        gross: cases.reduce((s, c) => s + (c.grossSurplus || 0), 0),
        net: cases.reduce((s, c) => s + (c.netToClaimant || 0), 0),
        likely: recs.some((c) => c.queue === 'likely'),
        cleanPhones: best.cleanPhoneCount || 0,
        phone: this.fmtPhone(clean?.number),
        url: this.leadUrl(cases[0].id, LeadSource.SURPLUS),
        denied: cases.some((c) => c.claimStatus === 'denied'),
      });
    }
    return people.sort((a, b) => b.net - a.net || b.gross - a.gross);
  }

  /** "Open, nothing filed" or, across cases, "Open, nothing filed on either". */
  private statusSummary(p: CallPerson): string {
    const labels = [...new Set(p.cases.map((c) => c.claimStatusLabel).filter(Boolean))];
    if (!labels.length) return '';
    if (p.cases.length === 1 || labels.length > 1) return labels.join('; ');
    return `${labels[0]} on ${p.cases.length === 2 ? 'either' : 'any of them'}`;
  }

  private countyLabel(county: string | null | undefined): string {
    return county ? `${county} County` : 'the county';
  }

  private caseLine(c: any): string {
    return [
      this.place({ propertyAddress: c.address, propertyCity: c.city }) || null,
      c.caseNumber ? `case ${c.caseNumber}` : null,
      this.money(c.grossSurplus),
    ].filter(Boolean).join(' · ');
  }

  /** "Shares the claim with Janet Acuna." when a co-owner is also on the list. */
  private coOwnerNote(p: CallPerson, all: CallPerson[]): string | null {
    const mine = new Set(p.cases.map((c) => this.caseKey(c)));
    const others = all
      .filter((o) => o.key !== p.key && o.cases.some((c) => mine.has(this.caseKey(c))))
      .map((o) => o.name);
    if (!others.length) return null;
    return `Shares the claim with ${others.join(' and ')}.`;
  }

  private likelyFlag = 'Likely match, not confirmed: confirm who you are speaking to first.';

  private callRow(p: CallPerson, all: CallPerson[]): CallRow {
    const where = p.cases.length === 1
      ? `${this.countyLabel(p.county)}${p.cases[0].caseNumber ? ` case ${p.cases[0].caseNumber}` : ''}, ${this.place({ propertyAddress: p.cases[0].address, propertyCity: p.cases[0].city })}.`
      : `${p.cases.length} ${this.countyLabel(p.county)} cases: ${p.cases
          .map((c) => `${c.caseNumber || c.address} (${this.money(c.grossSurplus)})`)
          .join(', ')}.`;
    const status = this.statusSummary(p);
    return {
      name: p.name,
      amount: this.money(p.gross),
      detail: [
        where,
        status ? `${status}.` : null,
        `${this.plural(p.cleanPhones, 'clean number')}.`,
        this.coOwnerNote(p, all),
      ].filter(Boolean).join(' '),
      flag: p.likely ? this.likelyFlag : null,
      phone: p.phone,
      url: p.url,
      urgency: p.denied || p.net >= 25000 ? 'critical' : 'warn',
    };
  }

  /** How many briefs in a row, most recent first, led with this key. */
  private streak(key: string, recentKeys: (string | null)[]): number {
    let n = 0;
    for (const k of recentKeys) {
      if (k !== key) break;
      n += 1;
    }
    return n;
  }

  private repeatNote(n: number, what: string): string | null {
    if (!n) return null;
    return n === 1
      ? `Led the previous brief too and ${what}.`
      : `Led the last ${n} briefs too and ${what}.`;
  }

  // ── Assembly ─────────────────────────────────────────────────────────────

  /**
   * Build the brief for one org. `since` is 24h back and defines "overnight"
   * and "yesterday".
   */
  async build(params: {
    organizationId?: string | null;
    greetingName?: string | null;
    now?: Date;
  }): Promise<DigestBrief> {
    const now = params.now ?? new Date();
    const orgId = params.organizationId ?? null;
    const org = orgId ? { organizationId: orgId } : {};
    const leadOrg = orgId ? { lead: { organizationId: orgId } } : {};
    const active = { ...org, status: { notIn: INACTIVE } };
    const since = new Date(now.getTime() - DAY);
    const workableFrom = new Date(now.getTime() + FORECLOSURE_MIN_WORKABLE_DAYS * DAY);
    const workableTo = new Date(now.getTime() + FORECLOSURE_MAX_WATCH_DAYS * DAY);

    const [
      unread,
      wholesaleNewLeads,
      overdueContracts,
      workableForeclosures,
      surplusCallLogs,
      inFlightDetails,
      untracedByCounty,
      surplusLandedRows,
      surplusOverdueTasks,
      recentRuns,
    ] = await Promise.all([
      // Inbound replies nobody has ANSWERED: the newest message in the thread
      // is still inbound. Not filtered on threadUnread, because opening a
      // thread clears that flag and read is not answered. Past two weeks a
      // silence is a nurture problem, not a reply you are about to send.
      this.prisma.lead.findMany({
        where: {
          ...active,
          lastMessageDirection: 'INBOUND',
          lastMessageAt: { gte: new Date(now.getTime() - 14 * DAY) },
        },
        orderBy: { lastMessageAt: 'asc' },
        take: 50,
        select: {
          id: true, source: true, sellerFirstName: true, sellerLastName: true, sellerPhone: true,
          propertyAddress: true, propertyCity: true, lastMessageAt: true, lastMessagePreview: true,
        },
      }),

      this.prisma.lead.count({
        where: {
          ...active,
          createdAt: { gte: since },
          source: { not: LeadSource.SURPLUS },
        },
      }),

      this.prisma.contract.count({
        where: { ...leadOrg, contractStatus: { in: OPEN_CONTRACT }, expectedCloseDate: { lt: now } },
      }),

      this.prisma.foreclosureDetail.count({
        where: {
          ...org,
          saleDate: { gte: workableFrom, lte: workableTo },
          workStatus: { not: 'DEAD' },
          doNotCall: false,
        },
      }),

      // Calls placed on surplus leads in the last day, for the scorecard.
      this.prisma.callLog.findMany({
        where: { lead: { source: LeadSource.SURPLUS, ...org }, createdAt: { gte: since, lt: now } },
        select: { outcome: true, disposition: true },
      }),

      // Every claim we have signed and not yet paid out. The stuck ones get a
      // row; the rest are a count and a fee total on the scorecard.
      this.prisma.surplusDetail.findMany({
        where: { ...org, stage: { in: IN_FLIGHT_STAGES } },
        select: {
          leadId: true, stage: true, grossSurplus: true, liens: true, surplusType: true,
          fundLocation: true, checkAmount: true, feePercent: true, submittedAt: true,
          countyAcknowledgedAt: true, additionalDocsRequested: true, expectedDisbursementAt: true,
          checkReceivedAt: true, disbursementReportSignedAt: true, clearingDueAt: true, checkSentAt: true,
          lead: { select: { source: true, sellerFirstName: true, sellerLastName: true } },
        },
      }),

      // Live claimants nothing has been looked up for. Counted off the table
      // rather than the board page, which holds only the best-ranked files
      // and so undercounts exactly these: no number means a low rank.
      this.prisma.surplusDetail.groupBy({
        by: ['county'],
        where: {
          ...org,
          tracedAt: null,
          doNotCall: false,
          stage: { notIn: [SurplusStage.DEAD, SurplusStage.PAID] },
          claimStatus: { notIn: ['distributed', 'assigned'] },
        },
        _count: { _all: true },
      }),

      // What the county pulls dropped on the board since the last brief.
      this.prisma.surplusDetail.groupBy({
        by: ['county'],
        where: { ...org, createdAt: { gte: since } },
        _count: { _all: true },
        _sum: { grossSurplus: true },
      }),

      // Follow-ups on surplus claimants that have slipped. A promise to call
      // back that went unkept is what loses a claimant's trust.
      this.prisma.task
        .findMany({
          where: { completed: false, dueDate: { lt: now }, lead: { source: LeadSource.SURPLUS, ...org } },
          orderBy: { dueDate: 'asc' },
          take: 50,
          include: {
            lead: { select: { id: true, source: true, sellerFirstName: true, sellerLastName: true } },
            user: { select: { firstName: true } },
          },
        })
        .catch(() => [] as any[]),

      // What the last two weeks of briefs opened with, newest first, so a big
      // thing that is still not acted on can say how long it has led.
      orgId
        ? this.prisma.digestRun.findMany({
            where: { organizationId: orgId, sentAt: { gte: new Date(now.getTime() - 14 * DAY), lt: now } },
            orderBy: { sentAt: 'desc' },
            take: 14,
            select: { bigThingKey: true },
          })
        : Promise.resolve([] as { bigThingKey: string | null }[]),
    ]);
    const recentKeys = recentRuns.map((r) => r.bigThingKey);

    // ── The surplus board ─────────────────────────────────────────────────
    // The board's own list, so the brief never names a claimant the board
    // would treat differently. Best-effort: a surplus outage must not take
    // the rest of the brief down.
    const surplusBoard = await this.surplusService
      .list({ organizationId: orgId, hideDead: true, pageSize: 200 })
      .catch((e: any) => {
        this.logger.warn(`Surplus board unavailable for the brief: ${e.message}`);
        return null;
      });
    const surplusClaimants: any[] = (surplusBoard?.data || []).flatMap((p: any) => p.claimants || [p]);
    // Workable today: the lien window (120 days from the mailed notice) has
    // closed. Inside it another lienholder can still appear and move the
    // figure. A claimant with no notice date is held back too.
    const surplusWorkable = surplusClaimants.filter(
      (c) => c.noticeAge != null && c.noticeAge > SURPLUS_LIEN_WINDOW_DAYS,
    );
    const surplusLive = surplusWorkable.filter((c) => c.workScore > 0);
    const surplusNotTapped = surplusLive.filter((c) => c.contactStatus === 'not_tapped').length;

    // Claimants whose window closes within the next 30 days. Live files
    // only: not retired, deceased, or marked do not call.
    const openingSoon = surplusClaimants
      .filter(
        (c) =>
          c.noticeAge != null &&
          c.noticeAge > SURPLUS_LIEN_WINDOW_DAYS - 30 &&
          c.noticeAge <= SURPLUS_LIEN_WINDOW_DAYS &&
          c.workScore > 0 &&
          !c.doNotCall &&
          !c.deceased &&
          !c.heirsRequired,
      )
      .sort((a, b) => b.noticeAge - a.noticeAge);

    // Live number, nothing logged against them yet. A deceased claimant's
    // numbers are the late claimant's, and a possible obituary is checked on
    // the card before anybody dials. `touches` is the board's touch COUNT.
    const surplusCallRecords = surplusWorkable.filter(
      (c) =>
        c.workScore > 0 &&
        c.cleanPhoneCount > 0 &&
        !c.doNotCall &&
        !c.deceased &&
        !c.heirsRequired &&
        c.obituaryMatch !== 'possible' &&
        !(Number(c.touches) > 0),
    );
    const people = this.groupCallPeople(surplusCallRecords);

    // Signed claimants nobody has spoken to in a month, longest silence first.
    const updateOverdue = surplusClaimants
      .filter((c) => c.claimantUpdate?.overdue)
      .sort((a, b) => (b.claimantUpdate?.daysSince ?? 9999) - (a.claimantUpdate?.daysSince ?? 9999));

    // Replies split by side of the business. Only a claimant's reply belongs
    // in the body; a seller's reply is counted on the wholesale line.
    const surplusReplies = unread.filter((l) => l.source === LeadSource.SURPLUS);
    const wholesaleReplies = unread.filter((l) => l.source !== LeadSource.SURPLUS);

    const landedCount = surplusLandedRows.reduce((s, g) => s + g._count._all, 0);
    const surplusLanded = landedCount
      ? {
          count: landedCount,
          total: surplusLandedRows.reduce((s, g) => s + (g._sum.grossSurplus || 0), 0),
          counties: surplusLandedRows.map((g) => g.county || 'an unknown county'),
          top: surplusClaimants
            .filter((c) => c.createdAt && new Date(c.createdAt) >= since)
            .sort((a, b) => (b.grossSurplus || 0) - (a.grossSurplus || 0))[0] || null,
        }
      : null;

    // ── Big thing ───────────────────────────────────────────────────────────
    const bigThing = this.buildBigThing({
      now, people, surplusReplies, surplusOverdueTasks, surplusLanded, recentKeys,
    });

    // ── Call list ───────────────────────────────────────────────────────────
    const listed = people.filter((p) => bigThing?.key !== `surplus-person:${p.key}`);
    const calls = listed.slice(0, CALL_LIST_SIZE).map((p) => this.callRow(p, people));

    // ── Promises due ────────────────────────────────────────────────────────
    const replyRows: PromiseRow[] = surplusReplies
      .filter((l) => bigThing?.key !== `lead:${l.id}`)
      .map((l) => ({
        title: `${this.displayName(`${l.sellerFirstName || ''} ${l.sellerLastName || ''}`)} replied`,
        detail: l.lastMessagePreview ? `"${this.truncate(l.lastMessagePreview)}"` : null,
        when: `waiting ${this.fmtWait(now.getTime() - (l.lastMessageAt?.getTime() ?? now.getTime()))}`,
        url: this.leadUrl(l.id, l.source),
        urgency: 'critical' as DigestUrgency,
      }));
    const taskRows: PromiseRow[] = surplusOverdueTasks
      .filter((t: any) => bigThing?.key !== `task:${t.id}`)
      .map((t: any) => {
        const days = Math.max(1, Math.floor((now.getTime() - new Date(t.dueDate).getTime()) / DAY));
        return {
          title: t.title,
          detail: null,
          when: `${this.plural(days, 'day')} late${t.user?.firstName ? ` · ${t.user.firstName}` : ''}`,
          url: this.leadUrl(t.lead?.id || t.leadId, t.lead?.source),
          urgency: (days >= 3 ? 'critical' : 'warn') as DigestUrgency,
        };
      });
    const updateRows: PromiseRow[] = updateOverdue.map((c) => ({
      title: `Monthly update owed to ${this.displayName(c.claimant)}`,
      detail: c.stage || null,
      when: c.claimantUpdate?.daysSince != null ? `${c.claimantUpdate.daysSince} days since the last word` : 'never updated',
      url: this.leadUrl(c.id, LeadSource.SURPLUS),
      urgency: 'warn' as DigestUrgency,
    }));
    const allPromises = [...replyRows, ...taskRows, ...updateRows];

    // ── Needs a trace ───────────────────────────────────────────────────────
    const untraced = untracedByCounty
      .map((g) => ({ county: g.county || 'Unknown', n: g._count._all }))
      .filter((g) => g.n > 0)
      .sort((a, b) => b.n - a.n);
    const untracedTotal = untraced.reduce((s, g) => s + g.n, 0);
    const needsTrace = untracedTotal
      ? {
          total: untracedTotal,
          byCounty: [
            ...untraced.slice(0, 5).map((g) => `${g.county} ${g.n}`),
            ...(untraced.length > 5 ? [`${untraced.length - 5} more counties`] : []),
          ].join(' · '),
        }
      : null;

    // ── Claims in flight ────────────────────────────────────────────────────
    const inFlightFeeTotal = inFlightDetails.reduce((s, d) => s + (this.inFlightFee(d) || 0), 0);
    const inFlight: InFlightRow[] = inFlightDetails
      .map((d) => {
        const stuck = this.inFlightBlocker(d, now);
        if (!stuck) return null;
        const fee = this.inFlightFee(d);
        return {
          claimant: this.displayName(`${d.lead?.sellerFirstName || ''} ${d.lead?.sellerLastName || ''}`),
          stage: d.stage || '',
          note: stuck.note,
          fee: fee ? this.money(fee) : '-',
          url: this.leadUrl(d.leadId, d.lead?.source),
          urgency: stuck.urgency,
        };
      })
      .filter((r): r is InFlightRow => !!r)
      .sort((a, b) => (a.urgency === 'critical' ? 0 : 1) - (b.urgency === 'critical' ? 0 : 1));

    // ── Scorecard ───────────────────────────────────────────────────────────
    const callsYesterday = surplusCallLogs.length;
    const connectedYesterday = surplusCallLogs.filter(
      (c) =>
        surplusCallConnected(c.outcome) ||
        (!c.outcome && ['Follow Up', 'Requested Appointment', 'Not Interested'].includes(c.disposition || '')),
    ).length;
    const followUpsDue = surplusReplies.length + surplusOverdueTasks.length + updateOverdue.length;
    const oldestTaskDays = surplusOverdueTasks[0]
      ? Math.max(1, Math.floor((now.getTime() - new Date(surplusOverdueTasks[0].dueDate).getTime()) / DAY))
      : null;
    const openingTotal = openingSoon.reduce((s, c) => s + (c.grossSurplus || 0), 0);

    const scorecard: BoardTile[] = [
      {
        label: 'Ready to call', value: String(people.length),
        subtext: people.length ? 'live number, never called' : 'nobody waiting',
        urgency: people.length ? 'warn' : 'good',
      },
      {
        label: 'Calls yesterday', value: String(callsYesterday),
        subtext: `${connectedYesterday} connected · target ${SURPLUS_DAILY_CALL_TARGET}`,
        urgency:
          callsYesterday >= SURPLUS_DAILY_CALL_TARGET ? 'good'
          : callsYesterday >= SURPLUS_DAILY_CALL_TARGET / 2 ? 'warn'
          : 'critical',
      },
      {
        label: 'Follow-ups due', value: String(followUpsDue),
        subtext: surplusReplies.length
          ? `${this.plural(surplusReplies.length, 'reply', 'replies')} waiting`
          : oldestTaskDays ? `oldest ${this.plural(oldestTaskDays, 'day')} late`
          : followUpsDue ? 'monthly updates owed' : 'all caught up',
        urgency: followUpsDue ? 'critical' : 'good',
      },
      {
        label: 'Open claimants', value: String(surplusBoard ? surplusWorkable.length : 0),
        subtext: `${surplusNotTapped} never reached`,
        urgency: 'neutral',
      },
      {
        label: 'In flight', value: String(inFlightDetails.length),
        subtext: inFlightDetails.length
          ? `${this.moneyCompact(inFlightFeeTotal)} in fees${inFlight.length ? `, ${inFlight.length} stuck` : ''}`
          : 'nothing signed yet',
        urgency: inFlight.length ? 'warn' : inFlightDetails.length ? 'good' : 'neutral',
      },
      {
        label: 'Opening in 30d', value: String(openingSoon.length),
        subtext: openingSoon.length
          ? `${this.moneyCompact(openingTotal)} · next in ${this.plural(this.daysToOpen(openingSoon[0].noticeAge), 'day')}`
          : 'none coming up',
        urgency: 'neutral',
      },
    ];

    // ── Feeds ───────────────────────────────────────────────────────────────
    const feeds = await this.buildFeeds(orgId, now);
    const countyListsDue = await this.buildCountyListsDue(orgId, now);
    const touchesDue = await this.buildTouchesDue(orgId);

    // ── Wholesale, parked ───────────────────────────────────────────────────
    const oldestWholesale = wholesaleReplies[0]?.lastMessageAt
      ? this.fmtWait(now.getTime() - wholesaleReplies[0].lastMessageAt.getTime())
      : null;
    const wholesaleParts = [
      wholesaleReplies.length
        ? `${this.plural(wholesaleReplies.length, 'reply', 'replies')} waiting${oldestWholesale ? ` (oldest ${oldestWholesale})` : ''}`
        : null,
      overdueContracts ? `${this.plural(overdueContracts, 'contract')} past close date` : null,
      workableForeclosures ? `${this.plural(workableForeclosures, 'foreclosure')} in the workable window` : null,
      wholesaleNewLeads ? `${this.plural(wholesaleNewLeads, 'new lead')} overnight` : null,
    ].filter(Boolean);

    const brief: DigestBrief = {
      organizationId: orgId,
      generatedAt: now,
      dateLabel: this.fmtDate(now),
      timeLabel: this.fmtTime(now),
      greetingName: params.greetingName ?? null,
      greetingPrefix: this.greeting(now),
      subject: '',
      preheader: '',
      bigThing,
      scorecard,
      calls,
      callsTotal: people.length,
      promises: allPromises.slice(0, PROMISE_LIST_SIZE),
      promisesTotal: allPromises.length,
      needsTrace,
      inFlight,
      inFlightTotal: inFlightDetails.length,
      inFlightFees: this.moneyCompact(inFlightFeeTotal),
      surplusIngestNote: surplusLanded
        ? `${this.plural(surplusLanded.count, 'claimant')} landed from ${surplusLanded.counties.join(' and ')}, ${this.moneyCompact(surplusLanded.total)} of surplus between them.`
        : null,
      surplusOpeningSoonNote: openingSoon.length ? this.openingSoonNote(openingSoon) : null,
      feedProblems: feeds.filter((f) => f.urgency === 'warn' || f.urgency === 'critical'),
      feedSummary: summarizeHealthyFeeds(feeds),
      countyListsDue,
      touchesDue,
      wholesale: wholesaleParts.length ? wholesaleParts.join(' · ') : null,
      appUrl: this.appUrl,
      // A failed county feed is never an empty day; that is the one morning
      // the email must go out.
      isEmpty:
        !bigThing && !calls.length && !allPromises.length && !needsTrace &&
        !inFlight.length && !feeds.some((f) => f.urgency === 'critical') && !countyListsDue.length && !touchesDue,
    };

    brief.subject = this.buildSubject(brief, followUpsDue);
    brief.preheader = bigThing
      ? bigThing.headline
      : `${people.length} claimants ready to call, ${followUpsDue} follow-ups due.`;

    return brief;
  }

  /** The fee on a claim in flight: the agreed percent of the check once there is one, else the board's estimate. */
  private inFlightFee(d: any): number | null {
    if (d.checkAmount && d.feePercent) return (d.checkAmount * d.feePercent) / 100;
    return estFee({
      surplusType: d.surplusType,
      fundLocation: d.fundLocation,
      grossSurplus: d.grossSurplus,
      liens: (d.liens as SurplusLien[]) || [],
    });
  }

  /**
   * Why a signed claim has stopped moving, or null when it is on track. Only
   * reads dates the claim screens actually write, so a row here is a fact
   * about the file and never a guess.
   */
  inFlightBlocker(d: any, now: Date): { note: string; urgency: DigestUrgency } | null {
    const daysSince = (at: Date) => Math.floor((now.getTime() - new Date(at).getTime()) / DAY);
    const filed = d.stage === SurplusStage.CLAIM_FILED || d.stage === SurplusStage.AWAITING_DISBURSEMENT;

    if (filed && d.additionalDocsRequested) {
      return { note: `The county asked for more: ${this.truncate(d.additionalDocsRequested, 80)}`, urgency: 'critical' };
    }
    if (d.stage === SurplusStage.CLAIM_FILED && d.submittedAt && !d.countyAcknowledgedAt) {
      const days = daysSince(d.submittedAt);
      if (days >= 21) {
        return {
          note: `Filed ${days} days ago, the county has not acknowledged it`,
          urgency: days >= 45 ? 'critical' : 'warn',
        };
      }
    }
    if (d.stage === SurplusStage.AWAITING_DISBURSEMENT && d.expectedDisbursementAt && new Date(d.expectedDisbursementAt) < now) {
      return {
        note: `Check was expected ${this.fmtShortDate(new Date(d.expectedDisbursementAt))}, ${this.plural(Math.max(1, daysSince(d.expectedDisbursementAt)), 'day')} late`,
        urgency: 'warn',
      };
    }
    if (d.stage === SurplusStage.CHECK_RECEIVED) {
      if (d.clearingDueAt && new Date(d.clearingDueAt) < now && !d.checkSentAt) {
        return {
          note: `Cleared ${this.fmtShortDate(new Date(d.clearingDueAt))}, the claimant's share has not gone out`,
          urgency: 'critical',
        };
      }
      if (d.checkReceivedAt && !d.disbursementReportSignedAt && daysSince(d.checkReceivedAt) >= 3) {
        return {
          note: `Check in hand ${daysSince(d.checkReceivedAt)} days, disbursement report not signed`,
          urgency: 'warn',
        };
      }
    }
    return null;
  }

  /**
   * The single most important thing on the surplus board. Surplus only:
   * wholesaling never leads.
   *
   * In order: a claimant who replied and is waiting, then the person owed the
   * most money with a live number nobody has called, then the oldest slipped
   * follow-up, then a large batch that landed overnight.
   *
   * Something nobody has acted on is allowed to lead again the next morning.
   * Hiding it after one appearance is how a big file got skipped: the brief
   * moved on and nobody called. Instead it says how many briefs it has led.
   */
  private buildBigThing(ctx: {
    now: Date;
    people: CallPerson[];
    surplusReplies: any[];
    surplusOverdueTasks: any[];
    surplusLanded: { count: number; total: number; counties: string[]; top: any | null } | null;
    recentKeys: (string | null)[];
  }): BigThing | null {
    const { now } = ctx;

    const reply = ctx.surplusReplies[0];
    if (reply) {
      const key = `lead:${reply.id}`;
      const name = this.displayName(`${reply.sellerFirstName || ''} ${reply.sellerLastName || ''}`);
      const waited = reply.lastMessageAt ? this.fmtWait(now.getTime() - reply.lastMessageAt.getTime()) : null;
      return {
        key,
        short: `${name} replied`,
        headline: `${name} replied${waited ? ` ${waited} ago` : ''} and is still waiting on an answer.`,
        lines: [
          this.place(reply),
          reply.lastMessagePreview ? `They wrote: "${this.truncate(reply.lastMessagePreview, 140)}"` : '',
        ].filter(Boolean),
        flag: null,
        repeatNote: this.repeatNote(this.streak(key, ctx.recentKeys), 'still has no answer'),
        ctaLabel: 'Open the thread',
        ctaUrl: this.leadUrl(reply.id, reply.source),
        phone: this.fmtPhone(reply.sellerPhone),
      };
    }

    const p = ctx.people[0];
    if (p) {
      const key = `surplus-person:${p.key}`;
      const status = this.statusSummary(p);
      const headline = p.cases.length === 1
        ? `${p.name} is owed ${this.money(p.gross)} by ${this.countyLabel(p.county)} and nobody has called.`
        : `${p.name} is owed ${this.money(p.gross)} across ${p.cases.length} ${this.countyLabel(p.county)} cases and nobody has called.`;
      return {
        key,
        short: `Call ${p.name} (${this.moneyCompact(p.gross)}${p.cases.length > 1 ? `, ${p.cases.length} cases` : ''})`,
        headline,
        lines: [
          ...p.cases.map((c) => this.caseLine(c)),
          [status ? `${status}.` : null, `${this.plural(p.cleanPhones, 'clean number')}.`].filter(Boolean).join(' '),
          this.coOwnerNote(p, ctx.people) || '',
        ].filter(Boolean),
        flag: p.likely ? this.likelyFlag : null,
        repeatNote: this.repeatNote(this.streak(key, ctx.recentKeys), 'still has not been called'),
        ctaLabel: 'Open claimant',
        ctaUrl: p.url,
        phone: p.phone,
      };
    }

    const task = ctx.surplusOverdueTasks[0];
    if (task) {
      const key = `task:${task.id}`;
      const days = Math.max(1, Math.floor((now.getTime() - new Date(task.dueDate).getTime()) / DAY));
      return {
        key,
        short: `A follow-up is ${this.plural(days, 'day')} late`,
        headline: `A promise to a claimant is ${this.plural(days, 'day')} late: ${task.title}.`,
        lines: task.user?.firstName ? [`Assigned to ${task.user.firstName}.`] : [],
        flag: null,
        repeatNote: this.repeatNote(this.streak(key, ctx.recentKeys), 'is still open'),
        ctaLabel: 'Open claimant',
        ctaUrl: this.leadUrl(task.lead?.id || task.leadId, task.lead?.source),
        phone: null,
      };
    }

    const s = ctx.surplusLanded;
    if (s && s.count >= 5) {
      return {
        key: `surplus-batch:${now.toISOString().slice(0, 10)}`,
        short: `${s.count} claimants landed`,
        headline: `${s.count} surplus claimants landed overnight from ${s.counties.join(' and ')}, ${this.moneyCompact(s.total)} between them.`,
        lines: s.top
          ? [`Largest: ${this.displayName(s.top.claimant)}, ${this.money(s.top.grossSurplus)} on ${this.place({ propertyAddress: s.top.address, propertyCity: s.top.city })}.`]
          : [],
        flag: null,
        repeatNote: null,
        ctaLabel: 'Open the surplus board',
        ctaUrl: `${this.appUrl}/surplus-funds`,
        phone: null,
      };
    }

    return null;
  }

  /**
   * What each automated county pull did, or failed to do, one line per source.
   * Runs are shared across the org's replicas; the cron's own runs carry the
   * org id and a manual run may not, so both are read.
   */
  private async buildFeeds(orgId: string | null, now: Date): Promise<FeedRow[]> {
    const sources = this.surplusIngest
      .adapters()
      .map((a) => ({ key: a.key, county: a.county, cadence: a.cadence }));
    if (!sources.length) return [];
    const runs = await this.prisma.surplusPollRun.findMany({
      where: {
        source: { in: sources.map((s) => s.key) },
        startedAt: { gte: new Date(now.getTime() - 10 * DAY) },
        ...(orgId ? { OR: [{ organizationId: orgId }, { organizationId: null }] } : {}),
      },
      orderBy: { startedAt: 'desc' },
    });
    return sources.map((s) => describeFeed(s, runs, now));
  }

  /**
   * Counties whose list is due to be asked for: the next request date in the
   * county list tracker is today or earlier. Only counties somebody gave a
   * date, so a county nobody tracks never nags.
   */
  private async buildCountyListsDue(orgId: string | null, now: Date): Promise<FeedRow[]> {
    const rows = await this.prisma.surplusCounty.findMany({
      where: { organizationId: orgId, listNextRequestAt: { not: null, lte: todayNoonUtc(now) } },
      orderBy: { listNextRequestAt: 'asc' },
    });
    return rows.map((c) => describeCountyListDue({ ...c, listNextRequestAt: c.listNextRequestAt as Date }, now));
  }

  /**
   * The outreach list's Due today, as one line: how many people on workable
   * files have had nothing tried in a week, and the biggest file first. A
   * failure here costs the line, never the brief.
   */
  private async buildTouchesDue(orgId: string | null): Promise<DigestBrief['touchesDue']> {
    try {
      const due = await this.outreach.dueToday(orgId);
      if (!due.peopleCount) return null;
      const first = due.top[0];
      const left =
        first.daysLeft == null ? null : first.daysLeft < 0 ? 'past the year' : `${this.plural(first.daysLeft, 'day')} left`;
      const lead = first
        ? ` Biggest first: ${first.people.join(' and ')} on ${first.claimant}'s file (${[
            this.moneyCompact(first.netToClaimant),
            left,
            first.shortWindow ? 'short window' : null,
          ]
            .filter(Boolean)
            .join(', ')}).`
        : '';
      return {
        people: due.peopleCount,
        cases: due.caseCount,
        line: `${this.plural(due.peopleCount, 'person', 'people')} on ${this.plural(due.caseCount, 'file')} with nothing tried in ${TOUCH_EVERY_DAYS} days or more.${lead}`,
      };
    } catch (err: any) {
      this.logger.warn(`Touches due line skipped: ${err?.message || err}`);
      return null;
    }
  }

  /** Subject line, rebuilt daily from whatever leads the brief. */
  private buildSubject(b: DigestBrief, followUpsDue: number): string {
    const parts: string[] = [];
    // A broken feed is the one subject line that must not be buried.
    const brokenFeeds = b.feedProblems.filter((f) => f.urgency === 'critical');
    if (brokenFeeds.length) {
      parts.push(`${brokenFeeds.map((f) => f.label.replace(' County', '')).join(' and ')} feed ${brokenFeeds.length === 1 ? 'needs' : 'need'} attention`);
    }
    if (b.bigThing) parts.push(b.bigThing.short);
    if (followUpsDue && !b.bigThing?.key.startsWith('task:')) {
      parts.push(`${this.plural(followUpsDue, 'follow-up')} due`);
    }
    const more = b.callsTotal - (b.bigThing?.key.startsWith('surplus-person:') ? 1 : 0);
    if (more > 0) parts.push(`${more} more to call`);
    if (!parts.length && b.needsTrace) parts.push(`${this.plural(b.needsTrace.total, 'claimant')} to trace`);
    if (!parts.length) parts.push('surplus board is clear');
    return `Dealcore Daily: ${parts.slice(0, 2).join(', ')}`;
  }
}

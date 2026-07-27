import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { DigestNewsService } from './digest-news.service';
import {
  BigThing,
  BoardTile,
  DealRow,
  DigestAction,
  DigestBrief,
  DigestUrgency,
  ForeclosureRow,
  NewLeadRow,
  WaitingRow,
  YesterdayStat,
} from './digest.types';

/** Matches dashboard.service.ts. Leads in these statuses are out of pipeline. */
const INACTIVE = ['SOLD', 'SOLD_LOSS', 'HELD_LONG_TERM', 'CANCELLED', 'CLOSED_LOST', 'DEAD'];

/** Contract statuses that are still live work. */
const OPEN_CONTRACT = ['draft', 'signed', 'inspection', 'past-inspection', 'at-title'];

const TZ = 'America/New_York';
const DAY = 24 * 60 * 60 * 1000;

@Injectable()
export class DigestService {
  private readonly logger = new Logger(DigestService.name);

  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
    private news: DigestNewsService,
  ) {}

  private get appUrl(): string {
    return (this.config.get<string>('FRONTEND_URL') || 'http://localhost:3000')
      .split(',')[0]
      .trim()
      .replace(/\/$/, '');
  }

  private leadUrl(id: string, sub = ''): string {
    return `${this.appUrl}/leads/${id}${sub}`;
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

  /** "10h 16m", "3d 4h", "22m" */
  private fmtWait(ms: number): string {
    const mins = Math.max(0, Math.floor(ms / 60000));
    if (mins < 60) return `${mins}m`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ${String(mins % 60).padStart(2, '0')}m`;
    return `${Math.floor(hours / 24)}d ${hours % 24}h`;
  }

  /** Whole days from now to a future date, floored at 0. */
  private daysUntil(d: Date, now: Date): number {
    return Math.max(0, Math.round((d.getTime() - now.getTime()) / DAY));
  }

  /** Signed days: negative means the date has already passed. */
  private daysDelta(d: Date, now: Date): number {
    return Math.round((d.getTime() - now.getTime()) / DAY);
  }

  /** "(888) 574-8121" from any 10 or 11 digit form. */
  private fmtPhone(raw: string | null | undefined): string | null {
    const digits = String(raw ?? '').replace(/[^0-9]/g, '');
    const ten = digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
    if (ten.length !== 10) return raw ? String(raw) : null;
    return `(${ten.slice(0, 3)}) ${ten.slice(3, 6)}-${ten.slice(6)}`;
  }

  /**
   * County owner strings arrive as raw record text: "SURDI MARY ANN HEIRS",
   * "ROBERT TONY BROFFMAN;", "JESUS ALFONSO DELCID; ELIZABETH DELCID". Take the
   * first owner, drop the record suffixes, and title-case it so the brief reads
   * like a person wrote it.
   */
  private cleanOwnerName(raw: string | null | undefined): string | null {
    const first = String(raw ?? '').split(';')[0].replace(/[,;\s]+$/, '').trim();
    if (!first) return null;
    const stripped = first
      .replace(/\b(HEIRS?|ESTATE|DECEASED|ET\s?AL|TRUSTEE|LIFE\s?ESTATE)\b/gi, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (!stripped) return null;
    return stripped
      .split(' ')
      .map((w) => (w.length <= 1 ? w.toUpperCase() : w[0].toUpperCase() + w.slice(1).toLowerCase()))
      .join(' ');
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

  private personName(l: { sellerFirstName?: string | null; sellerLastName?: string | null }): string {
    return [l.sellerFirstName, l.sellerLastName].filter(Boolean).join(' ').trim() || 'Unknown seller';
  }

  private place(l: { propertyAddress?: string | null; propertyCity?: string | null }): string {
    return [l.propertyAddress, l.propertyCity].filter(Boolean).join(', ');
  }

  private tierLabel(tier: number | null | undefined, scoreBand?: string | null): string {
    if (tier != null) return `Tier ${tier}`;
    if (scoreBand) return scoreBand.replace(/_/g, ' ').toLowerCase();
    return 'Unscored';
  }

  /**
   * Best available dollar figure for ranking a lead. Prefers the persisted deal
   * math outputs (already strategy-aware) and falls back to a rough ARV minus
   * asking minus repairs so unpriced leads still sort sensibly.
   */
  private leadValue(lead: {
    currentDealNumbers?: any;
    arv?: number | null;
    askingPrice?: number | null;
    currentRepairEstimate?: number | null;
  }): number {
    const outputs = (lead.currentDealNumbers as { outputs?: Record<string, number | null> } | null)?.outputs;
    if (outputs) {
      for (const key of ['spread', 'estimatedProfit', 'assignmentFee']) {
        const v = outputs[key];
        if (typeof v === 'number' && isFinite(v) && v !== 0) return v;
      }
    }
    if (lead.arv != null && lead.askingPrice != null) {
      return Math.max(0, lead.arv - lead.askingPrice - (lead.currentRepairEstimate ?? 0));
    }
    return lead.arv ?? 0;
  }

  // ── Assembly ─────────────────────────────────────────────────────────────

  /**
   * Build the brief for one org. `since` defaults to 24h back and defines the
   * "overnight" window; once DigestSnapshot lands this becomes the previous
   * send time.
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
    const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000);
    const threeDaysAgo = new Date(now.getTime() - 3 * DAY);
    const fourDaysAgo = new Date(now.getTime() - 4 * DAY);
    const in7 = new Date(now.getTime() + 7 * DAY);
    const in21 = new Date(now.getTime() + 21 * DAY);
    const in60 = new Date(now.getTime() + 60 * DAY);

    const [
      unread,
      newLeads,
      activeCount,
      underContractCount,
      openContracts,
      staleLeads,
      newlyStale,
      newContracts,
      foreclosureRows,
      foreclosureOpenTotal,
      foreclosureNew,
      pendingOffers,
      overdueTasks,
      topCity,
    ] = await Promise.all([
      // Inbound replies nobody has answered. All fields are denormalized on Lead.
      this.prisma.lead.findMany({
        where: { ...active, threadUnread: true, lastMessageDirection: 'INBOUND' },
        orderBy: { lastMessageAt: 'asc' },
        take: 8,
        select: {
          id: true, sellerFirstName: true, sellerLastName: true, sellerPhone: true,
          propertyAddress: true, propertyCity: true, tier: true, scoreBand: true,
          lastMessageAt: true, lastMessagePreview: true, arv: true, askingPrice: true,
          currentRepairEstimate: true, currentDealNumbers: true, sellerMotivation: true,
        },
      }),

      this.prisma.lead.findMany({
        where: { ...active, createdAt: { gte: since } },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true, propertyAddress: true, propertyCity: true, source: true,
          createdAt: true, arv: true, askingPrice: true, distressSignals: true,
          lastMessageDirection: true, lastMessageAt: true,
        },
      }),

      this.prisma.lead.count({ where: active }),

      this.prisma.lead.count({ where: { ...org, status: { in: ['UNDER_CONTRACT', 'CLOSING'] } } }),

      this.prisma.contract.findMany({
        where: { ...leadOrg, contractStatus: { in: OPEN_CONTRACT } },
        orderBy: [{ expectedCloseDate: 'asc' }],
        take: 8,
        include: {
          lead: {
            select: {
              id: true, propertyAddress: true, propertyCity: true,
              dealShares: { orderBy: { createdAt: 'desc' }, take: 1, select: { lastOpenedAt: true, createdAt: true } },
            },
          },
        },
      }),

      this.prisma.lead.count({
        where: { ...active, lastTouchedAt: { lte: threeDaysAgo }, scoreBand: { in: ['HOT', 'STRIKE_ZONE', 'WORKABLE'] } },
      }),

      // Crossed the 3-day line since the last brief.
      this.prisma.lead.count({
        where: {
          ...active,
          lastTouchedAt: { lte: threeDaysAgo, gt: fourDaysAgo },
          scoreBand: { in: ['HOT', 'STRIKE_ZONE', 'WORKABLE'] },
        },
      }),

      this.prisma.contract.count({ where: { ...leadOrg, createdAt: { gte: since } } }),

      this.prisma.foreclosureDetail.findMany({
        where: {
          ...org,
          saleDate: { gte: now, lte: in21 },
          workStatus: { not: 'DEAD' },
          doNotCall: false,
        },
        orderBy: [{ saleDate: 'asc' }, { leadScore: 'desc' }],
        take: 5,
        include: { lead: { select: { id: true, propertyAddress: true, propertyCity: true, sellerPhone: true } } },
      }),

      this.prisma.foreclosureDetail.count({ where: { ...org, workStatus: { notIn: ['DEAD', 'UNDER_CONTRACT'] } } }),

      this.prisma.foreclosureDetail.count({ where: { ...org, createdAt: { gte: since } } }),

      this.prisma.offer.findMany({
        where: { ...leadOrg, status: 'pending', offerDate: { lte: new Date(now.getTime() - 2 * DAY) } },
        orderBy: { offerDate: 'asc' },
        take: 5,
        include: { lead: { select: { id: true, propertyAddress: true, propertyCity: true, status: true } } },
      }),

      this.prisma.task.findMany({
        where: { ...leadOrg, completed: false, dueDate: { lt: now, not: null } },
        orderBy: { dueDate: 'asc' },
        take: 5,
        include: { lead: { select: { id: true, propertyAddress: true, propertyCity: true } } },
      }),

      this.prisma.lead.groupBy({
        by: ['propertyCity'],
        where: active,
        _count: { propertyCity: true },
        orderBy: { _count: { propertyCity: 'desc' } },
        take: 3,
      }),
    ]);

    const yesterday = await this.buildYesterday(orgId, since, now);

    // Feeds live outside our control, so this is best-effort: getItems swallows
    // its own failures and returns [] rather than taking the brief down.
    const strategies = [
      ...new Set(openContracts.map((c) => c.exitStrategy).filter(Boolean) as string[]),
    ];
    const news = await this.news.getItems({
      markets: topCity.map((c) => c.propertyCity).filter(Boolean) as string[],
      strategies,
      closingSoon: openContracts.filter(
        (c) => c.expectedCloseDate && c.expectedCloseDate >= now && c.expectedCloseDate <= in60,
      ).length,
      activeLeads: activeCount,
      foreclosureCount: foreclosureOpenTotal,
    });

    // ── Board ───────────────────────────────────────────────────────────────
    // Every open contract counts, including ones whose close date already
    // slipped. Filtering to future dates silently hid most of the money.
    const expectedFees = openContracts.reduce((sum, c) => sum + (c.assignmentFee || 0), 0);
    const overdueContracts = openContracts.filter(
      (c) => c.expectedCloseDate && this.daysDelta(c.expectedCloseDate, now) < 0,
    ).length;
    const feelessContracts = openContracts.filter((c) => !c.assignmentFee).length;
    const oldestWait = unread.length && unread[0].lastMessageAt
      ? this.fmtWait(now.getTime() - unread[0].lastMessageAt.getTime())
      : null;

    const board: BoardTile[] = [
      {
        label: 'New leads', value: String(newLeads.length),
        subtext: newLeads.length ? 'in the last 24h' : 'quiet overnight',
        urgency: newLeads.length ? 'good' : 'neutral',
      },
      {
        label: 'Replies waiting', value: String(unread.length),
        subtext: oldestWait ? `oldest ${oldestWait}` : 'inbox clear',
        urgency: unread.length ? 'warn' : 'good',
      },
      {
        label: 'Active pipeline', value: String(activeCount),
        subtext: `${staleLeads} need a touch`, urgency: 'neutral',
      },
      {
        label: 'Under contract', value: String(underContractCount),
        subtext: overdueContracts
          ? `${overdueContracts} past close date`
          : newContracts ? `up ${newContracts} since yesterday` : 'no change',
        urgency: overdueContracts ? 'critical' : newContracts ? 'good' : 'neutral',
      },
      {
        label: 'Expected fees', value: this.moneyCompact(expectedFees),
        subtext: feelessContracts
          ? `${openContracts.length} open, ${feelessContracts} with no fee set`
          : `across ${openContracts.length} open deal${openContracts.length === 1 ? '' : 's'}`,
        urgency: feelessContracts ? 'warn' : 'good',
      },
      {
        label: 'Going cold', value: String(staleLeads),
        subtext: newlyStale ? `up ${newlyStale} since yesterday` : 'holding steady',
        urgency: staleLeads ? 'critical' : 'good',
      },
    ];

    // ── Waiting on you ──────────────────────────────────────────────────────
    const waiting: WaitingRow[] = unread.slice(0, 6).map((l) => {
      const waitedMs = l.lastMessageAt ? now.getTime() - l.lastMessageAt.getTime() : 0;
      return {
        name: this.personName(l),
        property: this.place(l),
        tierLabel: this.tierLabel(l.tier, l.scoreBand),
        waitedLabel: this.fmtWait(waitedMs),
        preview: this.truncate(l.lastMessagePreview),
        url: this.leadUrl(l.id),
        urgency: waitedMs > 4 * 60 * 60 * 1000 ? 'warn' : 'neutral',
      };
    });

    // ── Deals in motion ─────────────────────────────────────────────────────
    // Overdue first (a blown close date is the loudest thing here), then
    // soonest upcoming, then the unscheduled.
    const rankedContracts = [...openContracts].sort((a, b) => {
      const ad = a.expectedCloseDate ? this.daysDelta(a.expectedCloseDate, now) : 9999;
      const bd = b.expectedCloseDate ? this.daysDelta(b.expectedCloseDate, now) : 9999;
      const aOver = ad < 0, bOver = bd < 0;
      if (aOver !== bOver) return aOver ? -1 : 1;
      return aOver ? ad - bd : ad - bd;
    });

    const dealsInMotion: DealRow[] = rankedContracts.slice(0, 6).map((c) => {
      const close = c.expectedCloseDate;
      const delta = close ? this.daysDelta(close, now) : null;
      const { note, noteUrgency } = this.contractBlocker(c, now, delta);
      return {
        property: this.place(c.lead),
        note, noteUrgency,
        closeLabel: close ? this.fmtShortDate(close) : 'No date set',
        daysLabel:
          delta == null ? 'unscheduled'
          : delta < 0 ? `${Math.abs(delta)} days overdue`
          : delta === 0 ? 'today'
          : `${delta} days`,
        daysUrgency:
          delta == null ? 'warn'
          : delta < 0 ? 'critical'
          : delta <= 5 ? 'critical'
          : delta <= 14 ? 'warn'
          : 'neutral',
        fee: c.assignmentFee ? this.money(c.assignmentFee) : 'not set',
        url: this.leadUrl(c.lead.id, '/contract'),
      };
    });

    // ── Foreclosure watch ───────────────────────────────────────────────────
    const foreclosures: ForeclosureRow[] = foreclosureRows.map((f) => {
      const days = f.saleDate ? this.daysUntil(f.saleDate, now) : 99;
      const owner = this.cleanOwnerName(f.countyOwner);
      const facts = [
        owner,
        f.noticeType ? f.noticeType.replace(/_/g, ' ') : null,
        f.saleDate ? `sale ${this.fmtShortDate(f.saleDate)}` : null,
        f.priority || null,
        f.leadScore != null ? `score ${f.leadScore}` : null,
        f.equitySpread != null ? `equity ${this.moneyCompact(f.equitySpread)}` : null,
        f.ownerOccupied === 'N' ? 'absentee owner' : null,
      ].filter(Boolean).join(' · ');

      const contactable = [f.lead?.sellerPhone, f.phone2].filter(Boolean).length;
      const status = f.workStatus === 'NOT_CONTACTED'
        ? `Never contacted. ${contactable ? `${contactable} phone${contactable > 1 ? 's' : ''} on file.` : 'No phone yet.'}`
        : `${(f.workStatus || '').replace(/_/g, ' ').toLowerCase()} · ${f.callNotes ? this.truncate(f.callNotes, 60) : 'no notes'}`;

      return {
        property: this.place({ propertyAddress: f.lead?.propertyAddress, propertyCity: f.lead?.propertyCity }),
        daysLabel: `${days} days`,
        facts, status,
        url: f.lead ? this.leadUrl(f.lead.id) : `${this.appUrl}/foreclosures`,
        urgency: days <= 5 ? 'critical' : days <= 10 ? 'warn' : 'neutral',
      };
    });

    // ── Came in overnight ───────────────────────────────────────────────────
    const newOvernight: NewLeadRow[] = newLeads.slice(0, 3).map((l) => {
      let note = 'No reply yet.';
      let noteUrgency: DigestUrgency = 'neutral';
      if (l.lastMessageDirection === 'INBOUND') {
        note = 'Already replied. AI is running CAMP.';
        noteUrgency = 'good';
      } else if (Array.isArray(l.distressSignals) && l.distressSignals.length) {
        note = `Distress: ${(l.distressSignals as string[]).join(', ').replace(/_/g, ' ')}`;
        noteUrgency = 'warn';
      } else if (l.arv != null && l.askingPrice != null && l.askingPrice > l.arv * 0.75) {
        note = `Asking ${this.money(l.askingPrice)} against ${this.money(l.arv)} ARV. Thin.`;
        noteUrgency = 'warn';
      }
      return {
        property: this.place(l),
        meta: `${(l.source || '').replace(/_/g, ' ').toLowerCase()} · ${this.fmtTime(l.createdAt).replace(' ET', '')}`,
        note, noteUrgency,
        url: this.leadUrl(l.id),
      };
    });

    // ── Actions ─────────────────────────────────────────────────────────────
    const actions = this.buildActions({
      now, unread, twoHoursAgo, foreclosureRows, openContracts, in7,
      pendingOffers, overdueTasks, staleLeads,
    });

    // ── Big thing ───────────────────────────────────────────────────────────
    const bigThing = this.buildBigThing({ now, unread, foreclosureRows, openContracts, in7 });

    const market = topCity[0]?.propertyCity ? `${topCity[0].propertyCity} metro` : null;

    const brief: DigestBrief = {
      organizationId: orgId,
      generatedAt: now,
      dateLabel: this.fmtDate(now),
      timeLabel: this.fmtTime(now),
      greetingName: params.greetingName ?? null,
      greetingPrefix: this.greeting(now),
      marketLabel: market,
      subject: '',
      preheader: '',
      bigThing,
      board,
      actions,
      waiting,
      waitingTotal: unread.length,
      dealsInMotion,
      dealsTotalFee: this.money(expectedFees),
      foreclosures,
      foreclosureIngestNote: foreclosureNew
        ? `${foreclosureNew} new notice${foreclosureNew > 1 ? 's' : ''} ingested overnight.`
        : null,
      foreclosureOpenTotal,
      newOvernight,
      newOvernightTotal: newLeads.length,
      yesterday,
      news,
      appUrl: this.appUrl,
      isEmpty:
        !bigThing && !actions.length && !waiting.length &&
        !dealsInMotion.length && !foreclosures.length && !newOvernight.length,
    };

    brief.subject = this.buildSubject(brief);
    brief.preheader = bigThing
      ? bigThing.headline
      : `${activeCount} active leads, ${staleLeads} need a touch.`;

    return brief;
  }

  /** First matching blocker on an open contract, else a neutral status line. */
  private contractBlocker(
    c: any,
    now: Date,
    days: number | null,
  ): { note: string; noteUrgency: DigestUrgency } {
    // An expected close date in the past outranks every other blocker: either
    // it slipped and nobody updated it, or the deal is quietly dead.
    if (days != null && days < 0) {
      return {
        note: `Close date passed ${Math.abs(days)} days ago, needs a new date or a kill`,
        noteUrgency: 'critical',
      };
    }
    if (days != null && days <= 7 && !c.titleCompany) {
      return { note: 'No title company set', noteUrgency: 'critical' };
    }
    if (c.boldsignStatus === 'pending' && c.boldsignSentAt) {
      return {
        note: `Awaiting signature since ${this.fmtShortDate(c.boldsignSentAt)}`,
        noteUrgency: 'warn',
      };
    }
    const share = c.lead?.dealShares?.[0];
    if (share) {
      const last = share.lastOpenedAt ?? share.createdAt;
      const silentDays = Math.floor((now.getTime() - new Date(last).getTime()) / DAY);
      // Bounded: past 30 days this stops being "silent" and starts being stale
      // data, and reporting "buyer silent 109 days" as a blocker is just noise.
      if (silentDays >= 3 && silentDays <= 30) {
        return { note: `Buyer silent ${silentDays} days`, noteUrgency: 'warn' };
      }
    }
    if (c.contractStatus === 'inspection' && c.contractDate && c.inspectionPeriodDays) {
      const ends = new Date(new Date(c.contractDate).getTime() + c.inspectionPeriodDays * DAY);
      return { note: `Inspection ends ${this.fmtShortDate(ends)}`, noteUrgency: 'neutral' };
    }
    const label = (c.contractStatus || 'open').replace(/-/g, ' ');
    const strategy = (c.exitStrategy || '').replace(/_/g, ' ');
    return { note: strategy ? `${strategy}, ${label}` : label, noteUrgency: 'neutral' };
  }

  /**
   * Score every candidate action and return the top 5. Weights follow the spec:
   * dollars at risk today, not recency.
   */
  private buildActions(ctx: {
    now: Date;
    unread: any[];
    twoHoursAgo: Date;
    foreclosureRows: any[];
    openContracts: any[];
    in7: Date;
    pendingOffers: any[];
    overdueTasks: any[];
    staleLeads: number;
  }): DigestAction[] {
    const out: DigestAction[] = [];
    const { now } = ctx;

    for (const l of ctx.unread) {
      if (!l.lastMessageAt || l.lastMessageAt > ctx.twoHoursAgo) continue;
      const hours = (now.getTime() - l.lastMessageAt.getTime()) / 3_600_000;
      const value = this.leadValue(l);
      const score = (100 + hours) * (l.tier === 1 ? 2 : 1);
      out.push({
        title: `Answer ${this.personName(l)}`,
        detail: [
          this.place(l),
          this.tierLabel(l.tier, l.scoreBand),
          `waiting ${this.fmtWait(now.getTime() - l.lastMessageAt.getTime())}`,
          value > 0 ? `${this.moneyCompact(value)} spread` : null,
        ].filter(Boolean).join(' · '),
        ctaLabel: 'Open lead',
        ctaUrl: this.leadUrl(l.id),
        score,
        urgency: 'critical',
        category: 'reply',
      });
    }

    for (const f of ctx.foreclosureRows) {
      if (!f.saleDate) continue;
      const days = this.daysUntil(f.saleDate, now);
      if (days > 14) continue;
      // Urgency alone is not worth much. A LOW-priority, score-11 notice two
      // counties over should not outrank a HIGH, score-63 one day later, so
      // the skip-trace score and priority both weigh in.
      const priorityMultiplier =
        f.priority === 'HIGH' ? 1.5 : f.priority === 'MEDIUM' ? 1.0 : 0.7;
      const score = (90 + (14 - days) * 3 + (f.leadScore ?? 0) * 0.4) * priorityMultiplier;
      const owner = this.cleanOwnerName(f.countyOwner);
      out.push({
        title: owner
          ? `Call ${owner}, sale in ${days} day${days === 1 ? '' : 's'}`
          : `Owner unknown, sale in ${days} day${days === 1 ? '' : 's'}`,
        detail: [
          this.place({ propertyAddress: f.lead?.propertyAddress, propertyCity: f.lead?.propertyCity }),
          f.noticeType ? f.noticeType.replace(/_/g, ' ') : null,
          f.priority,
          f.equitySpread != null ? `${this.moneyCompact(f.equitySpread)} equity` : null,
          f.workStatus === 'NOT_CONTACTED' ? 'never contacted' : null,
        ].filter(Boolean).join(' · '),
        ctaLabel: 'Open foreclosure',
        ctaUrl: f.lead ? this.leadUrl(f.lead.id) : `${this.appUrl}/foreclosures`,
        score,
        urgency: days <= 5 ? 'critical' : 'warn',
        category: 'foreclosure',
      });
    }

    for (const c of ctx.openContracts) {
      if (!c.expectedCloseDate) continue;
      const delta = this.daysDelta(c.expectedCloseDate, now);

      // Already blew its close date. Either it slipped and the record is stale,
      // or the deal died and nobody marked it. Both need a human today.
      if (delta < 0) {
        out.push({
          title: 'Reset or kill a contract that missed its close date',
          detail: `${this.place(c.lead)} · was due ${this.fmtShortDate(c.expectedCloseDate)} · ${Math.abs(delta)} days ago · still ${(c.contractStatus || 'open').replace(/-/g, ' ')}`,
          ctaLabel: 'Open contract',
          ctaUrl: this.leadUrl(c.lead.id, '/contract'),
          score: 88,
          urgency: 'critical',
          category: 'closing',
        });
        continue;
      }

      if (delta <= 7 && !c.titleCompany) {
        out.push({
          title: 'Assign title before this one closes',
          detail: `${this.place(c.lead)} · closes in ${delta} day${delta === 1 ? '' : 's'} · no title company on the contract`,
          ctaLabel: 'Open contract',
          ctaUrl: this.leadUrl(c.lead.id, '/contract'),
          score: 85,
          urgency: 'critical',
          category: 'closing',
        });
      }
    }

    for (const c of ctx.openContracts) {
      if (c.boldsignStatus !== 'pending' || !c.boldsignSentAt) continue;
      const days = Math.floor((now.getTime() - c.boldsignSentAt.getTime()) / DAY);
      if (days < 3) continue;
      out.push({
        title: 'Chase an unsigned contract',
        detail: `${this.place(c.lead)} · sent ${days} days ago · still pending signature`,
        ctaLabel: 'Open contract',
        ctaUrl: this.leadUrl(c.lead.id, '/contract'),
        score: 75 + days,
        urgency: 'warn',
        category: 'signature',
      });
    }

    for (const o of ctx.pendingOffers) {
      const days = Math.floor((now.getTime() - o.offerDate.getTime()) / DAY);
      out.push({
        title: 'Follow up on an offer with no answer',
        detail: `${this.place(o.lead)} · ${this.money(o.offerAmount)} sent ${days} days ago · still pending`,
        ctaLabel: 'Review and follow up',
        ctaUrl: this.leadUrl(o.lead.id, '/offers'),
        score: 80,
        urgency: 'warn',
        category: 'offer',
      });
    }

    for (const t of ctx.overdueTasks) {
      const days = Math.floor((now.getTime() - t.dueDate.getTime()) / DAY);
      out.push({
        title: t.title,
        detail: `${this.place(t.lead)} · due ${this.fmtShortDate(t.dueDate)} · ${days > 0 ? `${days} days overdue` : 'due today'}`,
        ctaLabel: 'Open lead',
        ctaUrl: this.leadUrl(t.lead.id),
        // Capped: a task forgotten since March should not outrank a seller who
        // replied an hour ago. Aging tops out after two weeks.
        score: 60 + Math.min(days, 14),
        urgency: days >= 3 ? 'warn' : 'neutral',
        category: 'task',
      });
    }

    if (ctx.staleLeads >= 5) {
      out.push({
        title: `Clear the cold queue: ${ctx.staleLeads} leads untouched 3+ days`,
        detail: 'Requalify or move to nurture so they stop counting against the board',
        ctaLabel: 'Open the queue',
        ctaUrl: `${this.appUrl}/leads?filter=stale`,
        score: 40,
        urgency: 'neutral',
        category: 'cleanup',
      });
    }

    // Two passes of thinning:
    //   1. One lead gets one slot, so a single messy deal (unanswered reply +
    //      overdue task + stalled offer) cannot eat the whole list.
    //   2. At most 2 per category, so a heavy foreclosure ingest cannot bury
    //      every closing, offer, and reply behind five identical call tasks.
    //      A "top 5 things to do" made of one category is a filtered list, not
    //      a prioritized one.
    const CATEGORY_CAP = 2;
    const seen = new Set<string>();
    const byCategory = new Map<string, number>();
    const picked: DigestAction[] = [];

    for (const a of out.sort((x, y) => y.score - x.score)) {
      const key = a.ctaUrl.match(/\/leads\/([^/?#]+)/)?.[1] ?? a.ctaUrl;
      if (seen.has(key)) continue;
      if ((byCategory.get(a.category) ?? 0) >= CATEGORY_CAP) continue;
      seen.add(key);
      byCategory.set(a.category, (byCategory.get(a.category) ?? 0) + 1);
      picked.push(a);
      if (picked.length === 5) break;
    }

    // If the caps left the list short (a genuinely one-sided day), backfill by
    // score so the reader still gets five things.
    if (picked.length < 5) {
      for (const a of out) {
        if (picked.length === 5) break;
        const key = a.ctaUrl.match(/\/leads\/([^/?#]+)/)?.[1] ?? a.ctaUrl;
        if (seen.has(key)) continue;
        seen.add(key);
        picked.push(a);
      }
    }

    return picked.sort((a, b) => b.score - a.score);
  }

  /**
   * The single most important thing on the board. Ranked rules, first non-empty
   * wins: unanswered reply on the most valuable lead, then an imminent
   * foreclosure sale, then a closing with a blocker.
   */
  private buildBigThing(ctx: {
    now: Date;
    unread: any[];
    foreclosureRows: any[];
    openContracts: any[];
    in7: Date;
  }): BigThing | null {
    const { now } = ctx;

    if (ctx.unread.length) {
      const best = [...ctx.unread].sort((a, b) => {
        const tierDiff = (a.tier ?? 9) - (b.tier ?? 9);
        if (tierDiff !== 0) return tierDiff;
        return this.leadValue(b) - this.leadValue(a);
      })[0];
      const waited = best.lastMessageAt ? now.getTime() - best.lastMessageAt.getTime() : 0;
      const value = this.leadValue(best);
      const time = best.lastMessageAt
        ? new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: 'numeric', minute: '2-digit' }).format(best.lastMessageAt)
        : 'earlier';

      return {
        headline: `${this.personName(best)} wrote back at ${time} and is still waiting.`,
        detail: `${this.place(best)}. The reply has been sitting ${this.fmtWait(waited)} unanswered.${
          best.lastMessagePreview ? ` They said: "${this.truncate(best.lastMessagePreview, 110)}"` : ''
        }`,
        whyItMatters: value > 0
          ? `Biggest unanswered thread on the board at roughly ${this.money(value)} of spread. Reply rates fall off a cliff after the first few hours.`
          : 'Nothing else on the board is a warm seller who already raised their hand. Reply rates fall off a cliff after the first few hours.',
        ctaLabel: `Open ${best.sellerFirstName || 'the'} thread`,
        ctaUrl: this.leadUrl(best.id),
        phone: this.fmtPhone(best.sellerPhone),
      };
    }

    // Among the notices selling this week, lead with the one actually worth a
    // call. Picking whichever sells soonest put a LOW-priority, score-11 notice
    // two counties over at the top of the brief while a HIGH, score-63 one day
    // later sat in a table below.
    const imminent = ctx.foreclosureRows
      .filter((f) => f.saleDate && this.daysUntil(f.saleDate, now) <= 5)
      .sort((a, b) => {
        const rank = (p?: string) => (p === 'HIGH' ? 2 : p === 'MEDIUM' ? 1 : 0);
        const pd = rank(b.priority) - rank(a.priority);
        if (pd !== 0) return pd;
        const sd = (b.leadScore ?? 0) - (a.leadScore ?? 0);
        if (sd !== 0) return sd;
        return a.saleDate.getTime() - b.saleDate.getTime();
      })[0];
    if (imminent) {
      const days = this.daysUntil(imminent.saleDate, now);
      return {
        headline: `${this.place({
          propertyAddress: imminent.lead?.propertyAddress,
          propertyCity: imminent.lead?.propertyCity,
        })} sells at auction in ${days} day${days === 1 ? '' : 's'}.`,
        detail: `${(imminent.noticeType || 'foreclosure').replace(/_/g, ' ')} · sale ${this.fmtShortDate(imminent.saleDate)} · priority ${imminent.priority || 'unset'} · score ${imminent.leadScore ?? 0}${
          imminent.equitySpread != null ? ` · ${this.money(imminent.equitySpread)} equity spread` : ''
        }`,
        whyItMatters: imminent.workStatus === 'NOT_CONTACTED'
          ? 'Nobody has contacted this owner yet. After the sale date there is no deal here at any price.'
          : 'The window closes on the sale date. Everything else on the board can wait a day; this cannot.',
        ctaLabel: 'Open foreclosure',
        ctaUrl: imminent.lead ? this.leadUrl(imminent.lead.id) : `${this.appUrl}/foreclosures`,
        phone: this.fmtPhone(imminent.lead?.sellerPhone),
      };
    }

    const blocked = ctx.openContracts.find(
      (c) => c.expectedCloseDate && c.expectedCloseDate <= ctx.in7 && !c.titleCompany,
    );
    if (blocked) {
      const days = this.daysUntil(blocked.expectedCloseDate, now);
      return {
        headline: `${this.place(blocked.lead)} closes in ${days} day${days === 1 ? '' : 's'} with no title company.`,
        detail: `${this.money(blocked.assignmentFee)} assignment fee · ${(blocked.contractStatus || '').replace(/-/g, ' ')} · expected ${this.fmtShortDate(blocked.expectedCloseDate)}`,
        whyItMatters: 'Title takes days to open a file. This is the one thing on the board that turns a signed deal into a missed close.',
        ctaLabel: 'Open contract',
        ctaUrl: this.leadUrl(blocked.lead.id, '/contract'),
        phone: null,
      };
    }

    return null;
  }

  /** Yesterday's activity counts. Cheap aggregate queries, no row hydration. */
  private async buildYesterday(orgId: string | null, since: Date, now: Date): Promise<YesterdayStat[]> {
    const leadOrg = orgId ? { lead: { organizationId: orgId } } : {};
    const window = { gte: since, lt: now };

    const [sent, replies, calls, connected, offers, countered, contracts, contractRows] =
      await Promise.all([
        this.prisma.message.count({ where: { ...leadOrg, direction: 'OUTBOUND', createdAt: window } }),
        this.prisma.message.count({ where: { ...leadOrg, direction: 'INBOUND', createdAt: window } }),
        this.prisma.callLog.count({ where: { ...leadOrg, createdAt: window } }),
        this.prisma.callLog.count({ where: { ...leadOrg, createdAt: window, duration: { gte: 30 } } }),
        this.prisma.offer.count({ where: { ...leadOrg, offerDate: window } }),
        this.prisma.offer.count({ where: { ...leadOrg, offerDate: window, status: 'countered' } }),
        this.prisma.contract.count({ where: { ...leadOrg, createdAt: window } }),
        this.prisma.contract.findMany({
          where: { ...leadOrg, createdAt: window },
          select: { assignmentFee: true },
        }),
      ]);

    const stats: YesterdayStat[] = [];
    if (sent) {
      const rate = sent ? Math.round((replies / sent) * 100) : 0;
      stats.push({ text: `${sent} texts sent · **${replies} replies** (${rate}%)` });
    }
    if (calls) stats.push({ text: `${calls} calls · **${connected} connected**` });
    if (offers) stats.push({ text: `${offers} offers sent · **${countered} countered**` });
    if (contracts) {
      const fees = contractRows.reduce((s, c) => s + (c.assignmentFee || 0), 0);
      stats.push({
        text: `${contracts} contract${contracts > 1 ? 's' : ''} signed${fees ? ` · **${this.money(fees)}**` : ''}`,
      });
    }
    return stats;
  }

  /** Subject line, rebuilt daily from whatever is most urgent. */
  private buildSubject(b: DigestBrief): string {
    const parts: string[] = [];
    if (b.waitingTotal) {
      parts.push(`${b.waitingTotal} repl${b.waitingTotal === 1 ? 'y' : 'ies'} waiting`);
    }
    const urgentForeclosures = b.foreclosures.filter((f) => f.urgency === 'critical').length;
    if (urgentForeclosures) {
      parts.push(`${urgentForeclosures} sale date${urgentForeclosures > 1 ? 's' : ''} inside a week`);
    }
    const urgentDeals = b.dealsInMotion.filter((d) => d.daysUrgency === 'critical').length;
    if (urgentDeals && parts.length < 2) {
      parts.push(`${urgentDeals} closing${urgentDeals > 1 ? 's' : ''} this week`);
    }
    if (b.newOvernightTotal && parts.length < 2) {
      parts.push(`${b.newOvernightTotal} new lead${b.newOvernightTotal > 1 ? 's' : ''}`);
    }
    if (!parts.length && b.actions.length) {
      parts.push(`${b.actions.length} thing${b.actions.length > 1 ? 's' : ''} need you today`);
    }
    if (!parts.length) parts.push('pipeline is clear');
    return `Dealcore Daily: ${parts.slice(0, 2).join(', ')}`;
  }
}

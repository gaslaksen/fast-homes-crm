import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
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

/**
 * How a pre-foreclosure sale date maps to whether it is worth working.
 *
 * Counter-intuitive but load-bearing: a sale two days out is NOT the most
 * urgent thing on the board, it is the least actionable. Reaching the owner,
 * agreeing a number, and closing takes 2-3 weeks minimum. Inside that, there is
 * no path at any price, so ranking by "soonest sale" surfaces exactly the
 * notices nobody can do anything about, and it surfaces the same one every
 * morning as its date creeps closer.
 *
 * The real signal is a sale far enough out to actually work.
 */
const FORECLOSURE_MIN_WORKABLE_DAYS = 14;
const FORECLOSURE_IDEAL_DAYS = 35;
const FORECLOSURE_MAX_WATCH_DAYS = 75;

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
    const workableFrom = new Date(now.getTime() + FORECLOSURE_MIN_WORKABLE_DAYS * DAY);
    const workableTo = new Date(now.getTime() + FORECLOSURE_MAX_WATCH_DAYS * DAY);
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
      foreclosureTooLate,
      recentMedia,
      foreclosureOpenTotal,
      foreclosureNew,
      pendingOffers,
      overdueTasks,
      topCity,
    ] = await Promise.all([
      // Inbound replies nobody has ANSWERED.
      //
      // Deliberately not filtered on threadUnread: that flag is cleared the
      // moment someone opens the thread in the inbox, so a teammate who reads a
      // message and gets distracted makes it disappear from this list. Read is
      // not answered. The only honest signal is that the newest message in the
      // thread is still inbound.
      this.prisma.lead.findMany({
        where: {
          ...active,
          lastMessageDirection: 'INBOUND',
          // A five-month-old unanswered text is a nurture problem, not a reply
          // you are about to send. Past two weeks it stops belonging here.
          lastMessageAt: { gte: new Date(now.getTime() - 14 * DAY) },
        },
        orderBy: { lastMessageAt: 'asc' },
        take: 12,
        select: {
          id: true, sellerFirstName: true, sellerLastName: true, sellerPhone: true,
          propertyAddress: true, propertyCity: true, tier: true, scoreBand: true,
          lastMessageAt: true, lastMessagePreview: true, arv: true, askingPrice: true,
          currentRepairEstimate: true, currentDealNumbers: true, sellerMotivation: true,
          threadUnread: true,
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

      // The workable window, not "soonest". Ordered by how good the lead is,
      // because inside this window every one of them is still reachable.
      this.prisma.foreclosureDetail.findMany({
        where: {
          ...org,
          saleDate: { gte: workableFrom, lte: workableTo },
          workStatus: { not: 'DEAD' },
          doNotCall: false,
        },
        orderBy: [{ leadScore: 'desc' }, { saleDate: 'asc' }],
        take: 6,
        include: { lead: { select: { id: true, propertyAddress: true, propertyCity: true, sellerPhone: true } } },
      }),

      // Counted, not listed. These are past the point of being workable, so
      // they get one honest line instead of five cards nobody can act on.
      this.prisma.foreclosureDetail.count({
        where: {
          ...org,
          saleDate: { gte: now, lt: workableFrom },
          workStatus: { not: 'DEAD' },
          doNotCall: false,
        },
      }),

      // Sellers who sent photos. A seller who bothers to photograph their own
      // house is showing more intent than anything else in the pipeline, and
      // that signal was previously invisible to the brief.
      this.prisma.message.findMany({
        where: {
          ...leadOrg,
          direction: 'INBOUND',
          mediaUrls: { not: Prisma.DbNull },
          createdAt: { gte: new Date(now.getTime() - 7 * DAY) },
        },
        orderBy: { createdAt: 'desc' },
        take: 25,
        select: { leadId: true, createdAt: true, mediaUrls: true, body: true },
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

    // leadId -> the most recent photo drop, for whichever leads are unanswered.
    const photoByLead = new Map<string, { at: Date; count: number; body: string }>();
    for (const m of recentMedia) {
      if (!m.leadId || photoByLead.has(m.leadId)) continue;
      const urls = Array.isArray(m.mediaUrls) ? m.mediaUrls.length : 1;
      photoByLead.set(m.leadId, { at: m.createdAt, count: urls, body: m.body || '' });
    }

    // What the last few briefs opened with, so today's does not repeat them.
    const recentRuns = orgId
      ? await this.prisma.digestRun.findMany({
          where: { organizationId: orgId, sentAt: { gte: new Date(now.getTime() - 4 * DAY) } },
          orderBy: { sentAt: 'desc' },
          take: 4,
          select: { bigThingKey: true },
        })
      : [];
    const recentKeys = new Set(
      recentRuns.map((r) => r.bigThingKey).filter((k): k is string => !!k),
    );

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
      const photo = photoByLead.get(l.id);
      const flags = [
        photo ? `sent ${photo.count} photo${photo.count === 1 ? '' : 's'}` : null,
        // "Someone opened this and walked away" is a different failure from
        // "nobody has looked yet", and it is the more embarrassing one.
        !l.threadUnread && waitedMs > 2 * 60 * 60 * 1000 ? 'read, not answered' : null,
      ].filter(Boolean) as string[];

      return {
        name: this.personName(l),
        property: this.place(l),
        tierLabel: [this.tierLabel(l.tier, l.scoreBand), ...flags].join(' · '),
        waitedLabel: this.fmtWait(waitedMs),
        preview: this.truncate(l.lastMessagePreview),
        url: this.leadUrl(l.id),
        urgency: photo || waitedMs > 12 * 60 * 60 * 1000
          ? 'critical'
          : waitedMs > 4 * 60 * 60 * 1000 ? 'warn' : 'neutral',
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
      // Inside this list everything is workable, so colour by lead quality
      // rather than by countdown. Red-for-imminent trained the eye onto the
      // notices that were already lost.
      const quality: DigestUrgency =
        f.priority === 'HIGH' ? 'critical' : f.priority === 'MEDIUM' ? 'warn' : 'neutral';
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
        daysLabel: `${days} day${days === 1 ? '' : 's'} out`,
        facts, status,
        url: f.lead ? this.leadUrl(f.lead.id) : `${this.appUrl}/foreclosures`,
        urgency: quality,
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
      pendingOffers, overdueTasks, staleLeads, photoByLead,
    });

    // ── Big thing ───────────────────────────────────────────────────────────
    const bigThing = this.buildBigThing({
      now, unread, foreclosureRows, openContracts, in7, photoByLead, recentKeys,
    });

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
      foreclosureTooLateNote: foreclosureTooLate
        ? `${foreclosureTooLate} more sell inside ${FORECLOSURE_MIN_WORKABLE_DAYS} days, too close to work.`
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
    photoByLead: Map<string, { at: Date; count: number; body: string }>;
  }): DigestAction[] {
    const out: DigestAction[] = [];
    const { now } = ctx;

    for (const l of ctx.unread) {
      if (!l.lastMessageAt || l.lastMessageAt > ctx.twoHoursAgo) continue;
      const hours = (now.getTime() - l.lastMessageAt.getTime()) / 3_600_000;
      const value = this.leadValue(l);
      const photo = ctx.photoByLead.get(l.id);

      // A seller who photographs their own house has done work to sell it to
      // you. Nothing else in the pipeline is a stronger buying signal, so this
      // outranks every standing condition on the board.
      if (photo) {
        out.push({
          title: `${this.personName(l)} sent ${photo.count} photo${photo.count === 1 ? '' : 's'} and is still waiting`,
          detail: [
            this.place(l),
            this.tierLabel(l.tier, l.scoreBand),
            `${this.fmtWait(now.getTime() - photo.at.getTime())} with no reply`,
            value > 0 ? `${this.moneyCompact(value)} spread` : null,
          ].filter(Boolean).join(' · '),
          ctaLabel: 'Open the thread',
          ctaUrl: this.leadUrl(l.id),
          // Bounded: age breaks ties between photo drops, it does not let an
          // old one outrank a fresh one by three orders of magnitude.
          score: 400 + Math.min(hours, 72),
          urgency: 'critical',
          category: 'photos',
        });
        continue;
      }

      // Capped at 3 days of aging. Unbounded hours let a 143-day-old thread
      // score 3551 and bury every other category in the list.
      const score = (100 + Math.min(hours, 72)) * (l.tier === 1 ? 2 : 1);
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
      // Below the workable floor there is no deal to be had, so it is not a
      // task. ctx.foreclosureRows is already filtered to the window; this is a
      // belt-and-braces guard.
      if (days < FORECLOSURE_MIN_WORKABLE_DAYS || days > FORECLOSURE_MAX_WATCH_DAYS) continue;

      const priorityMultiplier =
        f.priority === 'HIGH' ? 1.5 : f.priority === 'MEDIUM' ? 1.0 : 0.7;
      // Peaks at the ideal lead time and tapers either side: too close to work,
      // or far enough out that it can wait for tomorrow's brief.
      const timing = 1 - Math.min(1, Math.abs(days - FORECLOSURE_IDEAL_DAYS) / FORECLOSURE_IDEAL_DAYS);
      const untouched = f.workStatus === 'NOT_CONTACTED' ? 12 : 0;
      const score = (55 + timing * 25 + (f.leadScore ?? 0) * 0.4 + untouched) * priorityMultiplier;
      const owner = this.cleanOwnerName(f.countyOwner);
      out.push({
        title: owner
          ? `Call ${owner}, ${days} days to work it`
          : `Skip-trace and call, ${days} days to work it`,
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
        urgency: f.priority === 'HIGH' ? 'critical' : 'warn',
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
    photoByLead: Map<string, { at: Date; count: number; body: string }>;
    /** bigThingKeys from the last few sends, so the brief does not repeat itself. */
    recentKeys: Set<string>;
  }): BigThing | null {
    const { now } = ctx;

    // A seller who sent photos and got silence is the single most newsworthy
    // thing that can happen in a day: it is new, it is human, and it is
    // recoverable. It leads even over a high-value thread with no media.
    const withPhotos = ctx.unread
      .filter((l) => ctx.photoByLead.has(l.id) && !ctx.recentKeys.has(`lead:${l.id}`))
      .sort((a, b) => {
        const pa = ctx.photoByLead.get(a.id)!, pb = ctx.photoByLead.get(b.id)!;
        return pa.at.getTime() - pb.at.getTime();
      })[0];

    if (withPhotos) {
      const photo = ctx.photoByLead.get(withPhotos.id)!;
      const waited = now.getTime() - photo.at.getTime();
      const value = this.leadValue(withPhotos);
      return {
        key: `lead:${withPhotos.id}`,
        headline: `${this.personName(withPhotos)} sent ${photo.count} photo${photo.count === 1 ? '' : 's'} of the house and nobody has replied.`,
        detail: `${this.place(withPhotos)}. Came in ${this.fmtWait(waited)} ago.${
          photo.body ? ` They wrote: "${this.truncate(photo.body, 110)}"` : ''
        }`,
        whyItMatters: `A seller who photographs their own house is selling it to you. That is the strongest buying signal in the pipeline${
          value > 0 ? `, and this one carries roughly ${this.money(value)} of spread` : ''
        }. Silence after that reads as disinterest and is the easiest deal on the board to lose.`,
        ctaLabel: 'Open the thread',
        ctaUrl: this.leadUrl(withPhotos.id),
        phone: this.fmtPhone(withPhotos.sellerPhone),
      };
    }

    const freshUnread = ctx.unread.filter((l) => !ctx.recentKeys.has(`lead:${l.id}`));
    if (freshUnread.length) {
      const best = [...freshUnread].sort((a, b) => {
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
        key: `lead:${best.id}`,
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

    // Only ever lead with a notice that can still be worked, and never with one
    // that led a recent brief. Both rules exist because a countdown on an
    // unwinnable property was opening the email several mornings running.
    const imminent = ctx.foreclosureRows
      .filter((f) => {
        if (!f.saleDate) return false;
        const d = this.daysUntil(f.saleDate, now);
        if (d < FORECLOSURE_MIN_WORKABLE_DAYS || d > FORECLOSURE_MAX_WATCH_DAYS) return false;
        if (f.workStatus !== 'NOT_CONTACTED') return false;
        return f.lead ? !ctx.recentKeys.has(`lead:${f.lead.id}`) : true;
      })
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
        key: imminent.lead ? `lead:${imminent.lead.id}` : `fc:${imminent.id}`,
        headline: `${this.place({
          propertyAddress: imminent.lead?.propertyAddress,
          propertyCity: imminent.lead?.propertyCity,
        })} has ${days} days left to work, and nobody has called.`,
        detail: `${(imminent.noticeType || 'foreclosure').replace(/_/g, ' ')} · sale ${this.fmtShortDate(imminent.saleDate)} · priority ${imminent.priority || 'unset'} · score ${imminent.leadScore ?? 0}${
          imminent.equitySpread != null ? ` · ${this.money(imminent.equitySpread)} equity spread` : ''
        }`,
        whyItMatters: `Reaching the owner, agreeing a number, and closing takes two to three weeks. ${days} days is enough to do that, and it will not be in a week. This is the last useful window, not the sale date.`,
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
        key: `lead:${blocked.lead.id}`,
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
    if (sent || replies) {
      // No percentage: inbound in this window can be answering sends from days
      // ago, which produced "7 texts sent, 8 replies (114%)". Two honest counts
      // beat one ratio that cannot mean what it appears to mean.
      stats.push({ text: `${sent} texts out · **${replies} inbound**` });
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
    const workable = b.foreclosures.filter((f) => f.urgency === 'critical').length;
    if (workable) {
      parts.push(`${workable} foreclosure${workable > 1 ? 's' : ''} worth calling`);
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

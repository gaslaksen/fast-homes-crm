import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
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
        take: 1,
      }),
    ]);

    const yesterday = await this.buildYesterday(orgId, since, now);

    // ── Board ───────────────────────────────────────────────────────────────
    const closingSoon = openContracts.filter(
      (c) => c.expectedCloseDate && c.expectedCloseDate <= in60 && c.expectedCloseDate >= now,
    );
    const expectedFees = closingSoon.reduce((sum, c) => sum + (c.assignmentFee || 0), 0);
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
        subtext: newContracts ? `up ${newContracts} since yesterday` : 'no change',
        urgency: newContracts ? 'good' : 'neutral',
      },
      {
        label: 'Expected fees', value: this.moneyCompact(expectedFees),
        subtext: `${closingSoon.length} deals, 60 days`, urgency: 'good',
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
    const dealsInMotion: DealRow[] = openContracts.slice(0, 6).map((c) => {
      const close = c.expectedCloseDate;
      const days = close ? this.daysUntil(close, now) : null;
      const { note, noteUrgency } = this.contractBlocker(c, now, days);
      return {
        property: this.place(c.lead),
        note, noteUrgency,
        closeLabel: close ? this.fmtShortDate(close) : 'No date set',
        daysLabel: days == null ? 'unscheduled' : `${days} days`,
        daysUrgency: days == null ? 'warn' : days <= 5 ? 'critical' : days <= 14 ? 'warn' : 'neutral',
        fee: this.money(c.assignmentFee),
        url: this.leadUrl(c.lead.id, '/contract'),
      };
    });

    // ── Foreclosure watch ───────────────────────────────────────────────────
    const foreclosures: ForeclosureRow[] = foreclosureRows.map((f) => {
      const days = f.saleDate ? this.daysUntil(f.saleDate, now) : 99;
      const facts = [
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
      if (silentDays >= 3) {
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
      });
    }

    for (const f of ctx.foreclosureRows) {
      if (!f.saleDate) continue;
      const days = this.daysUntil(f.saleDate, now);
      if (days > 14) continue;
      const score = (90 + (14 - days) * 3) * (f.priority === 'HIGH' ? 1.5 : 1);
      out.push({
        title: `Call ${this.personName({
          sellerFirstName: f.countyOwner?.split(' ')[0],
          sellerLastName: f.countyOwner?.split(' ').slice(1).join(' '),
        })}, sale in ${days} day${days === 1 ? '' : 's'}`,
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
      });
    }

    for (const c of ctx.openContracts) {
      if (!c.expectedCloseDate || c.expectedCloseDate > ctx.in7) continue;
      if (c.titleCompany) continue;
      out.push({
        title: 'Assign title before this one closes',
        detail: `${this.place(c.lead)} · closes in ${this.daysUntil(c.expectedCloseDate, now)} days · no title company on the contract`,
        ctaLabel: 'Open contract',
        ctaUrl: this.leadUrl(c.lead.id, '/contract'),
        score: 85,
        urgency: 'critical',
      });
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
      });
    }

    // One lead gets one slot. Without this a single messy deal (unanswered
    // reply + overdue task + stalled offer) eats the whole list.
    const seen = new Set<string>();
    const deduped: DigestAction[] = [];
    for (const a of out.sort((x, y) => y.score - x.score)) {
      const key = a.ctaUrl.match(/\/leads\/([^/?#]+)/)?.[1] ?? a.ctaUrl;
      if (seen.has(key)) continue;
      seen.add(key);
      deduped.push(a);
      if (deduped.length === 5) break;
    }
    return deduped;
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
        phone: best.sellerPhone ?? null,
      };
    }

    const imminent = ctx.foreclosureRows.find((f) => f.saleDate && this.daysUntil(f.saleDate, now) <= 5);
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
        phone: imminent.lead?.sellerPhone ?? null,
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

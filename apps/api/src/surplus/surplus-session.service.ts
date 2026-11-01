import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { LeadSource, SurplusQueue, SurplusStage, isCountyContactRole, surplusCallConnected } from '@fast-homes/shared';
import { PrismaService } from '../prisma/prisma.service';
import { SurplusService } from './surplus.service';
import { outreachRank } from './surplus-outreach.util';
import { isSignedStage } from './surplus-progress.util';

/** The most cases the rifle list holds. The course says 10 to 30. */
export const RIFLE_MAX = 30;
/** How many candidates the screen offers beyond the rifle list. */
const CANDIDATES = 40;
const PAGE = 200;
const MAX_PAGES = 50;

export interface SessionNumber {
  number: string;
  type: string | null;
}

export interface SessionPerson {
  heirId: string | null;
  name: string;
  isClaimant: boolean;
  relationship: string | null;
  rankLabel: string;
  numbers: SessionNumber[];
}

export interface SessionCase {
  id: string;
  claimant: string;
  county: string | null;
  caseNumber: string | null;
  address: string | null;
  grossSurplus: number;
  netToClaimant: number;
  shortWindow: boolean;
  daysToCutoff: number | null;
  daysLeft: number | null;
  stage: string | null;
  queue: string;
  queueLabel: string;
  queueReason: string;
  ownerName: string | null;
  tappedAt: Date | null;
  isDeceased: boolean;
  lastTouchedAt: Date | null;
  onRifle: boolean;
  people: SessionPerson[];
}

export interface SessionStats {
  /** Calls placed from the dialer on surplus leads since midnight Eastern. */
  calls: number;
  connected: number;
  /** Calls with an outcome saved. The course's rule is every one. */
  withOutcome: number;
  target: number;
}

export interface WorkSession {
  target: number;
  rifle: SessionCase[];
  candidates: SessionCase[];
  /** Cases taken off the rifle list by this request because they left the callable queues. */
  retired: { id: string; claimant: string }[];
  stats: SessionStats;
  rifleMax: number;
}

/**
 * The "Work today" session: the rifle list in the course's order, one case
 * at a time, with every number in the order to dial and the day's count
 * against the target.
 *
 * The rifle list is a commitment, not a sort: the 10 to 30 cases the team
 * works until each is a yes, a no or a maybe, and a new case enters only
 * when one leaves. Leaving is automatic here: a case that is no longer in
 * Call now or Likely match (signed, dead, held, number gone bad) drops off
 * and the next candidate is offered.
 */
@Injectable()
export class SurplusSessionService {
  private readonly logger = new Logger(SurplusSessionService.name);

  constructor(
    private prisma: PrismaService,
    private surplus: SurplusService,
  ) {}

  async session(opts: { organizationId?: string | null; size?: number | null; county?: string | null; now?: Date }): Promise<WorkSession> {
    const now = opts.now || new Date();
    const target = Math.max(5, Math.min(100, Number(opts.size) || 25));
    const rows = await this.callableRows(opts.organizationId, opts.county);
    const retired = await this.retireLeavers(rows, opts.organizationId);

    const cases = rows.map((r) => this.caseOf(r)).sort(courseOrder);
    const rifle = cases.filter((c) => c.onRifle);
    const candidates = cases.filter((c) => !c.onRifle).slice(0, CANDIDATES);
    const stats = await this.statsToday(opts.organizationId, target, now);
    return { target, rifle, candidates, retired, stats, rifleMax: RIFLE_MAX };
  }

  /** Add to and take off the rifle list. Capped at RIFLE_MAX cases in all. */
  async setRifle(opts: { organizationId?: string | null; add?: string[]; remove?: string[] }): Promise<{ onRifle: number }> {
    const org = opts.organizationId ? { organizationId: opts.organizationId } : {};
    const add = (opts.add || []).filter((x) => typeof x === 'string');
    const remove = (opts.remove || []).filter((x) => typeof x === 'string');
    if (remove.length) {
      await this.prisma.surplusDetail.updateMany({ where: { ...org, leadId: { in: remove } }, data: { rifleAt: null } });
    }
    if (add.length) {
      const current = await this.prisma.surplusDetail.count({ where: { ...org, rifleAt: { not: null } } });
      const adding = await this.prisma.surplusDetail.count({ where: { ...org, leadId: { in: add }, rifleAt: null } });
      if (current + adding > RIFLE_MAX) {
        throw new BadRequestException(
          `The rifle list holds ${RIFLE_MAX} cases at most and has ${current}. Take one off before adding ${adding === 1 ? 'this one' : 'these'}.`,
        );
      }
      await this.prisma.surplusDetail.updateMany({
        where: { ...org, leadId: { in: add }, rifleAt: null, lead: { source: LeadSource.SURPLUS } },
        data: { rifleAt: new Date() },
      });
    }
    const onRifle = await this.prisma.surplusDetail.count({ where: { ...org, rifleAt: { not: null } } });
    return { onRifle };
  }

  /** Every board row in Call now or Likely match, past the early days, Dead hidden. */
  private async callableRows(organizationId?: string | null, county?: string | null): Promise<any[]> {
    const rows: any[] = [];
    for (let page = 1; page <= MAX_PAGES; page += 1) {
      const res: any = await this.surplus.list({
        organizationId: organizationId || undefined,
        group: 'lead',
        pageSize: PAGE,
        page,
        hideDead: true,
        hideEarly: true,
        queue: [SurplusQueue.CALL, SurplusQueue.LIKELY],
        ...(county ? { county } : {}),
      } as any);
      rows.push(...(res.data || []));
      if (page * res.pageSize >= res.total) break;
    }
    return rows;
  }

  /**
   * A rifle case that is no longer callable leaves the list on its own, so
   * the list never fills with cases nobody can ring. Returns who left.
   */
  private async retireLeavers(rows: any[], organizationId?: string | null): Promise<{ id: string; claimant: string }[]> {
    const org = organizationId ? { organizationId } : {};
    const onRifle = await this.prisma.surplusDetail.findMany({
      where: { ...org, rifleAt: { not: null } },
      select: { leadId: true, stage: true, heldAt: true, lead: { select: { sellerFirstName: true, sellerLastName: true } } },
    });
    const callable = new Set(rows.map((r) => r.id));
    const leavers = onRifle.filter((d) => !callable.has(d.leadId) || d.stage === SurplusStage.DEAD || isSignedStage(d.stage) || d.heldAt);
    if (leavers.length) {
      await this.prisma.surplusDetail.updateMany({ where: { leadId: { in: leavers.map((d) => d.leadId) } }, data: { rifleAt: null } });
      this.logger.log(`Rifle list: ${leavers.length} case${leavers.length === 1 ? '' : 's'} left the callable queues and came off`);
    }
    return leavers.map((d) => ({
      id: d.leadId,
      claimant: `${d.lead?.sellerFirstName || ''} ${d.lead?.sellerLastName || ''}`.trim() || 'a claimant',
    }));
  }

  private async statsToday(organizationId: string | null | undefined, target: number, now: Date): Promise<SessionStats> {
    const since = startOfDayEastern(now);
    const calls = await this.prisma.callLog.findMany({
      where: {
        type: 'twilio_browser',
        createdAt: { gte: since },
        lead: { source: LeadSource.SURPLUS, ...(organizationId ? { organizationId } : {}) },
      },
      select: { outcome: true },
    });
    return {
      calls: calls.length,
      connected: calls.filter((c) => surplusCallConnected(c.outcome)).length,
      withOutcome: calls.filter((c) => !!c.outcome).length,
      target,
    };
  }

  private caseOf(r: any): SessionCase {
    const dialable = (phones: any[] | undefined): SessionNumber[] =>
      (phones || []).filter((p) => p?.number && !p.dnc && !p.bad).map((p) => ({ number: p.number, type: p.type || null }));
    const claimant: SessionPerson | null =
      r.isDeceased || r.doNotCall
        ? null
        : { heirId: null, name: r.claimant, isClaimant: true, relationship: null, rankLabel: 'Claimant', numbers: dialable(r.phones) };
    const others: SessionPerson[] = (r.heirs || [])
      .filter((h: any) => !h.deceased && !h.doNotCall && !isCountyContactRole(h.role))
      .map((h: any) => ({
        heirId: h.id,
        name: h.name,
        isClaimant: false,
        relationship: h.relationship || null,
        rank: outreachRank({ isClaimant: false, role: h.role, relationship: h.relationship, deceased: h.deceased, doNotCall: h.doNotCall }),
        numbers: dialable(h.phones),
      }))
      .sort((a: any, b: any) => a.rank.rank - b.rank.rank)
      .map((p: any) => ({ heirId: p.heirId, name: p.name, isClaimant: false, relationship: p.relationship, rankLabel: p.rank.label, numbers: p.numbers }));
    // The course's order: the person who can sign first, then the people who
    // can reach them. Somebody with no dialable number is left off the card.
    const people = [...(claimant ? [claimant] : []), ...others].filter((p) => p.numbers.length);
    return {
      id: r.id,
      claimant: r.claimant,
      county: r.county || null,
      caseNumber: r.caseNumber || null,
      address: r.address || null,
      grossSurplus: r.grossSurplus || 0,
      netToClaimant: r.netToClaimant || 0,
      shortWindow: !!r.shortWindow,
      daysToCutoff: r.daysToCutoff ?? null,
      daysLeft: r.daysRemaining ?? null,
      stage: r.stage || null,
      queue: r.queue,
      queueLabel: r.queueLabel,
      queueReason: r.queueReason,
      ownerName: r.ownerName || null,
      tappedAt: r.tappedAt || null,
      isDeceased: !!r.isDeceased,
      lastTouchedAt: r.lastTouchedAt || null,
      onRifle: !!r.rifleAt,
      people,
    };
  }
}

/**
 * The course sort: short-window cases always on top, then the biggest
 * surplus, then the nearest cutoff.
 */
export function courseOrder(a: SessionCase, b: SessionCase): number {
  if (a.shortWindow !== b.shortWindow) return a.shortWindow ? -1 : 1;
  if ((b.netToClaimant || 0) !== (a.netToClaimant || 0)) return (b.netToClaimant || 0) - (a.netToClaimant || 0);
  const ac = a.daysToCutoff ?? Number.MAX_SAFE_INTEGER;
  const bc = b.daysToCutoff ?? Number.MAX_SAFE_INTEGER;
  return ac - bc;
}

/** Midnight in New York for the day `now` falls on, as an instant. */
export function startOfDayEastern(now: Date): Date {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(now);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value || 0);
  // Hours, minutes and seconds already elapsed today in New York.
  const elapsedMs = ((get('hour') % 24) * 3600 + get('minute') * 60 + get('second')) * 1000;
  const start = new Date(now.getTime() - elapsedMs);
  start.setUTCMilliseconds(0);
  return start;
}

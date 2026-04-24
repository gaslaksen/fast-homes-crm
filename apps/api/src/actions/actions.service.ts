import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { evaluateNeedsReply } from './rules/needs-reply';
import { evaluateFollowUpDue } from './rules/follow-up-due';
import { evaluateContractPending } from './rules/contract-pending';
import { evaluateStaleHotLead } from './rules/stale-hot-lead';
import { evaluateNewLeadInbound } from './rules/new-lead-inbound';
import { evaluateOfferReady } from './rules/offer-ready';
import { evaluateDripReplyReview } from './rules/drip-reply-review';
import { evaluateCampIncomplete } from './rules/camp-incomplete';
import { evaluateExhaustedLead } from './rules/exhausted-lead';
import type { LeadForRules } from './rules/types';
import {
  ACTION_QUEUE_MAX,
  CACHE_TTL_MS,
} from './rules/priorities';
import type {
  ActionItem,
  ActionQueueFilters,
  ActionCategory,
} from './actions.types';

const INACTIVE_STATUSES = ['CLOSED_WON', 'CLOSED_LOST', 'DEAD'];

interface CacheEntry {
  items: ActionItem[];
  computedAt: number;
}

@Injectable()
export class ActionsService {
  private readonly logger = new Logger(ActionsService.name);
  /** Per-user queue cache. Key = userId (empty string for no-user/org-only). */
  private cache = new Map<string, CacheEntry>();

  constructor(private prisma: PrismaService) {}

  async getQueue(
    userId: string | undefined,
    organizationId: string | undefined,
    filters: ActionQueueFilters = {},
  ): Promise<ActionItem[]> {
    const cacheKey = userId || `org:${organizationId || ''}`;
    const cached = this.cache.get(cacheKey);
    let items: ActionItem[];

    if (cached && Date.now() - cached.computedAt < CACHE_TTL_MS) {
      items = cached.items;
    } else {
      items = await this.computeQueue(userId, organizationId);
      this.cache.set(cacheKey, { items, computedAt: Date.now() });
    }

    return this.applyFilters(items, filters);
  }

  async dismiss(userId: string, actionKey: string): Promise<void> {
    await this.prisma.actionDismissal.upsert({
      where: { userId_actionKey: { userId, actionKey } },
      update: { dismissedAt: new Date() },
      create: { userId, actionKey },
    });
    this.invalidate(userId);
  }

  async snooze(userId: string, actionKey: string, until: Date): Promise<void> {
    await this.prisma.actionSnooze.upsert({
      where: { userId_actionKey: { userId, actionKey } },
      update: { snoozedUntil: until },
      create: { userId, actionKey, snoozedUntil: until },
    });
    this.invalidate(userId);
  }

  /**
   * Mark an action as completed. The rule engine is stateless so "completed"
   * means: dismiss the actionKey AND log an Activity row. If the underlying
   * condition still holds on next evaluation, the item will reappear — that's
   * intentional (the dismissal is per-intent, not forever).
   */
  async complete(
    userId: string,
    actionKey: string,
    organizationId?: string,
  ): Promise<void> {
    const [category, leadId] = actionKey.split(':');
    if (!leadId) {
      throw new Error(`Invalid actionKey: ${actionKey}`);
    }
    // Verify lead belongs to org (defense-in-depth for multi-tenant).
    if (organizationId) {
      const lead = await this.prisma.lead.findFirst({
        where: { id: leadId, organizationId },
        select: { id: true },
      });
      if (!lead) {
        throw new Error('Lead not found in organization');
      }
    }

    await this.prisma.$transaction([
      this.prisma.activity.create({
        data: {
          leadId,
          userId,
          type: 'ACTION_COMPLETED',
          description: `${category} action completed`,
          metadata: { actionKey, completedVia: 'dashboard' },
        },
      }),
      this.prisma.actionDismissal.upsert({
        where: { userId_actionKey: { userId, actionKey } },
        update: { dismissedAt: new Date() },
        create: { userId, actionKey },
      }),
    ]);
    this.invalidate(userId);
  }

  async markSeen(userId: string): Promise<void> {
    await this.prisma.actionLastSeen.upsert({
      where: { userId },
      update: { lastSeenAt: new Date() },
      create: { userId },
    });
  }

  async getBadges(
    userId: string | undefined,
    organizationId: string | undefined,
  ): Promise<{ needsReply: number; newLeads: number; unseenCount: number }> {
    const items = await this.getQueue(userId, organizationId);
    const needsReply = items.filter((i) => i.type === 'NEEDS_REPLY').length;
    const newLeads = items.filter((i) => i.type === 'NEW_LEAD_INBOUND').length;

    let unseenCount = items.length;
    if (userId) {
      const lastSeen = await this.prisma.actionLastSeen.findUnique({
        where: { userId },
      });
      if (lastSeen) {
        unseenCount = items.filter(
          (i) => new Date(i.createdAt) > lastSeen.lastSeenAt,
        ).length;
      }
    }

    return { needsReply, newLeads, unseenCount };
  }

  // ── internal ───────────────────────────────────────────────────────────

  private invalidate(userId: string): void {
    this.cache.delete(userId);
  }

  private applyFilters(
    items: ActionItem[],
    filters: ActionQueueFilters,
  ): ActionItem[] {
    let out = items;
    if (filters.category) {
      const cats = Array.isArray(filters.category)
        ? filters.category
        : [filters.category];
      const set = new Set<ActionCategory>(cats);
      out = out.filter((i) => set.has(i.type));
    }
    const sort = filters.sort || 'priority';
    out = [...out].sort((a, b) => {
      if (sort === 'oldest') {
        return (
          new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
        );
      }
      if (sort === 'newest') {
        return (
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
        );
      }
      // priority (default): higher first; tiebreak by createdAt asc (older first)
      if (b.priority !== a.priority) return b.priority - a.priority;
      return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    });
    return out.slice(0, filters.limit || ACTION_QUEUE_MAX);
  }

  private async computeQueue(
    userId: string | undefined,
    organizationId: string | undefined,
  ): Promise<ActionItem[]> {
    const started = Date.now();
    const orgWhere = organizationId ? { organizationId } : {};

    // Pull active leads with everything every rule needs in a single round
    // trip. Cap messages to the most recent 20 per lead for context (enough
    // for hasInbound checks; older inbound on a 20+ touch lead isn't
    // semantically interesting).
    const rawLeads = await this.prisma.lead.findMany({
      where: {
        ...orgWhere,
        status: { notIn: INACTIVE_STATUSES },
        doNotContact: false,
      },
      select: {
        id: true,
        propertyAddress: true,
        propertyCity: true,
        propertyState: true,
        sellerFirstName: true,
        sellerLastName: true,
        tier: true,
        scoreBand: true,
        status: true,
        primaryPhoto: true,
        source: true,
        createdAt: true,
        lastTouchedAt: true,
        touchCount: true,
        campPriorityComplete: true,
        campMoneyComplete: true,
        campChallengeComplete: true,
        campAuthorityComplete: true,
        arv: true,
        askingPrice: true,
        messages: {
          orderBy: { createdAt: 'desc' },
          take: 20,
          select: {
            id: true,
            direction: true,
            body: true,
            createdAt: true,
          },
        },
        tasks: {
          where: { completed: false },
          orderBy: { dueDate: 'asc' },
          take: 10,
          select: {
            id: true,
            title: true,
            dueDate: true,
            completed: true,
          },
        },
        offers: {
          orderBy: { createdAt: 'desc' },
          take: 5,
          select: { id: true, status: true, createdAt: true },
        },
        contract: {
          select: {
            id: true,
            contractStatus: true,
            boldsignSentAt: true,
            boldsignStatus: true,
          },
        },
        dripSequence: {
          select: {
            status: true,
            pausedReason: true,
            lastReplyAt: true,
          },
        },
      },
    });

    const leads: LeadForRules[] = rawLeads as unknown as LeadForRules[];
    const now = new Date();
    const items: ActionItem[] = [
      ...evaluateNeedsReply(leads, now),
      ...evaluateFollowUpDue(leads, now),
      ...evaluateContractPending(leads, now),
      ...evaluateStaleHotLead(leads, now),
      ...evaluateNewLeadInbound(leads, now),
      ...evaluateOfferReady(leads),
      ...evaluateDripReplyReview(leads, now),
      ...evaluateCampIncomplete(leads),
      ...evaluateExhaustedLead(leads, now),
    ];

    // Filter out dismissed/snoozed for this user.
    const filtered = userId
      ? await this.stripUserState(userId, items)
      : items;

    // NOTE: AI drafts are NOT pre-populated here. The UI (ActionCard,
    // Inbox) fetches drafts on demand when the user expands a card or
    // selects a conversation. Pre-populating caused a runaway spend on
    // claude-sonnet-4-5 because the sidebar badge poll (every 60s) races
    // with the 60s cache TTL, forcing a fresh compute + 10 Sonnet calls
    // per minute per open tab whether or not anyone looked at the drafts.

    const ms = Date.now() - started;
    if (ms > 500) {
      this.logger.warn(
        `computeQueue took ${ms}ms for org=${organizationId} (${leads.length} leads, ${filtered.length} actions)`,
      );
    }

    return filtered;
  }

  private async stripUserState(
    userId: string,
    items: ActionItem[],
  ): Promise<ActionItem[]> {
    if (items.length === 0) return items;
    const keys = items.map((i) => i.actionKey);
    const [dismissals, snoozes] = await Promise.all([
      this.prisma.actionDismissal.findMany({
        where: { userId, actionKey: { in: keys } },
        select: { actionKey: true, dismissedAt: true },
      }),
      this.prisma.actionSnooze.findMany({
        where: { userId, actionKey: { in: keys } },
        select: { actionKey: true, snoozedUntil: true },
      }),
    ]);
    const now = new Date();
    // Dismissal is keyed by actionKey but compared against item.createdAt so
    // a new event (e.g. fresh inbound SMS on a dismissed NEEDS_REPLY action)
    // supersedes the prior dismissal. `item.createdAt` for NEEDS_REPLY is the
    // latest inbound message timestamp, so this gives us the "re-appears when
    // the seller replies again" behavior surfaced in the Inbox UI.
    const dismissedAt = new Map<string, Date>(
      dismissals.map((d) => [d.actionKey, d.dismissedAt]),
    );
    const snoozeMap = new Map(
      snoozes.map((s) => [s.actionKey, s.snoozedUntil]),
    );
    return items.filter((i) => {
      const d = dismissedAt.get(i.actionKey);
      if (d && new Date(i.createdAt) <= d) return false;
      const until = snoozeMap.get(i.actionKey);
      if (until && until > now) return false;
      return true;
    });
  }

}

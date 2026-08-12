import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export type InboxFilter = 'all' | 'unread' | 'starred' | 'recent';

const THREAD_SELECT = {
  id: true,
  sellerFirstName: true,
  sellerLastName: true,
  sellerPhone: true,
  propertyAddress: true,
  propertyCity: true,
  propertyState: true,
  primaryPhoto: true,
  scoreBand: true,
  tags: true,
  lastMessagePreview: true,
  lastMessageAt: true,
  lastMessageDirection: true,
  threadUnread: true,
  threadStarred: true,
} satisfies Prisma.LeadSelect;

function toRow(lead: any, unread?: boolean) {
  return {
    leadId: lead.id,
    sellerFirstName: lead.sellerFirstName,
    sellerLastName: lead.sellerLastName,
    sellerPhone: lead.sellerPhone,
    propertyAddress: lead.propertyAddress,
    propertyCity: lead.propertyCity,
    propertyState: lead.propertyState,
    primaryPhoto: lead.primaryPhoto,
    scoreBand: lead.scoreBand,
    tags: lead.tags ?? null,
    lastMessagePreview: lead.lastMessagePreview,
    lastMessageAt: lead.lastMessageAt,
    lastMessageDirection: lead.lastMessageDirection,
    // Per-user when we know who is asking, team-level otherwise.
    threadUnread: unread ?? lead.threadUnread,
    threadStarred: lead.threadStarred,
  };
}

/**
 * A thread counts as unread for a user when the last message came from the
 * seller and that user has not opened the thread since it landed. Expressed
 * once here so the list, the filter and the counts cannot drift apart.
 */
const UNREAD_SQL = Prisma.sql`l."lastMessageDirection" = 'INBOUND'
  AND (v."viewedAt" IS NULL OR v."viewedAt" < l."lastMessageAt")`;

@Injectable()
export class InboxService {
  private readonly logger = new Logger(InboxService.name);

  constructor(private prisma: PrismaService) {}

  // ─── Per-user read state ──────────────────────────────────────────────────

  /**
   * Which of these threads are unread *for this user*. Read state lives in
   * conversation_views (one row per user per lead), so one teammate opening a
   * conversation no longer clears the unread marker for everyone else. That was
   * the bug that had messages silently disappearing from other people's inboxes.
   */
  private async unreadFor(
    userId: string,
    leads: { id: string; lastMessageAt: Date | null; lastMessageDirection: string | null }[],
  ): Promise<Set<string>> {
    const unread = new Set<string>();
    const candidates = leads.filter((l) => l.lastMessageDirection === 'INBOUND');
    if (!candidates.length) return unread;

    const views = await this.prisma.conversationView.findMany({
      where: { userId, leadId: { in: candidates.map((l) => l.id) } },
      select: { leadId: true, viewedAt: true },
    });
    const viewedAt = new Map(views.map((v) => [v.leadId, v.viewedAt]));

    for (const lead of candidates) {
      const seen = viewedAt.get(lead.id);
      if (!seen || (lead.lastMessageAt && seen < lead.lastMessageAt)) unread.add(lead.id);
    }
    return unread;
  }

  /** Search terms as a SQL fragment, matching the Prisma `where.OR` above. */
  private searchSql(search: string): Prisma.Sql {
    const like = `%${search}%`;
    return Prisma.sql`(l."sellerFirstName" ILIKE ${like}
      OR l."sellerLastName" ILIKE ${like}
      OR l."propertyAddress" ILIKE ${like})`;
  }

  /**
   * Lead ids unread for a user, newest message first. Raw SQL because the
   * "not seen since the last message" test correlates two tables, which Prisma's
   * query builder cannot express.
   */
  private async unreadLeadIds(args: {
    userId: string;
    organizationId?: string;
    search?: string;
    skip: number;
    take: number;
  }): Promise<string[]> {
    const where = [UNREAD_SQL];
    if (args.organizationId) where.push(Prisma.sql`l."organizationId" = ${args.organizationId}`);
    if (args.search) where.push(this.searchSql(args.search));

    const rows = await this.prisma.$queryRaw<{ id: string }[]>`
      SELECT l.id
      FROM "leads" l
      LEFT JOIN "conversation_views" v ON v."leadId" = l.id AND v."userId" = ${args.userId}
      WHERE l."lastMessageAt" IS NOT NULL AND ${Prisma.join(where, ' AND ')}
      ORDER BY l."lastMessageAt" DESC
      LIMIT ${args.take} OFFSET ${args.skip}
    `;
    return rows.map((r) => r.id);
  }

  /** How many conversations are waiting on this user. Drives badges. */
  async unreadCount(userId: string, organizationId?: string): Promise<number> {
    const where = [UNREAD_SQL];
    if (organizationId) where.push(Prisma.sql`l."organizationId" = ${organizationId}`);
    try {
      const rows = await this.prisma.$queryRaw<{ count: bigint }[]>`
        SELECT COUNT(*)::bigint AS count
        FROM "leads" l
        LEFT JOIN "conversation_views" v ON v."leadId" = l.id AND v."userId" = ${userId}
        WHERE l."lastMessageAt" IS NOT NULL AND ${Prisma.join(where, ' AND ')}
      `;
      return Number(rows[0]?.count ?? 0);
    } catch (err: any) {
      this.logger.error(`Unread count failed for user ${userId}: ${err.message}`);
      return 0;
    }
  }

  async listThreads(params: {
    organizationId?: string;
    userId?: string;
    filter?: InboxFilter;
    search?: string;
    page?: number;
    limit?: number;
  }) {
    const filter = params.filter || 'all';
    const page = Math.max(1, params.page || 1);
    const limit = Math.min(100, Math.max(1, params.limit || 20));
    const skip = (page - 1) * limit;

    const where: Prisma.LeadWhereInput = {
      lastMessageAt: { not: null },
    };
    if (params.organizationId) where.organizationId = params.organizationId;
    if (filter === 'starred') where.threadStarred = true;

    const search = params.search?.trim();
    if (search) {
      where.OR = [
        { sellerFirstName: { contains: search, mode: 'insensitive' } },
        { sellerLastName: { contains: search, mode: 'insensitive' } },
        { propertyAddress: { contains: search, mode: 'insensitive' } },
      ];
    }

    if (filter === 'recent') {
      return this.listRecent({ ...params, where, skip, limit, page });
    }

    // Unread is per-user, so the page has to be selected by the join rather
    // than by the team-level column. Without a user we fall back to it.
    if (filter === 'unread' && params.userId) {
      return this.listUnread({
        userId: params.userId,
        organizationId: params.organizationId,
        search,
        skip,
        limit,
        page,
      });
    }
    if (filter === 'unread') where.threadUnread = true;

    const rows = await this.prisma.lead.findMany({
      where,
      orderBy: { lastMessageAt: 'desc' },
      select: THREAD_SELECT,
      skip,
      take: limit + 1,
    });

    const hasMore = rows.length > limit;
    const pageRows = rows.slice(0, limit);
    const unread = params.userId ? await this.unreadFor(params.userId, pageRows) : null;
    return {
      items: pageRows.map((l) => toRow(l, unread?.has(l.id))),
      hasMore,
      page,
    };
  }

  /** The unread filter, resolved against this user's own read state. */
  private async listUnread(args: {
    userId: string;
    organizationId?: string;
    search?: string;
    skip: number;
    limit: number;
    page: number;
  }) {
    const ids = await this.unreadLeadIds({
      userId: args.userId,
      organizationId: args.organizationId,
      search: args.search,
      skip: args.skip,
      take: args.limit + 1,
    });

    const hasMore = ids.length > args.limit;
    const pageIds = ids.slice(0, args.limit);
    if (!pageIds.length) return { items: [], hasMore, page: args.page };

    const leads = await this.prisma.lead.findMany({
      where: { id: { in: pageIds } },
      select: THREAD_SELECT,
    });

    // Preserve the newest-message-first order the raw query produced.
    const byId = new Map(leads.map((l) => [l.id, l]));
    const items = pageIds
      .map((id) => byId.get(id))
      .filter(Boolean)
      .map((l) => toRow(l, true));

    return { items, hasMore, page: args.page };
  }

  // "Recent" = conversations this user personally viewed, newest view first.
  private async listRecent(args: {
    userId?: string;
    where: Prisma.LeadWhereInput;
    skip: number;
    limit: number;
    page: number;
  }) {
    if (!args.userId) return { items: [], hasMore: false, page: args.page };

    const views = await this.prisma.conversationView.findMany({
      where: { userId: args.userId },
      orderBy: { viewedAt: 'desc' },
      skip: args.skip,
      take: args.limit + 1,
      select: { leadId: true },
    });

    const hasMore = views.length > args.limit;
    const pageLeadIds = views.slice(0, args.limit).map((v) => v.leadId);
    if (pageLeadIds.length === 0) return { items: [], hasMore, page: args.page };

    const leads = await this.prisma.lead.findMany({
      where: { ...args.where, id: { in: pageLeadIds } },
      select: THREAD_SELECT,
    });

    // Preserve the view order (findMany doesn't guarantee it).
    const byId = new Map(leads.map((l) => [l.id, l]));
    const ordered = pageLeadIds.map((id) => byId.get(id)).filter(Boolean);
    const unread = await this.unreadFor(args.userId, ordered);
    const items = ordered.map((l) => toRow(l, unread.has(l.id)));

    return { items, hasMore, page: args.page };
  }

  async counts(organizationId?: string, userId?: string) {
    const base: Prisma.LeadWhereInput = { lastMessageAt: { not: null } };
    if (organizationId) base.organizationId = organizationId;

    const [all, unread, starred] = await Promise.all([
      this.prisma.lead.count({ where: base }),
      userId
        ? this.unreadCount(userId, organizationId)
        : this.prisma.lead.count({ where: { ...base, threadUnread: true } }),
      this.prisma.lead.count({ where: { ...base, threadStarred: true } }),
    ]);
    return { all, unread, starred };
  }

  // Mark a thread read for this user and record the view (drives "Recent").
  // The team-level column is still cleared: the daily digest reads it, and it
  // remains the fallback for callers that arrive without a user.
  async markRead(leadId: string, userId?: string) {
    await this.prisma.lead.update({
      where: { id: leadId },
      data: { threadUnread: false },
    });
    if (userId) {
      await this.prisma.conversationView.upsert({
        where: { userId_leadId: { userId, leadId } },
        create: { userId, leadId, viewedAt: new Date() },
        update: { viewedAt: new Date() },
      });
    }
    return { success: true };
  }

  async setStarred(leadId: string, starred: boolean) {
    await this.prisma.lead.update({
      where: { id: leadId },
      data: { threadStarred: starred },
    });
    return { success: true, starred };
  }
}

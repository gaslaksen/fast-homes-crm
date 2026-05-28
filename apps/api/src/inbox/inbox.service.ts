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

function toRow(lead: any) {
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
    threadUnread: lead.threadUnread,
    threadStarred: lead.threadStarred,
  };
}

@Injectable()
export class InboxService {
  private readonly logger = new Logger(InboxService.name);

  constructor(private prisma: PrismaService) {}

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
    if (filter === 'unread') where.threadUnread = true;
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

    const rows = await this.prisma.lead.findMany({
      where,
      orderBy: { lastMessageAt: 'desc' },
      select: THREAD_SELECT,
      skip,
      take: limit + 1,
    });

    const hasMore = rows.length > limit;
    return { items: rows.slice(0, limit).map(toRow), hasMore, page };
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
    const items = pageLeadIds
      .map((id) => byId.get(id))
      .filter(Boolean)
      .map(toRow);

    return { items, hasMore, page: args.page };
  }

  async counts(organizationId?: string) {
    const base: Prisma.LeadWhereInput = { lastMessageAt: { not: null } };
    if (organizationId) base.organizationId = organizationId;

    const [all, unread, starred] = await Promise.all([
      this.prisma.lead.count({ where: base }),
      this.prisma.lead.count({ where: { ...base, threadUnread: true } }),
      this.prisma.lead.count({ where: { ...base, threadStarred: true } }),
    ]);
    return { all, unread, starred };
  }

  // Mark a thread read and record the view (drives "Recent").
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

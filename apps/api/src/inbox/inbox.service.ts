import { BadRequestException, Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { numberKey, prettyNumber } from '../phone-numbers/phone-numbers.service';
import { LeadPhonesService, phoneDigitsWhere, phoneSearchDigits } from '../phone-numbers/lead-phones.service';
import {
  SurplusCallOutcome,
  SurplusPersonRole,
  SURPLUS_CALL_OUTCOME_LABEL,
  SURPLUS_PERSON_ROLE_LABEL,
} from '@fast-homes/shared';
import { badPhonesOf } from '../phone-numbers/lead-phones.service';
import { normalizePhoneDigits } from '../foreclosures/foreclosure-scoring.util';
import { contactStampPatch, heirContacts } from '../surplus/surplus-contact-stamp.util';
import { callOutcome } from '../calls/call-outcome.util';

const DAY_MS = 24 * 60 * 60 * 1000;

/** A lead or a person on its case that an unknown call may belong to. */
export interface AttachSuggestion {
  leadId: string;
  heirId: string | null;
  name: string;
  label: string;
  leadName: string;
  propertyAddress: string | null;
  source: string | null;
  /** The near number we hold for them, formatted. */
  numberOnFile: string;
}

/** One number already on file, with how calling it has gone, for choosing which to replace. */
export interface NumberSlot {
  number: string;
  type: string | null;
  /** Marked wrong or disconnected. */
  bad: boolean;
  dnc: string | null;
  /** The lead's primary: drips and automation text it, so it is never replaced here. */
  isPrimary: boolean;
  calls: number;
  lastCallAt: string | null;
  /** "No answer", "Spoke to relative", "Connected" and so on. */
  lastResult: string | null;
}

export type SaveNumberResult =
  | { saved: true; already?: boolean }
  | { saved: false; reason: 'full'; name: string; capacity: number; slots: NumberSlot[] };

/** How a call on one of our numbers went, in a few words. */
function callResultLabel(c: { outcome?: string | null; disposition?: string | null; endedReason?: string | null; voicemail?: boolean | null }): string {
  if (c.outcome && SURPLUS_CALL_OUTCOME_LABEL[c.outcome as SurplusCallOutcome]) {
    return SURPLUS_CALL_OUTCOME_LABEL[c.outcome as SurplusCallOutcome];
  }
  if (c.disposition) return c.disposition;
  if (c.voicemail) return 'Left us a voicemail';
  switch (c.endedReason) {
    case 'no-answer':
    case 'caller-hangup':
    case 'canceled':
      return 'No answer';
    case 'busy':
      return 'Busy';
    case 'failed':
      return 'Did not connect';
    case 'completed':
      return 'Connected';
    default:
      return c.endedReason || 'Called';
  }
}

function fullName(l: { sellerFirstName?: string | null; sellerLastName?: string | null }): string {
  return `${l.sellerFirstName || ''} ${l.sellerLastName || ''}`.trim();
}

/** "Other relative", "Spouse", or the role when no relationship is on file. */
function personLabel(h: { role?: string | null; relationship?: string | null }): string {
  const rel = (h.relationship || '').trim();
  if (rel) return rel.charAt(0).toUpperCase() + rel.slice(1);
  const role = (h.role || SurplusPersonRole.HEIR) as SurplusPersonRole;
  return SURPLUS_PERSON_ROLE_LABEL[role] || role;
}
/** How long a missed or answered call from an unknown number stays listed. */
const UNKNOWN_CALL_DAYS = 30;

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
  // Which pipeline, and so which company, the thread belongs to.
  source: true,
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
    source: lead.source,
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

  constructor(
    private prisma: PrismaService,
    /** Finds who holds a number close to a caller's. Optional so tests can leave it out. */
    @Optional() private readonly leadPhones?: LeadPhonesService,
  ) {}

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

  // ─── Calls from numbers not on file ───────────────────────────────────────
  //
  // A call from a known number lands on that lead's thread. One from a number
  // we have never seen has no thread to land on, so it waits here until
  // someone dismisses it or attaches it to the right lead. That used to be
  // voicemails only, so a stranger who rang and hung up, or one an agent
  // spoke to, left nothing anyone could find; every inbound call from an
  // unknown number is listed now. Voicemails stay until dealt with; other
  // calls drop off after UNKNOWN_CALL_DAYS so the list does not fill with
  // old hang-ups. CallLog has no organization of its own; like the inbound
  // ring itself, this is team-wide. The column `voicemailReviewedAt` predates
  // the wider list and now means "dealt with" for any of these calls.

  private openUnknownWhere(now = new Date()): Prisma.CallLogWhereInput {
    return {
      type: 'twilio_inbound',
      leadId: null,
      voicemailReviewedAt: null,
      OR: [{ voicemail: true }, { createdAt: { gte: new Date(now.getTime() - UNKNOWN_CALL_DAYS * DAY_MS) } }],
    };
  }

  /**
   * Teammates and partners ring in without a lead too. They already get a
   * name on the ring screen and are not strangers to file, so their calls are
   * left out. Both tables are small and keep phones however they were typed.
   */
  private async knownNonLeadNumbers(): Promise<Set<string>> {
    const [users, partners] = await Promise.all([
      this.prisma.user.findMany({ where: { phone: { not: null } }, select: { phone: true } }).catch((): any[] => []),
      this.prisma.partner
        .findMany({ where: { isActive: true, phone: { not: null } }, select: { phone: true } })
        .catch((): any[] => []),
    ]);
    return new Set(
      [...users, ...partners].map((r: any) => numberKey(r.phone || '')).filter((k) => k.length === 10),
    );
  }

  private async openUnknownCalls(take: number) {
    const now = new Date();
    const [rows, known] = await Promise.all([
      this.prisma.callLog.findMany({
        where: this.openUnknownWhere(now),
        orderBy: { createdAt: 'desc' },
        take,
        select: {
          id: true,
          fromNumber: true,
          toNumber: true,
          createdAt: true,
          duration: true,
          recordingUrl: true,
          transcript: true,
          voicemail: true,
          status: true,
          endedReason: true,
          type: true,
        },
      }),
      this.knownNonLeadNumbers(),
    ]);
    // An answered call's transcript is shown too: what was said is usually
    // the quickest way to tell who rang.
    return rows
      .filter((r) => !known.has(numberKey(r.fromNumber || '')))
      .map(({ status, endedReason, type, ...r }) => ({
        ...r,
        kind: callOutcome({ type, status, endedReason, voicemail: r.voicemail, createdAt: r.createdAt }, now),
      }));
  }

  async listOpenVoicemails() {
    const items = await this.openUnknownCalls(50);
    const suggestions = await Promise.all(items.map((c) => this.suggestionsFor(c.fromNumber)));
    return { items: items.map((c, i) => ({ ...c, suggestions: suggestions[i] })) };
  }

  /**
   * People and leads holding a number a few digits off the caller's: the
   * (352) 467-8427 that rang is likely whoever we have at 467-8424. Offered
   * for one click, never attached on its own, because a near number is as
   * often a neighbor's line.
   */
  private async suggestionsFor(fromNumber: string | null): Promise<AttachSuggestion[]> {
    if (!this.leadPhones || !fromNumber) return [];
    try {
      const holders = (await this.leadPhones.nearNumberHolders(fromNumber)).slice(0, 3);
      if (!holders.length) return [];
      const heirIds = holders.map((h) => h.heirId).filter(Boolean) as string[];
      const [leads, heirs] = await Promise.all([
        this.prisma.lead.findMany({
          where: { id: { in: holders.map((h) => h.leadId) } },
          select: { id: true, sellerFirstName: true, sellerLastName: true, propertyAddress: true, source: true },
        }),
        heirIds.length
          ? this.prisma.surplusHeir.findMany({
              where: { id: { in: heirIds } },
              select: { id: true, name: true, role: true, relationship: true },
            })
          : Promise.resolve([] as { id: string; name: string; role: string | null; relationship: string | null }[]),
      ]);
      const leadById = new Map(leads.map((l) => [l.id, l]));
      const heirById = new Map(heirs.map((h) => [h.id, h]));
      return holders.flatMap((h) => {
        const lead = leadById.get(h.leadId);
        if (!lead) return [];
        const heir = h.heirId ? heirById.get(h.heirId) : null;
        const leadName = fullName(lead) || lead.propertyAddress || 'this lead';
        return [
          {
            leadId: lead.id,
            heirId: heir?.id || null,
            name: heir?.name || leadName,
            label: heir ? personLabel(heir) : 'Claimant',
            leadName,
            propertyAddress: lead.propertyAddress || null,
            source: lead.source || null,
            numberOnFile: prettyNumber(h.number),
          },
        ];
      });
    } catch (err: any) {
      this.logger.warn(`Near number lookup for ${fromNumber} failed: ${err.message}`);
      return [];
    }
  }

  /**
   * What the inbox's attach picker searches: leads by name, address or any
   * number on file, and the people on a surplus case by name or number. A
   * caller is often a relative, and their name was not searchable at all,
   * so typing "Tina" never found the case she belongs to.
   */
  async searchAttachTargets(q: string, organizationId?: string) {
    const query = (q || '').trim();
    if (query.length < 2) return { results: [] };
    const digits = phoneSearchDigits(query);
    const words = query.split(/\s+/).filter(Boolean).slice(0, 5);
    const org = organizationId ? { organizationId } : {};

    const heirWhere: Prisma.SurplusHeirWhereInput = digits
      ? { OR: [1, 2, 3, 4].map((i) => ({ [`phone${i}`]: { contains: digits } })) }
      : { AND: words.map((w) => ({ name: { contains: w, mode: 'insensitive' as const } })) };
    const leadWhere: Prisma.LeadWhereInput = digits
      ? { OR: phoneDigitsWhere(digits) as Prisma.LeadWhereInput[] }
      : {
          AND: words.map((w) => ({
            OR: [
              { sellerFirstName: { contains: w, mode: 'insensitive' as const } },
              { sellerLastName: { contains: w, mode: 'insensitive' as const } },
              { propertyAddress: { contains: w, mode: 'insensitive' as const } },
            ],
          })),
        };

    const [heirs, leads] = await Promise.all([
      this.prisma.surplusHeir.findMany({
        where: { ...heirWhere, surplusDetail: { lead: org } },
        orderBy: { updatedAt: 'desc' },
        take: 8,
        select: {
          id: true,
          name: true,
          role: true,
          relationship: true,
          deceased: true,
          surplusDetail: {
            select: {
              lead: { select: { id: true, sellerFirstName: true, sellerLastName: true, propertyAddress: true, source: true } },
            },
          },
        },
      }),
      this.prisma.lead.findMany({
        where: { ...leadWhere, ...org },
        orderBy: { updatedAt: 'desc' },
        take: 8,
        select: { id: true, sellerFirstName: true, sellerLastName: true, propertyAddress: true, source: true },
      }),
    ]);

    const people = heirs.flatMap((h) => {
      const lead = h.surplusDetail?.lead;
      if (!lead) return [];
      return [
        {
          kind: 'person' as const,
          leadId: lead.id,
          heirId: h.id,
          name: h.name,
          label: personLabel(h) + (h.deceased ? ', deceased' : ''),
          leadName: fullName(lead) || lead.propertyAddress || '',
          propertyAddress: lead.propertyAddress || null,
          source: lead.source || null,
        },
      ];
    });
    const claimants = leads.map((l) => ({
      kind: 'lead' as const,
      leadId: l.id,
      heirId: null,
      name: fullName(l) || l.propertyAddress || '',
      label: l.source === 'SURPLUS' ? 'Claimant' : 'Lead',
      leadName: fullName(l) || l.propertyAddress || '',
      propertyAddress: l.propertyAddress || null,
      source: l.source || null,
    }));
    return { results: [...people, ...claimants] };
  }

  async countOpenVoicemails(): Promise<number> {
    return (await this.openUnknownCalls(200)).length;
  }

  /** Dealt with: drop it from the list. The call log keeps the recording. */
  async dismissVoicemail(callLogId: string) {
    const res = await this.prisma.callLog.updateMany({
      where: { id: callLogId, type: 'twilio_inbound' },
      data: { voicemailReviewedAt: new Date() },
    });
    if (!res.count) throw new NotFoundException('Call not found');
    return { success: true };
  }

  /**
   * File a call under the lead it turned out to be from, and the person on
   * the case when it was not the claimant, so it shows on that lead's
   * timeline with the right name. The numbers on file are left alone here:
   * the inbox saves the number separately, only when asked to.
   */
  async attachVoicemail(callLogId: string, leadId: string, organizationId?: string, heirId?: string | null) {
    const lead = await this.prisma.lead.findFirst({
      where: { id: leadId, ...(organizationId ? { organizationId } : {}) },
      select: { id: true },
    });
    if (!lead) throw new NotFoundException('Lead not found');
    if (heirId) {
      const heir = await this.prisma.surplusHeir.findFirst({
        where: { id: heirId, surplusDetail: { leadId: lead.id } },
        select: { id: true },
      });
      if (!heir) throw new NotFoundException('That person is not on this lead');
    }
    const res = await this.prisma.callLog.updateMany({
      where: { id: callLogId, type: 'twilio_inbound', leadId: null },
      data: { leadId: lead.id, heirId: heirId || null, voicemailReviewedAt: new Date() },
    });
    if (!res.count) throw new NotFoundException('Call not found or already attached');
    return { success: true };
  }

  /**
   * Save the number a call came from on the person it turned out to be, so
   * their next call rings in by name. A person on a surplus case holds four
   * numbers and a lead as many as its pipeline allows. When they are full
   * nothing is dropped quietly: the answer lists what is on file with how
   * calling each has gone, and the caller sends `replace` to swap one out.
   */
  async saveCallerNumber(args: {
    leadId: string;
    heirId?: string | null;
    number: string;
    replace?: string | null;
    organizationId?: string;
  }): Promise<SaveNumberResult> {
    const key = numberKey(args.number || '');
    if (key.length !== 10) throw new BadRequestException(`"${args.number}" is not a valid phone number`);
    const replaceKey = args.replace ? numberKey(args.replace) : '';
    const lead = await this.prisma.lead.findFirst({
      where: { id: args.leadId, ...(args.organizationId ? { organizationId: args.organizationId } : {}) },
      select: { id: true, sellerFirstName: true, sellerLastName: true, badContacts: true },
    });
    if (!lead) throw new NotFoundException('Lead not found');
    const bad = new Set(badPhonesOf(lead.badContacts).map((n) => numberKey(n)));

    if (args.heirId) {
      const heir = await this.prisma.surplusHeir.findFirst({
        where: { id: args.heirId, surplusDetail: { leadId: lead.id } },
      });
      if (!heir) throw new NotFoundException('That person is not on this lead');
      const slots = [1, 2, 3, 4]
        .map((i) => ({
          number: normalizePhoneDigits((heir as any)[`phone${i}`]) || '',
          type: ((heir as any)[`phone${i}Type`] as string | null) || null,
          dnc: ((heir as any)[`phone${i}Dnc`] as string | null) || null,
        }))
        .filter((p) => p.number.length === 10);
      if (slots.some((p) => p.number === key)) return { saved: true, already: true };

      let next = slots;
      if (slots.length >= 4) {
        const at = replaceKey ? slots.findIndex((p) => p.number === replaceKey) : -1;
        if (at < 0) {
          return { saved: false, reason: 'full', name: heir.name, capacity: 4, slots: await this.describeSlots(lead.id, slots, bad, null) };
        }
        // In place, so the rest keep their order and their own type and DNC result.
        next = slots.map((p, i) => (i === at ? { number: key, type: null, dnc: null } : p));
      } else {
        next = [...slots, { number: key, type: null, dnc: null }];
      }
      const data: any = {};
      for (let i = 0; i < 4; i += 1) {
        data[`phone${i + 1}`] = next[i]?.number || null;
        data[`phone${i + 1}Type`] = next[i]?.type || null;
        data[`phone${i + 1}Dnc`] = next[i]?.dnc || null;
      }
      Object.assign(data, contactStampPatch(heirContacts(heir), heirContacts({ ...heir, ...data })));
      await this.prisma.surplusHeir.update({ where: { id: heir.id }, data });
      return { saved: true };
    }

    if (!this.leadPhones) throw new BadRequestException('Saving numbers on a lead is not available here');
    // The list includes the case people's numbers too; only the lead's own go back.
    const own = (await this.leadPhones.listForLead(lead.id)).filter((n) => !n.heirId);
    if (own.some((n) => numberKey(n.number) === key)) return { saved: true, already: true };
    const asSlots = own.map((n) => ({ number: numberKey(n.number), type: n.type ?? null, isPrimary: !!n.isPrimary }));
    const name = fullName(lead) || 'This lead';

    if (replaceKey) {
      const at = asSlots.findIndex((p) => p.number === replaceKey);
      if (at < 0) throw new BadRequestException('That number is not on this lead');
      if (asSlots[at].isPrimary) throw new BadRequestException('The primary number cannot be replaced here');
      const next = asSlots.map((p, i) => (i === at ? { number: key, type: null, isPrimary: false } : p));
      await this.leadPhones.setPhones(lead.id, next.map(({ number, type }) => ({ number, type })));
      return { saved: true };
    }
    try {
      await this.leadPhones.setPhones(lead.id, [...asSlots.map(({ number, type }) => ({ number, type })), { number: key, type: null }]);
      return { saved: true };
    } catch (err: any) {
      // setPhones refuses past the pipeline's slot count; that is "full".
      if (!(err instanceof BadRequestException) || !/at most/.test(err.message)) throw err;
      return {
        saved: false,
        reason: 'full',
        name,
        capacity: asSlots.length,
        slots: await this.describeSlots(lead.id, asSlots, bad, asSlots.find((p) => p.isPrimary)?.number || null),
      };
    }
  }

  /** Each number with its call count and the latest call's result on this lead. */
  private async describeSlots(
    leadId: string,
    slots: { number: string; type: string | null; dnc?: string | null }[],
    bad: Set<string>,
    primary: string | null,
  ): Promise<NumberSlot[]> {
    const variants = slots.flatMap((p) => [`+1${p.number}`, p.number, `1${p.number}`]);
    const calls = await this.prisma.callLog
      .findMany({
        where: { leadId, OR: [{ toNumber: { in: variants } }, { fromNumber: { in: variants } }] },
        orderBy: { createdAt: 'desc' },
        take: 200,
        select: { toNumber: true, fromNumber: true, type: true, createdAt: true, outcome: true, disposition: true, endedReason: true, voicemail: true },
      })
      .catch((): any[] => []);
    return slots.map((p) => {
      const mine = calls.filter((c: any) => {
        const other = String(c.type || '').includes('inbound') ? c.fromNumber : c.toNumber;
        return numberKey(other || '') === p.number;
      });
      const last = mine[0];
      return {
        number: p.number,
        type: p.type,
        bad: bad.has(p.number),
        dnc: p.dnc || null,
        isPrimary: primary === p.number,
        calls: mine.length,
        lastCallAt: last ? new Date(last.createdAt).toISOString() : null,
        lastResult: last ? callResultLabel(last) : null,
      };
    });
  }

  async setStarred(leadId: string, starred: boolean) {
    await this.prisma.lead.update({
      where: { id: leadId },
      data: { threadStarred: starred },
    });
    return { success: true, starred };
  }
}

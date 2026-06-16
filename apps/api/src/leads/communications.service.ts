import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

// Activity types that surface as inline timeline events. Excludes noisy types
// (field/score updates, photo fetches) and message activities (rendered as SMS).
const TIMELINE_EVENT_TYPES = new Set([
  'LEAD_CREATED',
  'STATUS_CHANGED',
  'LEAD_ASSIGNED',
  'LEAD_UNASSIGNED',
  'OFFER_MADE',
  'OFFER_ACCEPTED',
  'OFFER_RESPONSE',
  'CONTRACT_PENDING',
  'LEAD_ACQUIRED',
  'FINAL_SALE_RECORDED',
  'DOCUMENT_SENT',
  'DEAL_SHARED',
]);

type Actor =
  | { type: 'user'; name: string; avatarUrl: string | null }
  | { type: 'seller'; name: string }
  | { type: 'ai'; name: string }
  | { type: 'system'; name: string };

@Injectable()
export class CommunicationsService {
  constructor(private prisma: PrismaService) {}

  async getCommunications(leadId: string) {
    const lead = await this.prisma.lead.findUnique({
      where: { id: leadId },
      select: { id: true, sellerFirstName: true, sellerLastName: true },
    });
    if (!lead) throw new Error('Lead not found');

    const sellerName =
      [lead.sellerFirstName, lead.sellerLastName].filter(Boolean).join(' ').trim() || 'Seller';

    const [messages, emails, callLogs, activities, notes] = await Promise.all([
      this.prisma.message.findMany({ where: { leadId }, orderBy: { createdAt: 'asc' } }),
      this.prisma.email.findMany({ where: { leadId }, orderBy: { sentAt: 'asc' } }),
      this.prisma.callLog.findMany({ where: { leadId }, orderBy: { createdAt: 'asc' } }),
      this.prisma.activity.findMany({ where: { leadId }, orderBy: { createdAt: 'asc' } }),
      this.prisma.note.findMany({ where: { leadId }, orderBy: { createdAt: 'desc' } }),
    ]);

    // Resolve every referenced user in one query for actor avatars/names.
    const userIds = new Set<string>();
    messages.forEach((m: any) => m.sentByUserId && userIds.add(m.sentByUserId));
    emails.forEach((e: any) => e.sentByUserId && userIds.add(e.sentByUserId));
    callLogs.forEach((c: any) => c.initiatedByUserId && userIds.add(c.initiatedByUserId));
    activities.forEach((a) => a.userId && userIds.add(a.userId));
    notes.forEach((n: any) => {
      if (n.userId) userIds.add(n.userId);
      if (Array.isArray(n.mentions)) n.mentions.forEach((id: string) => userIds.add(id));
    });

    const users = userIds.size
      ? await this.prisma.user.findMany({
          where: { id: { in: Array.from(userIds) } },
          select: { id: true, firstName: true, lastName: true, avatarUrl: true },
        })
      : [];
    const userMap = new Map(users.map((u) => [u.id, u]));

    const userActor = (userId: string | null | undefined): Actor | null => {
      if (!userId) return null;
      const u = userMap.get(userId);
      if (!u) return null;
      return {
        type: 'user',
        name: [u.firstName, u.lastName].filter(Boolean).join(' ').trim() || 'User',
        avatarUrl: u.avatarUrl ?? null,
      };
    };
    const sellerActor: Actor = { type: 'seller', name: sellerName };
    const aiActor: Actor = { type: 'ai', name: 'AI' };
    const systemActor: Actor = { type: 'system', name: 'System' };

    // Outbound actor = the sending user, else AI/automated. Inbound = seller.
    const commActor = (direction: string, userId: string | null | undefined): Actor =>
      direction === 'INBOUND' ? sellerActor : userActor(userId) ?? aiActor;

    const timeline: any[] = [];

    for (const m of messages as any[]) {
      const media = Array.isArray(m.mediaUrls) ? m.mediaUrls : [];
      timeline.push({
        id: `sms_${m.id}`,
        kind: 'sms',
        direction: m.direction,
        at: m.createdAt,
        actor: commActor(m.direction, m.sentByUserId),
        payload: { body: m.body, media },
      });
    }

    for (const e of emails as any[]) {
      const direction = String(e.direction).toUpperCase() === 'INBOUND' ? 'INBOUND' : 'OUTBOUND';
      timeline.push({
        id: `email_${e.id}`,
        kind: 'email',
        direction,
        at: e.sentAt,
        actor: commActor(direction, e.sentByUserId),
        payload: {
          subject: e.subject,
          fromAddress: e.fromAddress,
          toAddress: e.toAddress,
          bodyText: e.bodyText,
          bodyHtml: e.bodyHtml ?? null,
        },
      });
    }

    for (const c of callLogs as any[]) {
      // AI/provider calls are effectively outbound from us unless flagged inbound.
      const direction = String(c.type).includes('inbound') ? 'INBOUND' : 'OUTBOUND';
      timeline.push({
        id: `call_${c.id}`,
        kind: 'call',
        direction,
        at: c.createdAt,
        actor: c.initiatedByUserId ? userActor(c.initiatedByUserId) ?? aiActor : aiActor,
        payload: {
          status: c.status,
          type: c.type,
          duration: c.duration ?? null,
          recordingUrl: c.recordingUrl ?? null,
        },
      });
    }

    for (const a of activities) {
      if (!TIMELINE_EVENT_TYPES.has(a.type)) continue;
      timeline.push({
        id: `event_${a.id}`,
        kind: 'event',
        direction: null,
        at: a.createdAt,
        actor: userActor(a.userId) ?? systemActor,
        payload: { type: a.type, description: a.description, metadata: a.metadata ?? null },
      });
    }

    // Internal comments render inline in the timeline (team-only).
    const resolveName = (id: string): string => {
      const u = userMap.get(id);
      return u ? [u.firstName, u.lastName].filter(Boolean).join(' ').trim() || 'User' : 'User';
    };
    for (const n of notes as any[]) {
      if (!n.isInternalComment) continue;
      const mentions = Array.isArray(n.mentions)
        ? n.mentions.map((id: string) => ({ id, name: resolveName(id) }))
        : [];
      timeline.push({
        id: `comment_${n.id}`,
        kind: 'comment',
        direction: null,
        at: n.createdAt,
        actor: userActor(n.userId) ?? systemActor,
        payload: { body: n.content, mentions },
      });
    }

    timeline.sort((x, y) => new Date(x.at).getTime() - new Date(y.at).getTime());

    // Notes side panel: manual notes (not inline comments) + AI call summaries (newest first).
    const noteItems: any[] = [];
    for (const n of notes as any[]) {
      if (n.isInternalComment) continue;
      noteItems.push({
        id: `note_${n.id}`,
        kind: 'note',
        at: n.createdAt,
        actor: userActor(n.userId) ?? systemActor,
        title: 'Note',
        body: n.content,
        transcript: null,
      });
    }
    for (const c of callLogs as any[]) {
      if (!c.summary && !c.transcript) continue;
      noteItems.push({
        id: `callnote_${c.id}`,
        kind: 'call_summary',
        at: c.createdAt,
        actor: aiActor,
        title: 'AI call summary',
        body: c.summary ?? null,
        transcript: c.transcript ?? null,
      });
    }
    noteItems.sort((x, y) => new Date(y.at).getTime() - new Date(x.at).getTime());

    return { timeline, notes: noteItems };
  }
}

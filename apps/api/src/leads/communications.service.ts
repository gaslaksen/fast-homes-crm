import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { LeadPhonesService, type LeadPhone } from '../phone-numbers/lead-phones.service';

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

/** Last 10 digits, so +17045551234 and 7045551234 compare equal. */
const phoneKey = (raw: string | null | undefined): string =>
  (raw || '').replace(/\D/g, '').slice(-10);

/** The bare address, lowercased, out of "Name <addr>" or a plain one. */
const emailKey = (raw: string | null | undefined): string =>
  String(raw || '').replace(/^.*<([^>]+)>.*$/, '$1').trim().toLowerCase();

/**
 * Who on a surplus case a text, call or email was with. id is null for the
 * claimant. Only surplus leads carry it: every other lead has one seller.
 */
export interface TimelinePerson {
  id: string | null;
  name: string;
  /** "Claimant", or the relationship or role: "Daughter", "Relative". */
  label: string;
}

const ROLE_LABEL: Record<string, string> = {
  heir: 'Heir',
  relative: 'Relative',
  neighbor: 'Neighbor',
  friend: 'Friend',
  associate: 'Associate',
};

type Actor =
  | { type: 'user'; name: string; avatarUrl: string | null }
  | { type: 'seller'; name: string }
  | { type: 'ai'; name: string }
  | { type: 'system'; name: string };

@Injectable()
export class CommunicationsService {
  constructor(
    private prisma: PrismaService,
    private leadPhones: LeadPhonesService,
  ) {}

  async getCommunications(leadId: string) {
    const lead = await this.prisma.lead.findUnique({
      where: { id: leadId },
      select: {
        id: true,
        sellerFirstName: true,
        sellerLastName: true,
        sellerPhone: true,
        sellerEmail: true,
        source: true,
        surplusDetail: {
          select: {
            email2: true,
            heirs: {
              select: {
                id: true,
                name: true,
                relationship: true,
                role: true,
                phone1: true,
                phone2: true,
                phone3: true,
                phone4: true,
                email1: true,
                email2: true,
              },
            },
          },
        },
      },
    });
    if (!lead) throw new Error('Lead not found');

    const sellerName =
      [lead.sellerFirstName, lead.sellerLastName].filter(Boolean).join(' ').trim() || 'Seller';

    const [messages, emails, ownCallLogs, activities, notes, leadPhones] = await Promise.all([
      this.prisma.message.findMany({ where: { leadId }, orderBy: { createdAt: 'asc' } }),
      this.prisma.email.findMany({ where: { leadId }, orderBy: { sentAt: 'asc' } }),
      this.prisma.callLog.findMany({ where: { leadId }, orderBy: { createdAt: 'asc' } }),
      this.prisma.activity.findMany({ where: { leadId }, orderBy: { createdAt: 'asc' } }),
      this.prisma.note.findMany({ where: { leadId }, orderBy: { createdAt: 'desc' } }),
      // Labels for the seller's numbers ("Phone 2", "Heir: ..."), so a call
      // card can say which one was dialled. A failure here only costs labels.
      this.leadPhones.listForLead(leadId).catch((): LeadPhone[] => []),
    ]);

    // A claimant with several claims rings in on one number, and the call is
    // filed on one of those claims. It reached them on all of them, so each
    // claim shows it rather than only the one that happened to match.
    const siblingCalls =
      lead.source === 'SURPLUS' && leadPhones.length
        ? await this.prisma.callLog
            .findMany({
              where: {
                type: 'twilio_inbound',
                leadId: { not: leadId },
                fromNumber: { in: leadPhones.map((p) => p.number) },
                lead: { source: 'SURPLUS' },
              },
              orderBy: { createdAt: 'asc' },
            })
            .catch((): any[] => [])
        : [];
    const callLogs = [...ownCallLogs, ...siblingCalls].sort(
      (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
    );

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

    // ── Who each text, call and email was with, on a surplus case ──────────
    // The row's own heirId first, which every send and reply has carried
    // since it was added. A row from before that is read off its number or
    // address against the people on the case today. The claimant's own
    // numbers and addresses win wherever a relative holds the same one.
    const heirs = lead.source === 'SURPLUS' ? lead.surplusDetail?.heirs || [] : [];
    const claimantPerson: TimelinePerson = { id: null, name: sellerName, label: 'Claimant' };
    const personById = new Map<string, TimelinePerson>(
      heirs.map((h) => [
        h.id,
        { id: h.id, name: h.name, label: h.relationship || ROLE_LABEL[h.role] || 'Relative' },
      ]),
    );
    const claimantNumbers = new Set(
      [lead.sellerPhone, ...leadPhones.filter((p) => !p.heirId).map((p) => p.number)].map(phoneKey).filter(Boolean),
    );
    const claimantEmails = new Set([lead.sellerEmail, lead.surplusDetail?.email2].map(emailKey).filter(Boolean));
    const heirByNumber = new Map<string, string>();
    const heirByEmail = new Map<string, string>();
    for (const h of heirs) {
      for (const n of [h.phone1, h.phone2, h.phone3, h.phone4].map(phoneKey)) {
        if (n && !claimantNumbers.has(n) && !heirByNumber.has(n)) heirByNumber.set(n, h.id);
      }
      for (const e of [h.email1, h.email2].map(emailKey)) {
        if (e && !claimantEmails.has(e) && !heirByEmail.has(e)) heirByEmail.set(e, h.id);
      }
    }
    const personFor = (
      heirId: string | null | undefined,
      number?: string | null,
      email?: string | null,
    ): TimelinePerson | null => {
      if (lead.source !== 'SURPLUS') return null;
      const id =
        (heirId && personById.has(heirId) ? heirId : null) ||
        (number ? heirByNumber.get(phoneKey(number)) : undefined) ||
        (email ? heirByEmail.get(emailKey(email)) : undefined) ||
        null;
      return id ? personById.get(id)! : claimantPerson;
    };

    // Outbound actor = the sending user, else AI/automated. Inbound = seller,
    // or on a surplus case whoever on it wrote in.
    const commActor = (
      direction: string,
      userId: string | null | undefined,
      person?: TimelinePerson | null,
    ): Actor =>
      direction === 'INBOUND'
        ? person && person.id
          ? { type: 'seller', name: person.name }
          : sellerActor
        : userActor(userId) ?? aiActor;

    const timeline: any[] = [];

    // The seller's number, so the timeline can tell a text sent to the primary
    // from one sent to a skip-traced second number. Only the exception is worth
    // showing, so the decision of what to render is left to the client.
    const primaryKey = phoneKey(lead.sellerPhone);

    for (const m of messages as any[]) {
      const media = Array.isArray(m.mediaUrls) ? m.mediaUrls : [];
      // For outbound the seller's number is `to`; for inbound it is `from`.
      const sellerNumber = m.direction === 'INBOUND' ? m.from : m.to;
      const person = personFor(m.heirId, sellerNumber);
      timeline.push({
        id: `sms_${m.id}`,
        kind: 'sms',
        direction: m.direction,
        at: m.createdAt,
        person,
        actor: commActor(m.direction, m.sentByUserId, person),
        payload: {
          body: m.body,
          media,
          sellerNumber: sellerNumber || null,
          onPrimaryNumber: !sellerNumber || !primaryKey || phoneKey(sellerNumber) === primaryKey,
        },
      });
    }

    for (const e of emails as any[]) {
      const direction = String(e.direction).toUpperCase() === 'INBOUND' ? 'INBOUND' : 'OUTBOUND';
      const person = personFor(e.heirId, null, direction === 'INBOUND' ? e.fromAddress : e.toAddress);
      timeline.push({
        id: `email_${e.id}`,
        kind: 'email',
        direction,
        at: e.sentAt,
        person,
        actor: commActor(direction, e.sentByUserId, person),
        payload: {
          subject: e.subject,
          fromAddress: e.fromAddress,
          toAddress: e.toAddress,
          bodyText: e.bodyText,
          bodyHtml: e.bodyHtml ?? null,
        },
      });
    }

    const phoneLabels = new Map(leadPhones.map((p) => [phoneKey(p.number), p.label]));

    for (const c of callLogs as any[]) {
      // AI/provider calls are effectively outbound from us unless flagged inbound.
      const direction = String(c.type).includes('inbound') ? 'INBOUND' : 'OUTBOUND';
      // The seller's end of the call. With several numbers on a lead, a call
      // card that does not say which one was dialled cannot tell a voicemail
      // on the primary from a wrong number on Phone 3.
      const sellerNumber = (direction === 'INBOUND' ? c.fromNumber : c.toNumber) || null;
      timeline.push({
        id: `call_${c.id}`,
        kind: 'call',
        direction,
        at: c.createdAt,
        // A sibling claim's inbound call carries that claim's heirId, so it is
        // read off the number here rather than trusted.
        person: personFor(c.leadId === leadId ? c.heirId : null, sellerNumber),
        actor: c.initiatedByUserId ? userActor(c.initiatedByUserId) ?? aiActor : aiActor,
        payload: {
          status: c.status,
          type: c.type,
          duration: c.duration ?? null,
          recordingUrl: c.recordingUrl ?? null,
          sellerNumber,
          numberLabel: sellerNumber ? phoneLabels.get(phoneKey(sellerNumber)) ?? null : null,
          voicemail: !!c.voicemail,
          // A voicemail is read as much as heard; other calls keep their
          // transcripts off the timeline as before.
          transcript: c.voicemail ? c.transcript ?? null : null,
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

    // Everybody the thread was with, for filtering it by person: the claimant
    // first, then each person in the order they were filed, with a count.
    let people: (TimelinePerson & { count: number })[] | undefined;
    if (lead.source === 'SURPLUS') {
      const counts = new Map<string | null, number>();
      for (const t of timeline) {
        if (!t.person) continue;
        counts.set(t.person.id, (counts.get(t.person.id) || 0) + 1);
      }
      people = [
        { ...claimantPerson, count: counts.get(null) || 0 },
        ...Array.from(personById.values())
          .filter((p) => counts.has(p.id))
          .map((p) => ({ ...p, count: counts.get(p.id) || 0 })),
      ];
    }

    return { timeline, notes: noteItems, ...(people ? { people } : {}) };
  }
}

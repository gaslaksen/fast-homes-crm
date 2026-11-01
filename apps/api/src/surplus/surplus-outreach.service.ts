import { BadRequestException, Injectable } from '@nestjs/common';
import { LeadSource, SurplusQueue, SURPLUS_QUEUE_LABEL, isCountyContactRole } from '@fast-homes/shared';
import { PrismaService } from '../prisma/prisma.service';
import { SurplusService } from './surplus.service';
import { idiBatchCode } from './surplus-idi.util';
import {
  OUTREACH_GROUP_LABEL,
  OUTREACH_GROUP_ORDER,
  OUTREACH_TOUCH_KINDS,
  OutreachGroup,
  OutreachTick,
  OutreachTouchKind,
  daysLeftToWork,
  newerTick,
  outreachGroup,
  outreachRank,
  personKey,
  personReachable,
} from './surplus-outreach.util';
import { TOUCH_EVERY_DAYS, touchDue } from './surplus-windows.util';

/** The most cases one outreach list holds. A batch is far smaller; Call now rarely comes close. */
const OUTREACH_MAX_CASES = 600;

const TOUCH_VERB: Record<string, string> = {
  called: 'Called',
  texted: 'Texted',
  emailed: 'Emailed',
};

export interface OutreachScope {
  batchId?: string | null;
  /** A board queue, `call` by default. Ignored when a batch is given. */
  queue?: string | null;
  /** Claims with a letter due, instead of a queue. */
  letters?: boolean;
}

/**
 * The outreach list: the people on a batch or a work queue, one row each, with
 * what has been tried on them.
 *
 * What Dealcore sent itself ticks itself, off the person stamped on each text,
 * call, email and letter. What happened elsewhere (a call from a cell phone, a
 * text from Ian's own number) is marked by hand as a SurplusTouch, alongside
 * "done with this person for now".
 */
@Injectable()
export class SurplusOutreachService {
  constructor(
    private prisma: PrismaService,
    private surplus: SurplusService,
  ) {}

  async list(scope: OutreachScope, organizationId?: string | null) {
    const { rows, label } = await this.rowsFor(scope, organizationId);
    const ids = rows.map((r: any) => r.id);
    const ticks = await this.ticksFor(ids, rows);
    const touches = ids.length
      ? await this.prisma.surplusTouch.findMany({
          where: { leadId: { in: ids } },
          orderBy: { createdAt: 'desc' },
        })
      : [];
    const users = await this.userNames(touches.map((t) => t.userId));

    const byPerson = new Map<string, typeof touches>();
    for (const t of touches) {
      const k = personKey(t.leadId, t.heirId);
      byPerson.set(k, [...(byPerson.get(k) || []), t]);
    }

    const cases = rows.map((r: any) => {
      const mailing = [
        r.ownerMailingStreet,
        r.ownerMailingCity,
        [r.ownerMailingState, r.ownerMailingZip].filter(Boolean).join(' ').trim(),
      ]
        .filter(Boolean)
        .join(', ');
      const claimant = {
        heirId: null as string | null,
        name: r.claimant,
        isClaimant: true,
        role: null as string | null,
        relationship: null as string | null,
        deceased: !!r.isDeceased,
        doNotCall: !!r.doNotCall,
        phones: r.phones,
        emails: r.emails,
        address: mailing || r.letterMailedTo || null,
        mailReturned: !!r.mailReturned,
        statusLabel: r.tappedAt ? 'Has replied' : 'Not heard from',
      };
      // The clerk contact is county correspondence, not outreach.
      const others = (r.heirs || []).filter((h: any) => !isCountyContactRole(h.role)).map((h: any) => {
        const last = (r.letters || []).find((l: any) => l.heirId === h.id);
        return {
          heirId: h.id as string | null,
          name: h.name,
          isClaimant: false,
          role: h.role,
          relationship: h.relationship || null,
          deceased: !!h.deceased,
          doNotCall: !!h.doNotCall,
          phones: h.phones,
          emails: h.emails,
          address: h.address || null,
          mailReturned: !!last?.returnedAt,
          statusLabel: h.contactStatusLabel,
        };
      });

      const people = [claimant, ...others]
        .map((p) => {
          const k = personKey(r.id, p.heirId);
          const mine = byPerson.get(k) || [];
          const done = mine.find((t) => t.kind === 'done');
          const logged = (kind: string): OutreachTick | undefined => {
            const t = mine.find((x) => x.kind === kind);
            return t ? { at: t.createdAt, via: 'logged' } : undefined;
          };
          const sent = ticks.get(k) || {};
          const { rank, label } = outreachRank(p);
          const personTicks = {
            called: newerTick(sent.called, logged('called')) || null,
            texted: newerTick(sent.texted, logged('texted')) || null,
            emailed: newerTick(sent.emailed, logged('emailed')) || null,
            letter: sent.letter || null,
          };
          const touch = touchDue({ reachable: personReachable(p), done, ticks: personTicks }, !!r.heldAt);
          return {
            heirId: p.heirId,
            name: p.name,
            isClaimant: p.isClaimant,
            rank,
            rankLabel: label,
            relationship: p.relationship,
            deceased: p.deceased,
            doNotCall: p.doNotCall,
            phones: p.phones,
            emails: p.emails,
            address: p.address,
            mailReturned: p.mailReturned,
            statusLabel: p.statusLabel,
            reachable: personReachable(p),
            ticks: personTicks,
            /** Can be tried and nothing has been tried in a week (or ever). */
            dueToday: touch.due,
            lastTouchAt: touch.lastAt,
            done: done ? { at: done.createdAt, by: users.get(done.userId || '') || null } : null,
            notes: mine
              .filter((t) => t.note)
              .slice(0, 5)
              .map((t) => ({ at: t.createdAt, kind: t.kind, note: t.note, by: users.get(t.userId || '') || null })),
          };
        })
        // Somebody who can be tried comes before somebody who has to be
        // found first, even a closer relative.
        .sort((a, b) => Number(b.reachable) - Number(a.reachable) || a.rank - b.rank || a.name.localeCompare(b.name));

      const reachable = people.some((p) => p.reachable);
      const daysLeft = daysLeftToWork(r.noticeAge, r.daysSinceSale);
      const open = people.filter((p) => p.reachable && !p.done);
      return {
        leadId: r.id,
        claimant: r.claimant,
        address: [r.address, r.city].filter(Boolean).join(', '),
        county: r.county,
        caseNumber: r.caseNumber,
        stage: r.stage,
        queue: r.queue,
        queueLabel: r.queueLabel,
        queueReason: r.queueReason,
        holdReason: r.holdReason || null,
        holdUntil: r.holdUntil || null,
        netToClaimant: r.netToClaimant,
        daysLeft,
        shortWindow: !!r.shortWindow,
        daysToCutoff: r.daysToCutoff ?? null,
        group: outreachGroup({ queue: r.queue, daysLeft, reachable }),
        letterDue: !!r.letterDue,
        people,
        /** People who can be tried and are not marked done. Zero means the case is worked through for now. */
        openCount: open.length,
        untriedCount: open.filter((p) => !p.ticks.called && !p.ticks.texted && !p.ticks.emailed && !p.ticks.letter).length,
        dueCount: people.filter((p) => p.dueToday).length,
      };
    });

    const groups = OUTREACH_GROUP_ORDER.map((key: OutreachGroup) => ({
      key,
      label: OUTREACH_GROUP_LABEL[key],
      cases: cases
        .filter((c) => c.group === key)
        .sort((a, b) => (a.daysLeft ?? 9999) - (b.daysLeft ?? 9999) || b.netToClaimant - a.netToClaimant),
    })).filter((g) => g.cases.length);

    return {
      label,
      generatedAt: new Date(),
      caseCount: cases.length,
      peopleCount: cases.reduce((s, c) => s + c.people.length, 0),
      openCount: cases.reduce((s, c) => s + c.openCount, 0),
      dueCount: cases.reduce((s, c) => s + c.dueCount, 0),
      touchEveryDays: TOUCH_EVERY_DAYS,
      truncated: rows.length >= OUTREACH_MAX_CASES,
      groups,
    };
  }

  /**
   * Everybody due a touch today on Call now, biggest surplus first and then
   * the nearest deadline. For the Daily Brief, whose link opens the outreach
   * page on Call now with Due today on, so the two counts agree.
   */
  async dueToday(organizationId?: string | null) {
    const list = await this.list({ queue: SurplusQueue.CALL }, organizationId);
    const cases = list.groups
      .flatMap((g) => g.cases)
      .filter((c) => c.dueCount > 0)
      .sort((a, b) => b.netToClaimant - a.netToClaimant || (a.daysLeft ?? 9999) - (b.daysLeft ?? 9999));
    return {
      caseCount: cases.length,
      peopleCount: cases.reduce((n, c) => n + c.dueCount, 0),
      top: cases.slice(0, 3).map((c) => ({
        leadId: c.leadId,
        claimant: c.claimant,
        county: c.county,
        netToClaimant: c.netToClaimant,
        daysLeft: c.daysLeft,
        shortWindow: c.shortWindow,
        people: c.people.filter((p) => p.dueToday).map((p) => p.name),
      })),
    };
  }

  /**
   * Mark something on a person: a call, text or email made outside Dealcore,
   * a note, or done. A call, text or email also counts as a touch on the
   * claim and leaves a note on the timeline, so the case history is whole.
   */
  async addTouch(
    leadId: string,
    body: { heirId?: string | null; kind?: string; note?: string | null },
    organizationId?: string | null,
    userId?: string | null,
  ) {
    const kind = String(body.kind || '') as OutreachTouchKind;
    if (!OUTREACH_TOUCH_KINDS.includes(kind)) throw new BadRequestException('Unknown mark.');
    const note = String(body.note || '').trim() || null;
    if (kind === 'note' && !note) throw new BadRequestException('Write the note first.');
    const { name } = await this.personOn(leadId, body.heirId || null, organizationId);

    const touch = await this.prisma.surplusTouch.create({
      data: { organizationId: organizationId || null, leadId, heirId: body.heirId || null, kind, note, userId: userId || null },
    });

    if (TOUCH_VERB[kind]) {
      await this.prisma.lead.update({
        where: { id: leadId },
        data: { touchCount: { increment: 1 }, lastTouchedAt: new Date() },
      });
    }
    if (userId && kind !== 'done') {
      const content = TOUCH_VERB[kind]
        ? `${TOUCH_VERB[kind]} ${name} outside Dealcore${note ? `: ${note}` : '.'}`
        : `Outreach note on ${name}: ${note}`;
      await this.prisma.note.create({ data: { leadId, userId, content } });
    }
    return touch;
  }

  /** Take "done" off a person, so they come back on the list as somebody to try. */
  async clearDone(leadId: string, heirId: string | null, organizationId?: string | null) {
    await this.personOn(leadId, heirId, organizationId);
    const { count } = await this.prisma.surplusTouch.deleteMany({ where: { leadId, heirId, kind: 'done' } });
    return { cleared: count };
  }

  /** The case's rows for a scope, walked page by page through the board's own list so every rule the board applies applies here. */
  private async rowsFor(scope: OutreachScope, organizationId?: string | null) {
    let label: string;
    const filters: any = { organizationId, group: 'lead', pageSize: 200 };
    if (scope.batchId) {
      const batch = await this.prisma.surplusBatch.findFirst({
        where: { id: scope.batchId, ...(organizationId ? { organizationId } : {}) },
        select: { id: true, number: true },
      });
      if (!batch) throw new BadRequestException('Batch not found');
      filters.batchId = batch.id;
      label = `Batch ${idiBatchCode(batch.number)}`;
    } else if (scope.letters) {
      filters.letterDue = true;
      filters.hideEarly = true;
      label = 'Letters due';
    } else {
      const queue = scope.queue || SurplusQueue.CALL;
      filters.queue = queue;
      filters.hideEarly = true;
      label = SURPLUS_QUEUE_LABEL[queue as SurplusQueue] || queue;
    }

    const rows: any[] = [];
    for (let page = 1; rows.length < OUTREACH_MAX_CASES; page++) {
      const res: any = await this.surplus.list({ ...filters, page });
      rows.push(...(res.data || []));
      if (page * res.pageSize >= res.total) break;
    }
    return { rows: rows.slice(0, OUTREACH_MAX_CASES), label };
  }

  /**
   * The last time Dealcore itself called, texted, emailed or wrote to each
   * person. Inbound calls are not "called": they called us.
   */
  private async ticksFor(leadIds: string[], rows: any[]) {
    const out = new Map<string, Partial<Record<'called' | 'texted' | 'emailed' | 'letter', OutreachTick>>>();
    const set = (leadId: string, heirId: string | null, channel: 'called' | 'texted' | 'emailed' | 'letter', at: Date | null) => {
      if (!at) return;
      const k = personKey(leadId, heirId);
      const cur = out.get(k) || {};
      cur[channel] = newerTick(cur[channel], { at, via: 'dealcore' });
      out.set(k, cur);
    };
    if (!leadIds.length) return out;

    const [calls, texts, emails] = await Promise.all([
      this.prisma.callLog.groupBy({
        by: ['leadId', 'heirId'],
        where: { leadId: { in: leadIds }, type: { not: 'twilio_inbound' } },
        _max: { createdAt: true },
      }),
      this.prisma.message.groupBy({
        by: ['leadId', 'heirId'],
        where: { leadId: { in: leadIds }, direction: 'OUTBOUND', status: { not: 'FAILED' } },
        _max: { createdAt: true },
      }),
      this.prisma.email.groupBy({
        by: ['leadId', 'heirId'],
        where: { leadId: { in: leadIds }, direction: 'outbound' },
        _max: { sentAt: true },
      }),
    ]);
    for (const c of calls) if (c.leadId) set(c.leadId, c.heirId, 'called', c._max.createdAt);
    for (const m of texts) set(m.leadId, m.heirId, 'texted', m._max.createdAt);
    for (const e of emails) if (e.leadId) set(e.leadId, e.heirId, 'emailed', e._max.sentAt);
    for (const r of rows) {
      for (const l of r.letters || []) set(r.id, l.heirId || null, 'letter', l.mailedAt ? new Date(l.mailedAt) : null);
    }
    return out;
  }

  /** The claimant or one person on their case, checked against the org. */
  private async personOn(leadId: string, heirId: string | null, organizationId?: string | null) {
    const lead = await this.prisma.lead.findFirst({
      where: { id: leadId, source: LeadSource.SURPLUS, ...(organizationId ? { organizationId } : {}) },
      select: { id: true, sellerFirstName: true, sellerLastName: true, surplusDetail: { select: { id: true } } },
    });
    if (!lead?.surplusDetail) throw new BadRequestException('Surplus lead not found');
    if (!heirId) return { name: `${lead.sellerFirstName || ''} ${lead.sellerLastName || ''}`.trim() || 'the claimant' };
    const heir = await this.prisma.surplusHeir.findFirst({
      where: { id: heirId, surplusDetailId: lead.surplusDetail.id },
      select: { name: true },
    });
    if (!heir) throw new BadRequestException('That person is not on this case.');
    return { name: heir.name };
  }

  private async userNames(ids: (string | null)[]) {
    const wanted = Array.from(new Set(ids.filter(Boolean))) as string[];
    if (!wanted.length) return new Map<string, string>();
    const users = await this.prisma.user.findMany({
      where: { id: { in: wanted } },
      select: { id: true, firstName: true, lastName: true, email: true },
    });
    return new Map(users.map((u: any) => [u.id, `${u.firstName || ''} ${u.lastName || ''}`.trim() || u.email]));
  }
}

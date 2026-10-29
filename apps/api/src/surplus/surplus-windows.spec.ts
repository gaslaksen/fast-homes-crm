import { SurplusService } from './surplus.service';
import { SurplusCadenceService } from './surplus-cadence.service';
import { caseSuggestions } from './surplus-questions.util';
import { queueReason } from './surplus.util';
import { PAUSE_FOR_DAYS, pauseOffer, pauseUntil, shortWindow, touchDue } from './surplus-windows.util';

const DAY = 86_400_000;
const NOW = new Date('2026-10-29T14:00:00Z');
const ago = (days: number) => new Date(NOW.getTime() - days * DAY);

describe('shortWindow', () => {
  it('is short under two months to day 340, and past it until day 365', () => {
    expect(shortWindow(279, null)).toEqual({ short: false, daysToCutoff: 61 });
    expect(shortWindow(281, null)).toEqual({ short: true, daysToCutoff: 59 });
    expect(shortWindow(350, null)).toEqual({ short: true, daysToCutoff: -10 });
    expect(shortWindow(366, null)).toEqual({ short: false, daysToCutoff: -26 });
  });

  it('falls back to the sale date, and is never short with no date', () => {
    expect(shortWindow(null, 300).short).toBe(true);
    expect(shortWindow(null, null)).toEqual({ short: false, daysToCutoff: null });
  });
});

describe('pauseOffer', () => {
  const worked = { stage: 'Contacted', tappedAt: null, heldAt: null, effortMissing: [], firstEffortAt: ago(61) };

  it('offers a pause after sixty days of full effort with nobody reached, six months out', () => {
    const offer = pauseOffer(worked, NOW);
    expect(offer?.days).toBe(61);
    expect(offer?.until.toISOString()).toBe(pauseUntil(NOW).toISOString());
    expect(Math.round((offer!.until.getTime() - NOW.getTime()) / DAY)).toBe(PAUSE_FOR_DAYS);
  });

  it('holds off while effort is missing, too soon, after a reply, on hold, or after a signature', () => {
    expect(pauseOffer({ ...worked, effortMissing: ['a social search logged'] }, NOW)).toBeNull();
    expect(pauseOffer({ ...worked, firstEffortAt: ago(59) }, NOW)).toBeNull();
    expect(pauseOffer({ ...worked, tappedAt: ago(3) }, NOW)).toBeNull();
    expect(pauseOffer({ ...worked, heldAt: ago(1) }, NOW)).toBeNull();
    expect(pauseOffer({ ...worked, stage: 'Agreement Signed' }, NOW)).toBeNull();
    expect(pauseOffer({ ...worked, firstEffortAt: null }, NOW)).toBeNull();
  });
});

describe('touchDue', () => {
  const p = (ticks: any, extra: any = {}) => ({ reachable: true, done: null, ticks, ...extra });

  it('is due when never tried or nothing in a week', () => {
    expect(touchDue(p({ called: null }), false, NOW)).toEqual({ due: true, lastAt: null });
    expect(touchDue(p({ called: { at: ago(8) }, texted: { at: ago(9) } }), false, NOW)).toEqual({ due: true, lastAt: ago(8) });
    expect(touchDue(p({ called: { at: ago(2) } }), false, NOW).due).toBe(false);
  });

  it('is never due for somebody unreachable, marked done, or on a held file', () => {
    expect(touchDue(p({}, { reachable: false }), false, NOW).due).toBe(false);
    expect(touchDue(p({}, { done: { at: ago(1) } }), false, NOW).due).toBe(false);
    expect(touchDue(p({}), true, NOW).due).toBe(false);
  });
});

describe('the pause on the case', () => {
  it('is the only suggestion when offered, and a pause asks for nothing until it ends', () => {
    const base: any = { claimant: 'Ada Quill', claimStatus: 'open', phones: [], emails: [], heirs: [], stage: 'Contacted', channels: {} };
    const s = caseSuggestions({ ...base, pauseOffer: { since: ago(70), days: 70, until: new Date('2027-04-29T12:00:00Z') } });
    expect(s).toEqual([{ key: 'pause', text: '70 days of full effort and nobody reached. Pause the file until Apr 29, 2027 and revisit it then' }]);
    expect(caseSuggestions({ ...base, heldAt: ago(1), holdUntil: new Date('2027-04-29T12:00:00Z') })).toEqual([]);
  });

  it('says when a paused file comes back in its queue reason', () => {
    expect(queueReason({ onHold: true, holdReason: 'nobody reached', holdUntil: '2027-04-29T12:00:00Z' } as any)).toBe(
      'Paused until Apr 29, 2027: nobody reached',
    );
  });

  it('stores a revisit date as a calendar day and refuses one in the past', async () => {
    const prisma: any = {
      surplusDetail: { findFirst: jest.fn().mockResolvedValue({ id: 'd1', heldAt: null, holdReason: null }), update: jest.fn() },
      note: { create: jest.fn() },
    };
    const svc = new SurplusService(prisma, {} as any, {} as any, {} as any);
    await svc.setHold('L1', { on: true, reason: 'nobody reached', until: '2099-04-29' }, 'org1', 'u1');
    expect(prisma.surplusDetail.update.mock.calls[0][0].data.holdUntil.toISOString()).toBe('2099-04-29T12:00:00.000Z');
    expect(prisma.note.create.mock.calls[0][0].data.content).toBe('Paused until Apr 29, 2099: nobody reached');
    await expect(svc.setHold('L1', { on: true, reason: 'x', until: '2020-01-01' }, 'org1', 'u1')).rejects.toThrow('in the future');
  });

  it('ends a pause on its day: releases the file, logs it and leaves a revisit task', async () => {
    const prisma: any = {
      surplusDetail: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'd1', leadId: 'L1', heldAt: ago(182), holdReason: 'nobody reached', lead: { sellerFirstName: 'Ada', sellerLastName: 'Quill' } },
        ]),
        update: jest.fn(),
      },
      activity: { create: jest.fn() },
      task: { create: jest.fn() },
    };
    const svc = new SurplusCadenceService(prisma, { get: () => 'true' } as any, {} as any);
    expect(await svc.endPauses(NOW)).toBe(1);
    expect(prisma.surplusDetail.findMany.mock.calls[0][0].where).toEqual({ heldAt: { not: null }, holdUntil: { not: null, lte: NOW } });
    expect(prisma.surplusDetail.update.mock.calls[0][0].data).toEqual({ heldAt: null, holdReason: null, heldByUserId: null, holdUntil: null });
    expect(prisma.task.create.mock.calls[0][0].data).toMatchObject({ leadId: 'L1', title: 'Revisit Ada Quill: the pause has ended' });
    expect(prisma.activity.create.mock.calls[0][0].data.description).toMatch(/^Pause ended, back in the queues\. Paused .+\. Reason: nobody reached$/);
  });
});

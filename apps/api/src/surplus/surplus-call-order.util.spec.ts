import { callOrder, courseOrder } from './surplus-call-order.util';

describe('courseOrder', () => {
  it('puts a short window first, then the biggest surplus, then the nearest cutoff', () => {
    const a = { shortWindow: false, netToClaimant: 171_000, daysToCutoff: 200 };
    const b = { shortWindow: true, netToClaimant: 39_000, daysToCutoff: 27 };
    const c = { shortWindow: false, netToClaimant: 171_000, daysToCutoff: 90 };
    const d = { shortWindow: false, netToClaimant: 20_000, daysToCutoff: null };
    expect([a, b, c, d].sort(courseOrder)).toEqual([b, c, a, d]);
  });
});

describe('callOrder', () => {
  it('leads with the queue, so Call now comes before research whatever the money', () => {
    const research = { queue: 'name_search', netToClaimant: 500_000, workScore: 900 };
    const call = { queue: 'call', netToClaimant: 10_000, workScore: 300 };
    expect([research, call].sort(callOrder)).toEqual([call, research]);
  });

  it('inside a queue a short window beats a bigger surplus with more touches and an overdue task', () => {
    const entity = { queue: 'call', shortWindow: false, netToClaimant: 171_000, daysToCutoff: 180, workScore: 860 };
    const claimant = { queue: 'call', shortWindow: true, netToClaimant: 39_000, daysToCutoff: 27, workScore: 455 };
    expect([entity, claimant].sort(callOrder)).toEqual([claimant, entity]);
  });

  it('breaks a full tie on the work score', () => {
    const weak = { queue: 'call', netToClaimant: 50_000, daysToCutoff: 100, workScore: 400 };
    const strong = { queue: 'call', netToClaimant: 50_000, daysToCutoff: 100, workScore: 455 };
    expect([weak, strong].sort(callOrder)).toEqual([strong, weak]);
  });
});

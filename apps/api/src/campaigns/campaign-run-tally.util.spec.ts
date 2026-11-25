import { CampaignRunTally } from './campaign-run-tally.util';

describe('CampaignRunTally', () => {
  it('says nothing when the run did nothing', () => {
    expect(new CampaignRunTally().summary()).toBeNull();
  });

  it('folds a backlog of rate limited emails into one clause with the earliest retry', () => {
    const t = new CampaignRunTally();
    t.add({ kind: 'SENT' });
    for (let i = 0; i < 47; i++) {
      t.add({
        kind: 'DEFERRED',
        reason: `email daily limit reached (${89 + (i % 2)}/90 in the last day)`,
        retryAt: new Date(Date.UTC(2026, 10, 25, 17, 0 + (i % 3))),
      });
    }
    expect(t.summary()).toBe('1 sent, 47 deferred until 2026-11-25T17:00:00.000Z (email daily limit reached)');
  });

  it('keeps different deferral reasons apart', () => {
    const t = new CampaignRunTally();
    t.add({ kind: 'DEFERRED', reason: 'email daily limit reached (90/90 in the last day)', retryAt: new Date('2026-11-25T17:00:00Z') });
    t.add({ kind: 'DEFERRED', reason: 'email hourly limit reached (20/20 in the last hour)', retryAt: new Date('2026-11-25T16:10:00Z') });
    expect(t.summary()).toBe(
      '1 deferred until 2026-11-25T17:00:00.000Z (email daily limit reached), ' +
        '1 deferred until 2026-11-25T16:10:00.000Z (email hourly limit reached)',
    );
  });

  it('counts every other outcome', () => {
    const t = new CampaignRunTally();
    t.add(null);
    t.add({ kind: 'SKIPPED', reason: 'no email' });
    t.add({ kind: 'RETRY', reason: 'Twilio 500' });
    t.count('removed');
    t.count('failed');
    expect(t.summary()).toBe('1 completed, 1 skipped, 1 retry, 1 removed, 1 failed');
  });
});

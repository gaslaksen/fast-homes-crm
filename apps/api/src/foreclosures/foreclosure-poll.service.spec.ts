import { ForeclosurePollService } from './foreclosure-poll.service';

/**
 * The daily Mecklenburg Times pull is OFF by default as of 2026-09-01.
 *
 * Pinned as a test because the default is the whole mechanism: this used to
 * default ON, and an unset variable is the easiest thing in the world to
 * reintroduce while adding an unrelated config key. A job that quietly restarts
 * itself is worse than one nobody switched off.
 */
function svc(env: Record<string, string | undefined>) {
  const ingest = { ingestRssFeed: jest.fn().mockResolvedValue({ created: 0 }) };
  const config = { get: (k: string) => env[k] };
  return {
    poll: new ForeclosurePollService(config as any, ingest as any),
    ingest,
  };
}

describe('ForeclosurePollService', () => {
  it('does not run when the variable is unset', async () => {
    const { poll, ingest } = svc({});
    expect(poll.scheduleEnabled).toBe(false);
    await poll.pollFeed();
    expect(ingest.ingestRssFeed).not.toHaveBeenCalled();
  });

  it('does not run for any value other than an explicit "true"', async () => {
    // "false", "0" and a stray "TRUE" from a hand-edited env all mean off. Only
    // the exact string starts a job that scrapes a newspaper every morning.
    for (const v of ['false', '0', 'no', '', 'TRUE', 'yes']) {
      const { poll, ingest } = svc({ FORECLOSURE_RSS_POLL_ENABLED: v });
      await poll.pollFeed();
      expect(ingest.ingestRssFeed).not.toHaveBeenCalled();
    }
  });

  it('runs again when explicitly switched back on', async () => {
    const { poll, ingest } = svc({ FORECLOSURE_RSS_POLL_ENABLED: 'true' });
    expect(poll.scheduleEnabled).toBe(true);
    await poll.pollFeed();
    expect(ingest.ingestRssFeed).toHaveBeenCalledTimes(1);
  });

  it('still passes the default org through when it is on', async () => {
    const { poll, ingest } = svc({
      FORECLOSURE_RSS_POLL_ENABLED: 'true',
      FORECLOSURE_DEFAULT_ORG_ID: 'org-1',
    });
    await poll.pollFeed();
    expect(ingest.ingestRssFeed).toHaveBeenCalledWith({
      organizationId: 'org-1',
      trigger: 'cron',
    });
  });
});

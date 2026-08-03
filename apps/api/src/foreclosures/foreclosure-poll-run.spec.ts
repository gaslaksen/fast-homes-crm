import axios from 'axios';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { ForeclosureIngestService } from './foreclosure-ingest.service';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

/** Ingest service with everything but config and prisma stubbed out. */
function buildService(create: jest.Mock) {
  const config = { get: () => undefined } as unknown as ConfigService;
  const prisma = { foreclosurePollRun: { create } } as unknown as PrismaService;
  const none = {} as any;
  return new ForeclosureIngestService(config, prisma, none, none, none, none, none, none, none);
}

describe('foreclosure poll run recording', () => {
  beforeEach(() => jest.clearAllMocks());

  it('records a failed feed fetch instead of leaving no trace', async () => {
    mockedAxios.get.mockRejectedValueOnce(new Error('getaddrinfo ENOTFOUND mecktimes.com'));
    const create = jest.fn().mockResolvedValue({});

    const result = await buildService(create).ingestRssFeed({
      organizationId: 'org-1',
      trigger: 'cron',
    });

    expect(result.errors).toBe(1);
    expect(create).toHaveBeenCalledTimes(1);
    const row = create.mock.calls[0][0].data;
    expect(row.ok).toBe(false);
    expect(row.trigger).toBe('cron');
    expect(row.organizationId).toBe('org-1');
    expect(row.errors).toBe(1);
    expect(row.message).toContain('feed fetch failed');
    expect(row.finishedAt).toBeInstanceOf(Date);
  });

  it('records a successful empty pull as ok', async () => {
    mockedAxios.get.mockResolvedValueOnce({
      data: '<?xml version="1.0"?><rss version="2.0"><channel><title>t</title></channel></rss>',
    });
    const create = jest.fn().mockResolvedValue({});

    const result = await buildService(create).ingestRssFeed({ trigger: 'manual' });

    expect(result.errors).toBe(0);
    const row = create.mock.calls[0][0].data;
    expect(row.ok).toBe(true);
    expect(row.trigger).toBe('manual');
    expect(row.scanned).toBe(0);
    // No default org configured: recorded as null rather than invented.
    expect(row.organizationId).toBeNull();
  });

  it('does not fail the ingest when the run row cannot be written', async () => {
    mockedAxios.get.mockResolvedValueOnce({
      data: '<?xml version="1.0"?><rss version="2.0"><channel><title>t</title></channel></rss>',
    });
    const create = jest.fn().mockRejectedValue(new Error('table is gone'));

    await expect(buildService(create).ingestRssFeed({ trigger: 'cron' })).resolves.toMatchObject({
      errors: 0,
    });
  });
});

import { PrismaService } from '../prisma/prisma.service';
import { ForeclosuresService } from './foreclosures.service';
import { ForeclosureSourceKind } from '@fast-homes/shared';
import { ForeclosureLeadInput } from './foreclosure.types';

/**
 * Prisma stub that records what the service asked for. Only the calls
 * createForeclosureLead makes before it decides to create are stubbed - the
 * decision is what these tests are about.
 */
function buildService(opts: { suppression?: any; existingDetail?: any } = {}) {
  const suppressionFindFirst = jest.fn().mockResolvedValue(opts.suppression ?? null);
  const detailFindFirst = jest.fn().mockResolvedValue(opts.existingDetail ?? null);
  const leadCreate = jest.fn().mockResolvedValue({ id: 'new-lead' });
  const prisma = {
    foreclosureSuppression: { findFirst: suppressionFindFirst, createMany: jest.fn() },
    foreclosureDetail: { findFirst: detailFindFirst },
    lead: { create: leadCreate, findMany: jest.fn().mockResolvedValue([]), deleteMany: jest.fn() },
  } as unknown as PrismaService;
  return {
    service: new ForeclosuresService(prisma),
    suppressionFindFirst,
    detailFindFirst,
    leadCreate,
  };
}

const notice = (over: Partial<ForeclosureLeadInput> = {}): ForeclosureLeadInput => ({
  sourceKind: ForeclosureSourceKind.RSS,
  address: '10990 Princeton Village Dr',
  city: 'Charlotte',
  zip: '28277',
  ownerNames: 'Delah Kudjiku',
  saleDate: '2026-09-01',
  ...over,
});

describe('createForeclosureLead dedupe', () => {
  it('refuses to recreate a notice the team deleted', async () => {
    const { service, leadCreate } = buildService({ suppression: { id: 'sup-1' } });

    const res = await service.createForeclosureLead(notice(), { organizationId: 'org-1' });

    expect(res).toEqual({ leadId: null, created: false, reason: 'suppressed' });
    expect(leadCreate).not.toHaveBeenCalled();
  });

  it('checks suppression on the address as well as the notice identifiers', async () => {
    const { service, suppressionFindFirst } = buildService();

    await service.createForeclosureLead(
      notice({ noticeId: 'n-1', caseNumber: '26SP002284-590' }),
      { organizationId: 'org-1' },
    );

    const or = suppressionFindFirst.mock.calls[0][0].where.OR;
    expect(or).toContainEqual({ noticeId: 'n-1' });
    expect(or).toContainEqual({ caseNumber: '26SP002284-590' });
    expect(or.some((c: any) => c.addressKey)).toBe(true);
  });

  it('falls back to the address when the notice carries no case number', async () => {
    // The gap that forked twins: no case number, and a moved sale date changes
    // dedupeUid with nothing left to catch it.
    const { service, detailFindFirst } = buildService();

    await service.createForeclosureLead(notice({ caseNumber: '' }), { organizationId: 'org-1' });

    const or = detailFindFirst.mock.calls[0][0].where.OR;
    expect(or.some((c: any) => c.addressKey === '10990 PRINCETON VILLAGE|28277')).toBe(true);
  });

  it('does NOT fall back to the address when the notice has its own case number', async () => {
    // Two case numbers at one address are two real proceedings - an HOA lien
    // and a mortgage default, say - and must stay separate leads.
    const { service, detailFindFirst } = buildService();

    await service.createForeclosureLead(
      notice({ caseNumber: '26SP002284-590' }),
      { organizationId: 'org-1' },
    );

    const or = detailFindFirst.mock.calls[0][0].where.OR;
    expect(or.some((c: any) => c.addressKey)).toBe(false);
    expect(or).toContainEqual({ caseNumber: '26SP002284-590' });
  });

  it('stores the address key on the new detail so the backstop works next time', async () => {
    const { service, leadCreate } = buildService();

    await service.createForeclosureLead(notice({ caseNumber: '' }), { organizationId: 'org-1' });

    const detail = leadCreate.mock.calls[0][0].data.foreclosureDetail.create;
    expect(detail.addressKey).toBe('10990 PRINCETON VILLAGE|28277');
  });
});

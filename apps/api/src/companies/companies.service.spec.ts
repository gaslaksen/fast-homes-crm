import { CompaniesService } from './companies.service';

describe('CompaniesService.forUser', () => {
  function setup(rows: any[]) {
    const prisma: any = { brand: { findMany: jest.fn().mockResolvedValue(rows) } };
    return { prisma, service: new CompaniesService(prisma) };
  }

  const qchb = {
    id: 'brand_qchb_org1',
    key: 'qchb',
    legalName: 'Quick Cash Home Buyers',
    shortName: null,
    modules: [{ module: 'TAX_SALES' }, { module: 'PROPERTY_LEADS' }, { module: 'PROBATE' }, { module: 'FORECLOSURES' }],
  };
  const dig = {
    id: 'brand_digdeeper_org1',
    key: 'digdeeper',
    legalName: 'D.I.G. Deeper LLC',
    shortName: 'D.I.G. Deeper',
    modules: [{ module: 'SURPLUS_FUNDS' }],
  };

  it('asks only for active companies in the account that this user can see', async () => {
    const { prisma, service } = setup([]);
    await service.forUser('u1', 'org1');
    expect(prisma.brand.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { organizationId: 'org1', active: true, users: { some: { userId: 'u1' } } },
      }),
    );
  });

  it('puts the company with Property Leads first and orders each menu', async () => {
    const { service } = setup([dig, qchb]);
    const out = await service.forUser('u1', 'org1');

    expect(out.map((c) => c.key)).toEqual(['qchb', 'digdeeper']);
    expect(out[0].modules).toEqual(['PROPERTY_LEADS', 'FORECLOSURES', 'PROBATE', 'TAX_SALES']);
    expect(out[1].modules).toEqual(['SURPLUS_FUNDS']);
  });

  it('shows the spoken name and keeps the filed one', async () => {
    const { service } = setup([dig, qchb]);
    const out = await service.forUser('u1', 'org1');

    expect(out[0].name).toBe('Quick Cash Home Buyers');
    expect(out[1]).toMatchObject({ name: 'D.I.G. Deeper', legalName: 'D.I.G. Deeper LLC' });
  });
});

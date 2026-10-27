import { AuthService } from './auth.service';

describe('AuthService.inviteUser', () => {
  const invite = {
    email: ' New@Example.com ',
    firstName: 'New',
    lastName: 'Person',
    role: 'AGENT',
    organizationId: 'org1',
    tempPassword: 'temp-pass-123',
  };

  function setup(brandIds: string[]) {
    const prisma: any = {
      organization: { findUnique: jest.fn().mockResolvedValue({ id: 'org1', maxUsers: 10 }) },
      user: {
        count: jest.fn().mockResolvedValue(3),
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockImplementation(({ data }) =>
          Promise.resolve({ id: 'u1', ...data, organization: { id: 'org1', name: 'Org' } }),
        ),
      },
      brand: { findMany: jest.fn().mockResolvedValue(brandIds.map((id) => ({ id }))) },
    };
    return { prisma, service: new AuthService(prisma, {} as any, {} as any) };
  }

  it('gives a new teammate every company in their account', async () => {
    const { prisma, service } = setup(['brand_qchb_org1', 'brand_digdeeper_org1']);
    await service.inviteUser(invite);

    expect(prisma.brand.findMany).toHaveBeenCalledWith({
      where: { organizationId: 'org1' },
      select: { id: true },
    });
    const { data } = prisma.user.create.mock.calls[0][0];
    expect(data.brands).toEqual({
      create: [{ brandId: 'brand_qchb_org1' }, { brandId: 'brand_digdeeper_org1' }],
    });
    expect(data.email).toBe('new@example.com');
  });

  it('still invites into an account that has no companies yet', async () => {
    const { prisma, service } = setup([]);
    await service.inviteUser(invite);

    const { data } = prisma.user.create.mock.calls[0][0];
    expect(data.brands).toEqual({ create: [] });
  });
});

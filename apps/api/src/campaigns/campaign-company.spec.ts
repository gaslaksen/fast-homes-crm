import { BadRequestException } from '@nestjs/common';
import { CampaignsService } from './campaigns.service';

/**
 * A campaign made while a company is selected is saved as that company's.
 * The id arrives from the browser, so it is only kept when it is one of this
 * account's companies.
 */
function setup(brand: { id: string } | null) {
  const create = jest.fn(async ({ data }: any) => ({ id: 'camp_1', ...data }));
  const prisma: any = {
    brand: { findFirst: jest.fn().mockResolvedValue(brand) },
    $transaction: (fn: any) => fn({ campaign: { create } }),
  };
  return { svc: new CampaignsService(prisma), prisma, create };
}

describe('campaign company on create', () => {
  it('keeps a company from this account', async () => {
    const { svc, prisma, create } = setup({ id: 'brand_digdeeper_org1' });
    await svc.createCampaign({ name: 'Surplus Text', brandId: 'brand_digdeeper_org1' }, 'org1');

    expect(prisma.brand.findFirst).toHaveBeenCalledWith({
      where: { id: 'brand_digdeeper_org1', organizationId: 'org1' },
      select: { id: true },
    });
    expect(create.mock.calls[0][0].data.brandId).toBe('brand_digdeeper_org1');
  });

  it("refuses another account's company", async () => {
    const { svc, create } = setup(null);
    await expect(
      svc.createCampaign({ name: 'X', brandId: 'brand_qchb_org2' }, 'org1'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(create).not.toHaveBeenCalled();
  });

  it('refuses any company when the account is unknown', async () => {
    const { svc, prisma } = setup({ id: 'brand_qchb_org1' });
    await expect(svc.createCampaign({ name: 'X', brandId: 'brand_qchb_org1' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(prisma.brand.findFirst).not.toHaveBeenCalled();
  });

  it('leaves the campaign unassigned when no company is sent', async () => {
    const { svc, prisma, create } = setup(null);
    await svc.createCampaign({ name: 'Email' }, 'org1');

    expect(prisma.brand.findFirst).not.toHaveBeenCalled();
    expect(create.mock.calls[0][0].data.brandId).toBeNull();
  });
});

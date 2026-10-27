import { BadRequestException, NotFoundException } from '@nestjs/common';
import { CampaignsService } from './campaigns.service';

/**
 * Campaign create and edit only write the fields the builder edits, and
 * every write by id checks the campaign belongs to the caller's account.
 * The edit page posts the whole campaign back, so extra keys are dropped,
 * never rejected.
 */
function setup(opts: { owned?: boolean; brand?: { id: string } | null } = {}) {
  const owned = opts.owned ?? true;
  const update = jest.fn(async ({ data }: any) => ({ id: 'camp_1', ...data }));
  const create = jest.fn(async ({ data }: any) => ({ id: 'camp_2', ...data }));
  const prisma: any = {
    campaign: {
      findFirst: jest.fn().mockResolvedValue(owned ? { id: 'camp_1' } : null),
      findUnique: jest.fn().mockResolvedValue({
        id: 'camp_1',
        name: 'SMS',
        organizationId: 'org1',
        createdAt: new Date(),
        updatedAt: new Date(),
        steps: [],
      }),
      update,
      delete: jest.fn().mockResolvedValue({}),
    },
    brand: { findFirst: jest.fn().mockResolvedValue(opts.brand ?? null) },
    campaignStep: { findMany: jest.fn().mockResolvedValue([]) },
  };
  prisma.$transaction = (fn: any) => fn({ ...prisma, campaign: { ...prisma.campaign, create } });
  const svc = new CampaignsService(prisma);
  // The edit returns the reloaded campaign; not under test here.
  jest.spyOn(svc, 'getCampaignDetail').mockResolvedValue({} as any);
  return { svc, prisma, update, create };
}

// What the edit page sends: the builder's fields plus whatever came back
// from the API when the campaign was loaded.
const editBody: any = {
  id: 'camp_1',
  name: 'SMS v2',
  description: 'Re-engage',
  triggerDays: 10,
  enrollmentMode: 'manual',
  isActive: true,
  fromNumber: '',
  organizationId: 'org2',
  isDefault: true,
  createdAt: '2026-01-01T00:00:00Z',
  _count: { enrollments: 3 },
};

describe('campaign edit', () => {
  it('writes only the builder fields', async () => {
    const { svc, update } = setup();
    await svc.updateCampaign('camp_1', editBody, 'org1');

    expect(update.mock.calls[0][0]).toEqual({
      where: { id: 'camp_1' },
      data: {
        name: 'SMS v2',
        description: 'Re-engage',
        triggerDays: 10,
        enrollmentMode: 'manual',
        isActive: true,
        fromNumber: null,
      },
    });
  });

  it("refuses another account's campaign without writing", async () => {
    const { svc, prisma, update } = setup({ owned: false });
    await expect(svc.updateCampaign('camp_1', { name: 'x' }, 'org1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(prisma.campaign.findFirst).toHaveBeenCalledWith({
      where: { id: 'camp_1', organizationId: 'org1' },
      select: { id: true },
    });
    expect(update).not.toHaveBeenCalled();
  });

  it('matches nothing when the request has no account', async () => {
    const { svc, prisma, update } = setup();
    await expect(svc.updateCampaign('camp_1', { name: 'x' })).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.campaign.findFirst).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it('leaves the company alone when none is sent', async () => {
    const { svc, prisma, update } = setup();
    await svc.updateCampaign('camp_1', { name: 'x' }, 'org1');
    expect(prisma.brand.findFirst).not.toHaveBeenCalled();
    expect(update.mock.calls[0][0].data).not.toHaveProperty('brandId');
  });

  it('clears the company on null and sets one from this account', async () => {
    const cleared = setup();
    await cleared.svc.updateCampaign('camp_1', { brandId: null }, 'org1');
    expect(cleared.update.mock.calls[0][0].data.brandId).toBeNull();

    const set = setup({ brand: { id: 'brand_qchb_org1' } });
    await set.svc.updateCampaign('camp_1', { brandId: 'brand_qchb_org1' }, 'org1');
    expect(set.update.mock.calls[0][0].data.brandId).toBe('brand_qchb_org1');
  });

  it("refuses another account's company", async () => {
    const { svc, update } = setup({ brand: null });
    await expect(
      svc.updateCampaign('camp_1', { brandId: 'brand_qchb_org2' }, 'org1'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(update).not.toHaveBeenCalled();
  });
});

describe('campaign create', () => {
  it("files the campaign under the caller's account, not one in the body", async () => {
    const { svc, create } = setup();
    await svc.createCampaign({ ...editBody, name: 'New', steps: [] }, 'org1');

    const { data } = create.mock.calls[0][0];
    expect(data.organizationId).toBe('org1');
    expect(data).not.toHaveProperty('id');
    expect(data).not.toHaveProperty('isDefault');
    expect(data).not.toHaveProperty('_count');
    expect(data).not.toHaveProperty('createdAt');
    expect(data.name).toBe('New');
  });
});

describe('campaign delete, duplicate and on/off', () => {
  it("refuse another account's campaign", async () => {
    const { svc, prisma } = setup({ owned: false });
    await expect(svc.deleteCampaign('camp_1', 'org1')).rejects.toBeInstanceOf(NotFoundException);
    await expect(svc.duplicateCampaign('camp_1', 'org1')).rejects.toBeInstanceOf(NotFoundException);
    await expect(svc.toggleCampaign('camp_1', false, 'org1')).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.campaign.delete).not.toHaveBeenCalled();
    expect(prisma.campaign.update).not.toHaveBeenCalled();
  });

  it('work on this account\'s campaign', async () => {
    const { svc, prisma, create } = setup();
    await svc.deleteCampaign('camp_1', 'org1');
    await svc.duplicateCampaign('camp_1', 'org1');
    await svc.toggleCampaign('camp_1', false, 'org1');
    expect(prisma.campaign.delete).toHaveBeenCalledWith({ where: { id: 'camp_1' } });
    expect(create.mock.calls[0][0].data).toMatchObject({ name: 'SMS (Copy)', organizationId: 'org1' });
    expect(prisma.campaign.update).toHaveBeenCalledWith({ where: { id: 'camp_1' }, data: { isActive: false } });
  });
});

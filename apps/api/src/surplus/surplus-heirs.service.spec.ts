import { SurplusHeirsService } from './surplus-heirs.service';

/**
 * Editing a person's phones. The slots are positional, so the line type and
 * the DNC result have to travel with the number, not stay in the slot.
 */
describe('SurplusHeirsService.update phones', () => {
  const heir = {
    id: 'h1',
    organizationId: 'org1',
    name: 'JANE DOE',
    phone1: '9045550101',
    phone1Type: 'Mobile',
    phone1Dnc: null,
    phone2: '9045550202',
    phone2Type: 'Landline',
    phone2Dnc: 'federal',
    phone3: null,
    phone3Type: null,
    phone3Dnc: null,
    phone4: null,
    phone4Type: null,
    phone4Dnc: null,
  };

  const setup = () => {
    let written: any = null;
    const prisma: any = {
      surplusHeir: {
        findFirst: jest.fn().mockResolvedValue(heir),
        update: jest.fn().mockImplementation(({ data }: any) => {
          written = data;
          return Promise.resolve({ ...heir, ...data });
        }),
      },
    };
    const service = new SurplusHeirsService(prisma, {} as any);
    return { service, written: () => written };
  };

  it('keeps a DNC flag on its own number when the one before it is removed', async () => {
    const { service, written } = setup();
    await service.update('h1', { phones: ['(904) 555-0202'] }, 'org1');
    expect(written()).toMatchObject({
      phone1: '9045550202',
      phone1Type: 'Landline',
      phone1Dnc: 'federal',
      phone2: null,
      phone2Dnc: null,
    });
  });

  it('gives a new number no DNC flag, even in a flagged slot', async () => {
    const { service, written } = setup();
    await service.update(
      'h1',
      { phones: [{ number: '9045550101' }, { number: '904-555-0303', type: 'Mobile' }] },
      'org1',
    );
    expect(written()).toMatchObject({
      phone1: '9045550101',
      phone1Type: 'Mobile',
      phone1Dnc: null,
      phone2: '9045550303',
      phone2Type: 'Mobile',
      phone2Dnc: null,
    });
  });

  it('drops a number entered twice and anything that is not a whole number', async () => {
    const { service, written } = setup();
    await service.update('h1', { phones: ['9045550101', '904 555 0101', '555-0199'] }, 'org1');
    expect(written()).toMatchObject({ phone1: '9045550101', phone2: null });
  });
});

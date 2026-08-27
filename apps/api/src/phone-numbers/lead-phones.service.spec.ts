import { PrismaService } from '../prisma/prisma.service';
import { LeadPhonesService } from './lead-phones.service';

/** A foreclosure lead with a landline primary and three skip-traced numbers. */
function foreclosureLead(overrides: any = {}) {
  return {
    sellerPhone: '7046082100',
    foreclosureDetail: {
      id: 'fd-1',
      phone1Type: 'Landline',
      phone2: '7049072850',
      phone2Type: 'Mobile',
      phone3: '7043929100',
      phone3Type: 'Landline',
      phone4: null,
      phone4Type: null,
    },
    probateDetail: null,
    ...overrides,
  };
}

function buildService(lead: any, opts: { lastInboundFrom?: string } = {}) {
  const leadUpdate = jest.fn().mockResolvedValue({});
  const foreclosureUpdate = jest.fn().mockResolvedValue({});
  const probateUpdate = jest.fn().mockResolvedValue({});
  const prisma = {
    lead: {
      findUnique: jest.fn().mockResolvedValue(lead),
      findFirst: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
      update: leadUpdate,
    },
    message: {
      findFirst: jest
        .fn()
        .mockResolvedValue(opts.lastInboundFrom ? { from: opts.lastInboundFrom } : null),
    },
    foreclosureDetail: { update: foreclosureUpdate },
    probateDetail: { update: probateUpdate },
    $transaction: jest.fn().mockResolvedValue([]),
  } as unknown as PrismaService;
  return {
    service: new LeadPhonesService(prisma),
    prisma: prisma as any,
    leadUpdate,
    foreclosureUpdate,
    probateUpdate,
  };
}

describe('LeadPhonesService.listForLead', () => {
  it('returns every number in E.164, primary first, with its line type', async () => {
    const { service } = buildService(foreclosureLead());
    const numbers = await service.listForLead('lead-1');

    expect(numbers).toEqual([
      { number: '+17046082100', label: 'Primary', type: 'Landline', isPrimary: true, dnc: null },
      { number: '+17049072850', label: 'Phone 2', type: 'Mobile', isPrimary: false, dnc: null },
      { number: '+17043929100', label: 'Phone 3', type: 'Landline', isPrimary: false, dnc: null },
    ]);
  });

  it('drops a duplicate the skip trace returned in two slots', async () => {
    const lead = foreclosureLead();
    lead.foreclosureDetail.phone3 = lead.foreclosureDetail.phone2;
    const { service } = buildService(lead);

    const numbers = await service.listForLead('lead-1');
    expect(numbers.map((n) => n.number)).toEqual(['+17046082100', '+17049072850']);
  });

  it('reads surplus leads, which is why a surplus conversation offered one number', async () => {
    // listForLead knew about foreclosure and probate details and not surplus,
    // so a surplus lead only ever returned sellerPhone. The composer shows a
    // To: picker when there is more than one number, and there never was.
    const { service } = buildService({
      sellerPhone: '+1 (904) 318-1919',
      foreclosureDetail: null,
      probateDetail: null,
      surplusDetail: {
        phone1Type: 'Mobile', phone1Dnc: 'federal',
        phone2: '9047662977', phone2Type: 'Land Line', phone2Dnc: 'federal',
        phone3: '9047813584', phone3Type: 'Land Line', phone3Dnc: null,
        phone4: '9046478565', phone4Type: 'Land Line', phone4Dnc: null,
      },
    });

    const numbers = await service.listForLead('lead-1');
    expect(numbers.map((n) => n.number)).toEqual([
      '+19043181919', '+19047662977', '+19047813584', '+19046478565',
    ]);
  });

  it('carries the per-number DNC flag so a send can be warned about', async () => {
    // Surplus traces routinely return numbers flagged federal DNC, TCPA or
    // litigator. A number offered without the flag is one somebody will dial.
    const { service } = buildService({
      sellerPhone: '+1 (904) 318-1919',
      foreclosureDetail: null,
      probateDetail: null,
      surplusDetail: {
        phone1Type: 'Mobile', phone1Dnc: 'litigator',
        phone2: '9047813584', phone2Type: 'Land Line', phone2Dnc: null,
        phone3: null, phone3Type: null, phone3Dnc: null,
        phone4: null, phone4Type: null, phone4Dnc: null,
      },
    });

    const numbers = await service.listForLead('lead-1');
    expect(numbers[0].dnc).toBe('litigator');
    expect(numbers[1].dnc).toBeNull();
  });

  it('reads probate leads, which carry only a second number', async () => {
    const { service } = buildService({
      sellerPhone: '+1 (704) 608-2100',
      foreclosureDetail: null,
      probateDetail: { id: 'pd-1', phone1Type: null, phone2: '7049072850', phone2Type: 'Mobile' },
    });

    const numbers = await service.listForLead('lead-1');
    expect(numbers.map((n) => n.number)).toEqual(['+17046082100', '+17049072850']);
  });
});

describe('LeadPhonesService.resolveTo', () => {
  it('accepts one of the lead\'s numbers in any spelling', async () => {
    const { service } = buildService(foreclosureLead());
    await expect(service.resolveTo('lead-1', '(704) 907-2850')).resolves.toBe('+17049072850');
  });

  it('rejects a number that is not on file rather than redirecting to the primary', async () => {
    const { service } = buildService(foreclosureLead());
    // Silently sending to someone else is worse than refusing to send.
    await expect(service.resolveTo('lead-1', '7045550000')).rejects.toThrow(/not one of this lead/);
  });

  it('falls back to the primary when nothing was requested', async () => {
    const { service } = buildService(foreclosureLead());
    await expect(service.resolveTo('lead-1', undefined)).resolves.toBe('+17046082100');
  });
});

describe('LeadPhonesService.selectedToFor', () => {
  it('preselects the number the seller last replied from', async () => {
    const { service } = buildService(foreclosureLead(), { lastInboundFrom: '+17049072850' });
    await expect(service.selectedToFor('lead-1')).resolves.toBe('+17049072850');
  });

  it('preselects the primary when they have never replied', async () => {
    const { service } = buildService(foreclosureLead());
    await expect(service.selectedToFor('lead-1')).resolves.toBe('+17046082100');
  });
});

describe('LeadPhonesService.findLeadByPhone', () => {
  it('prefers a primary match over a secondary one', async () => {
    const { service, prisma } = buildService(foreclosureLead());
    prisma.lead.findFirst.mockResolvedValueOnce({ id: 'lead-primary' });

    await expect(service.findLeadByPhone('+17046082100')).resolves.toEqual({
      leadId: 'lead-primary',
      isPrimary: true,
    });
    expect(prisma.lead.findFirst).toHaveBeenCalledTimes(1);
  });

  it('falls through to the skip-traced numbers, so a reply is not dropped', async () => {
    const { service, prisma } = buildService(foreclosureLead());
    prisma.lead.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'lead-secondary' });

    await expect(service.findLeadByPhone('7049072850')).resolves.toEqual({
      leadId: 'lead-secondary',
      isPrimary: false,
    });
  });

  it('ignores anything that is not a 10 digit number', async () => {
    const { service, prisma } = buildService(foreclosureLead());
    await expect(service.findLeadByPhone('12345')).resolves.toBeNull();
    expect(prisma.lead.findFirst).not.toHaveBeenCalled();
  });
});

describe('LeadPhonesService.setPrimary', () => {
  it('swaps the promoted number and its line type with the old primary', async () => {
    const { service, prisma } = buildService(foreclosureLead());

    await service.setPrimary('lead-1', '+17049072850');

    expect(prisma.lead.update).toHaveBeenCalledWith({
      where: { id: 'lead-1' },
      data: { sellerPhone: '7049072850' },
    });
    expect(prisma.foreclosureDetail.update).toHaveBeenCalledWith({
      where: { id: 'fd-1' },
      // The demoted primary lands in the slot the promoted number vacated,
      // carrying its own line type with it.
      data: { phone2: '7046082100', phone2Type: 'Landline', phone1Type: 'Mobile' },
    });
  });

  it('refuses a number that is not on file', async () => {
    const { service } = buildService(foreclosureLead());
    await expect(service.setPrimary('lead-1', '7045550000')).rejects.toThrow(
      /not one of this lead/,
    );
  });

  it('is a no-op when the number is already primary', async () => {
    const { service, prisma } = buildService(foreclosureLead());
    await service.setPrimary('lead-1', '7046082100');
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});

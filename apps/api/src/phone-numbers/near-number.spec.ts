import { LeadPhonesService, phoneDigitsWhere, phoneSearchDigits } from './lead-phones.service';

/**
 * A caller on a number we do not hold, a few digits off one we do. A
 * household's lines are often consecutive, so this is offered as a likely
 * match, never applied on its own.
 */
describe('LeadPhonesService.nearNumberHolders', () => {
  function service(opts: { leads?: any[]; heirs?: any[] }) {
    const prisma = {
      lead: { findMany: jest.fn(async () => opts.leads || []) },
      surplusHeir: { findMany: jest.fn(async () => opts.heirs || []) },
    } as any;
    return { svc: new LeadPhonesService(prisma), prisma };
  }

  it('finds the relative we hold one line over, nearest first', async () => {
    const { svc, prisma } = service({
      heirs: [
        { id: 'tina', phone1: '3524678379', phone2: '3528072150', phone3: null, phone4: '3524678424', surplusDetail: { leadId: 'kelly' } },
      ],
      leads: [{ id: 'other', sellerPhone: '+13524678431', surplusDetail: null, foreclosureDetail: null, probateDetail: null, taxSaleDetail: null }],
    });
    const out = await svc.nearNumberHolders('+13524678427');

    expect(out).toEqual([
      { number: '3524678424', gap: 3, leadId: 'kelly', heirId: 'tina' },
      { number: '3524678431', gap: 4, leadId: 'other', heirId: null },
    ]);
    const candidates = (prisma.surplusHeir.findMany.mock.calls[0] as any)[0].where.OR[0].phone1.in;
    expect(candidates).toContain('3524678422');
    expect(candidates).toContain('3524678432');
    // The caller's own number is an exact match, handled elsewhere.
    expect(candidates).not.toContain('3524678427');
    expect(candidates).toHaveLength(10);
  });

  it('never crosses into another exchange', async () => {
    const { svc, prisma } = service({});
    await svc.nearNumberHolders('+13524670002');
    const candidates: string[] = (prisma.surplusHeir.findMany.mock.calls[0] as any)[0].where.OR[0].phone1.in;
    expect(candidates.every((c) => c.startsWith('352467'))).toBe(true);
    expect(candidates).not.toContain('352466999' + '9');
  });

  it('ignores a number that is not ten digits', async () => {
    const { svc, prisma } = service({});
    expect(await svc.nearNumberHolders('12345')).toEqual([]);
    expect(prisma.lead.findMany).not.toHaveBeenCalled();
  });
});

describe('phone searches', () => {
  it('reads a typed number however it is formatted', () => {
    expect(phoneSearchDigits('(352) 467-8424')).toBe('3524678424');
    expect(phoneSearchDigits('+1 352 467 8424')).toBe('3524678424');
    expect(phoneSearchDigits('4678424')).toBe('4678424');
  });

  it('leaves addresses and names alone', () => {
    expect(phoneSearchDigits('34132 HYATT RD')).toBe('');
    expect(phoneSearchDigits('Tina')).toBe('');
    expect(phoneSearchDigits('8424')).toBe('');
    expect(phoneDigitsWhere('')).toEqual([]);
  });

  it('matches every slot and the people on a surplus case', () => {
    const where = phoneDigitsWhere('3524678424');
    expect(where[0]).toEqual({ sellerPhone: { contains: '3524678424' } });
    expect(where).toContainEqual({
      surplusDetail: {
        heirs: { some: { OR: [1, 2, 3, 4].map((i) => ({ [`phone${i}`]: { contains: '3524678424' } })) } },
      },
    });
    expect(where.some((w) => w.taxSaleDetail)).toBe(true);
  });
});

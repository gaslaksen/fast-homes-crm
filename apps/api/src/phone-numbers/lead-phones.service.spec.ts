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
    $queryRaw: jest.fn().mockResolvedValue([]),
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
      { number: '+17046082100', label: 'Primary', type: 'Landline', isPrimary: true, dnc: null, bad: false },
      { number: '+17049072850', label: 'Phone 2', type: 'Mobile', isPrimary: false, dnc: null, bad: false },
      { number: '+17043929100', label: 'Phone 3', type: 'Landline', isPrimary: false, dnc: null, bad: false },
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

  it('matches a primary stored with formatting, before the skip-traced numbers', async () => {
    // A lead edited by hand kept "(704) 681-2994", the exact match missed it,
    // and the seller rang in as a bare number with no name.
    const { service, prisma } = buildService(foreclosureLead());
    prisma.$queryRaw.mockResolvedValueOnce([{ id: 'lead-formatted' }]);

    await expect(service.findLeadByPhone('+17046812994')).resolves.toEqual({
      leadId: 'lead-formatted',
      isPrimary: true,
    });
    expect(prisma.lead.findFirst).toHaveBeenCalledTimes(1);
    expect(prisma.$queryRaw.mock.calls[0]).toContain('7046812994');
  });

  it('skips the digits-only scan when the exact match hits', async () => {
    const { service, prisma } = buildService(foreclosureLead());
    prisma.lead.findFirst.mockResolvedValueOnce({ id: 'lead-primary' });

    await service.findLeadByPhone('+17046082100');
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });
});

describe('LeadPhonesService.findLeadByPhone with the dialled line', () => {
  const DIG_DEEPER_LINE = '+19045959620';
  const QUICK_CASH_LINE = '+18885748121';

  /**
   * One person who is both a Quick Cash seller (newer lead) and a D.I.G.
   * Deeper claimant (older lead), on the same primary number.
   */
  function bothBusinesses() {
    const built = buildService(foreclosureLead());
    built.prisma.lead.findFirst.mockImplementation(async ({ where }: any) => {
      if (!where.OR?.some((c: any) => 'sellerPhone' in c)) return null;
      if (where.source === 'SURPLUS') return { id: 'lead-claimant' };
      return { id: 'lead-seller' };
    });
    return built;
  }

  it('lands a text to the D.I.G. Deeper line on the surplus lead, not the newer seller lead', async () => {
    const { service, prisma } = bothBusinesses();
    await expect(service.findLeadByPhone('+17046082100', DIG_DEEPER_LINE)).resolves.toEqual({
      leadId: 'lead-claimant',
      isPrimary: true,
    });
    expect(prisma.lead.findFirst.mock.calls[0][0].where.source).toBe('SURPLUS');
  });

  it('lands a text to a Quick Cash line on the seller lead', async () => {
    const { service, prisma } = bothBusinesses();
    await expect(service.findLeadByPhone('+17046082100', QUICK_CASH_LINE)).resolves.toEqual({
      leadId: 'lead-seller',
      isPrimary: true,
    });
    expect(prisma.lead.findFirst.mock.calls[0][0].where.source).toEqual({ not: 'SURPLUS' });
  });

  it('keeps the old newest-lead search when no line is given', async () => {
    const { service, prisma } = bothBusinesses();
    await expect(service.findLeadByPhone('+17046082100')).resolves.toEqual({
      leadId: 'lead-seller',
      isPrimary: true,
    });
    expect(prisma.lead.findFirst.mock.calls[0][0].where.source).toBeUndefined();
  });

  it('widens a Quick Cash line to every lead when it has none, so the text is not dropped', async () => {
    // Older surplus letters went out on Quick Cash numbers.
    const { service, prisma } = buildService(foreclosureLead());
    prisma.surplusHeir = { findFirst: jest.fn().mockResolvedValue(null) };
    prisma.lead.findFirst.mockImplementation(async ({ where }: any) => {
      if (where.source !== undefined) return null;
      return where.OR?.some((c: any) => 'sellerPhone' in c) ? { id: 'lead-claimant' } : null;
    });

    await expect(service.findLeadByPhone('+17046082100', QUICK_CASH_LINE)).resolves.toEqual({
      leadId: 'lead-claimant',
      isPrimary: true,
    });
  });

  it('never lands a call to the D.I.G. Deeper line on a Quick Cash lead', async () => {
    const { service, prisma } = buildService(foreclosureLead());
    prisma.surplusHeir = { findFirst: jest.fn().mockResolvedValue(null) };
    prisma.lead.findFirst.mockImplementation(async ({ where }: any) => {
      if (where.source !== undefined) return null;
      return where.OR?.some((c: any) => 'sellerPhone' in c) ? { id: 'lead-seller' } : null;
    });

    await expect(service.findLeadByPhone('+17046082100', DIG_DEEPER_LINE)).resolves.toBeNull();
    for (const [args] of prisma.lead.findFirst.mock.calls) expect(args.where.source).toBe('SURPLUS');
  });

  it('lands on a live claim before a newer one marked Dead', async () => {
    // Jean Fleurinor, 2026-10-21: three claims on one number, the newest
    // marked Dead and hidden from the board, and his callback landed there.
    const { service, prisma } = buildService(foreclosureLead());
    prisma.lead.findFirst.mockImplementation(async ({ where }: any) => {
      if (!where.OR?.some((c: any) => 'sellerPhone' in c)) return null;
      return where.status ? { id: 'claim-live' } : { id: 'claim-dead' };
    });

    await expect(service.findLeadByPhone('+19548054423', DIG_DEEPER_LINE)).resolves.toEqual({
      leadId: 'claim-live',
      isPrimary: true,
    });
    expect(prisma.lead.findFirst.mock.calls[0][0].where).toMatchObject({
      source: 'SURPLUS',
      status: { not: 'DEAD' },
    });
  });

  it('still lands on a Dead claim when it is the only one on the number', async () => {
    const { service, prisma } = buildService(foreclosureLead());
    prisma.surplusHeir = { findFirst: jest.fn().mockResolvedValue(null) };
    prisma.lead.findFirst.mockImplementation(async ({ where }: any) => {
      if (where.status || !where.OR?.some((c: any) => 'sellerPhone' in c)) return null;
      return { id: 'claim-dead' };
    });

    await expect(service.findLeadByPhone('+19548054423', DIG_DEEPER_LINE)).resolves.toEqual({
      leadId: 'claim-dead',
      isPrimary: true,
    });
  });

  it('passes over a Dead lead in the formatted-number scan on the live pass', async () => {
    const { service, prisma } = buildService(foreclosureLead());
    prisma.$queryRaw.mockResolvedValue([
      { id: 'claim-dead', source: 'SURPLUS', status: 'DEAD' },
      { id: 'claim-live', source: 'SURPLUS', status: 'NEW' },
    ]);

    await expect(service.findLeadByPhone('+17046812994', DIG_DEEPER_LINE)).resolves.toEqual({
      leadId: 'claim-live',
      isPrimary: true,
    });
  });

  it('keeps a formatted primary in the dialled company too', async () => {
    const { service, prisma } = buildService(foreclosureLead());
    prisma.$queryRaw.mockResolvedValueOnce([
      { id: 'lead-seller', source: 'PROPERTY_LEADS' },
      { id: 'lead-claimant', source: 'SURPLUS' },
    ]);

    await expect(service.findLeadByPhone('+17046812994', DIG_DEEPER_LINE)).resolves.toEqual({
      leadId: 'lead-claimant',
      isPrimary: true,
    });
  });

  it('does not look at surplus heirs for a call to a Quick Cash line', async () => {
    const { service, prisma } = buildService(foreclosureLead());
    const heirLookup = jest.fn().mockResolvedValue(null);
    prisma.surplusHeir = { findFirst: heirLookup };

    await expect(service.findLeadByPhone('+17046082100', QUICK_CASH_LINE)).resolves.toBeNull();
    // Called only by the widened search (its live pass, then its Dead pass),
    // never by the Quick Cash passes.
    expect(heirLookup).toHaveBeenCalledTimes(2);
  });
});

describe('LeadPhonesService.findLeadIdsByPhone', () => {
  it('includes leads whose primary is stored with formatting, so STOP reaches them', async () => {
    const { service, prisma } = buildService(foreclosureLead());
    prisma.lead.findMany.mockResolvedValueOnce([{ id: 'lead-exact' }]);
    prisma.surplusHeir = { findMany: jest.fn().mockResolvedValue([]) };
    prisma.$queryRaw.mockResolvedValueOnce([{ id: 'lead-formatted' }, { id: 'lead-exact' }]);

    await expect(service.findLeadIdsByPhone('7046812994')).resolves.toEqual([
      'lead-exact',
      'lead-formatted',
    ]);
  });
});

describe('LeadPhonesService.liveClaimIdsOnNumber', () => {
  it('returns every live surplus claim on the number, in any spelling', async () => {
    const { service, prisma } = buildService(foreclosureLead());
    prisma.lead.findMany.mockResolvedValueOnce([{ id: 'claim-1319' }, { id: 'claim-1321' }]);
    prisma.$queryRaw.mockResolvedValueOnce([
      { id: 'claim-1319', source: 'SURPLUS', status: 'NEW' },
      { id: 'claim-dead', source: 'SURPLUS', status: 'DEAD' },
      { id: 'seller-lead', source: 'PROPERTY_LEADS', status: 'NEW' },
      { id: 'claim-formatted', source: 'SURPLUS', status: 'NEW' },
    ]);

    await expect(service.liveClaimIdsOnNumber('+19548054423')).resolves.toEqual([
      'claim-1319',
      'claim-1321',
      'claim-formatted',
    ]);
    expect(prisma.lead.findMany.mock.calls[0][0].where).toMatchObject({
      source: 'SURPLUS',
      status: { not: 'DEAD' },
    });
  });

  it('ignores anything that is not a 10 digit number', async () => {
    const { service, prisma } = buildService(foreclosureLead());
    await expect(service.liveClaimIdsOnNumber('12345')).resolves.toEqual([]);
    expect(prisma.lead.findMany).not.toHaveBeenCalled();
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

/**
 * Editing what we hold.
 *
 * These write real contact data across four pipelines whose detail tables have
 * different slot counts, which is exactly where a shared helper drifts. The
 * cases worth pinning are the ones that lose data quietly.
 */
function editHarness(lead: any) {
  const updates: any[] = [];
  const detailUpdate = jest.fn(async (a: any) => { updates.push(a); return {}; });
  const leadUpdate = jest.fn(async (a: any) => { updates.push(a); return {}; });
  const prisma = {
    lead: { findUnique: jest.fn().mockResolvedValue(lead), update: leadUpdate },
    message: { findFirst: jest.fn().mockResolvedValue(null) },
    foreclosureDetail: { update: detailUpdate },
    probateDetail: { update: detailUpdate },
    surplusDetail: { update: detailUpdate },
    taxSaleDetail: { update: detailUpdate },
    $transaction: jest.fn(async (ops: any[]) => Promise.all(ops)),
  } as unknown as PrismaService;
  return { service: new LeadPhonesService(prisma), updates, leadUpdate, detailUpdate };
}

describe('LeadPhonesService.setPhones', () => {
  it('writes the primary to the lead and the rest to the detail slots', async () => {
    const { service, updates } = editHarness({
      sellerPhone: '',
      surplusDetail: { id: 'sd-1' },
      badContacts: null,
    });

    await service.setPhones('l1', [
      { number: '(904) 555-1234', type: 'Mobile' },
      { number: '9045559999', type: 'Landline' },
    ]);

    const lead = updates.find((u) => u.data.sellerPhone !== undefined);
    expect(lead.data.sellerPhone).toBe('+19045551234');
    const detail = updates.find((u) => u.data.phone2 !== undefined);
    expect(detail.data.phone2).toBe('9045559999');
    expect(detail.data.phone2Type).toBe('Landline');
    // Slots the user cleared must be nulled, not left holding an old number.
    expect(detail.data.phone3).toBeNull();
    expect(detail.data.phone4).toBeNull();
  });

  it('refuses more numbers than the pipeline can hold rather than dropping them', async () => {
    // Probate holds two. Silently discarding the third somebody just typed is
    // a loss nobody notices until they go looking for the number.
    const { service } = editHarness({ sellerPhone: '', probateDetail: { id: 'pd-1' } });
    await expect(
      service.setPhones('l1', [
        { number: '9045551111' },
        { number: '9045552222' },
        { number: '9045553333' },
      ]),
    ).rejects.toThrow(/at most 2/);
  });

  it('rejects a number that is not a number', async () => {
    const { service } = editHarness({ sellerPhone: '', surplusDetail: { id: 'sd-1' } });
    await expect(service.setPhones('l1', [{ number: '555-CALL' }])).rejects.toThrow(/not a valid/);
  });

  it('de-dupes rather than burning a slot on the same number twice', async () => {
    const { service, updates } = editHarness({ sellerPhone: '', surplusDetail: { id: 'sd-1' } });
    await service.setPhones('l1', [
      { number: '9045551234' },
      { number: '+19045551234' },
      { number: '9045559999' },
    ]);
    const detail = updates.find((u) => u.data.phone2 !== undefined);
    expect(detail.data.phone2).toBe('9045559999');
  });
});

describe('LeadPhonesService.flagContact', () => {
  it('keeps the number and records that it does not work', async () => {
    // Deleting it loses the fact that it was tried, and the next person to open
    // the lead dials it again.
    const { service, leadUpdate } = editHarness({ badContacts: null });
    const out = await service.flagContact('l1', '(904) 555-1234', true);
    expect(out.phones).toEqual(['9045551234']);
    expect(leadUpdate).toHaveBeenCalled();
  });

  it('clears a flag, matching however the number was written', async () => {
    const { service } = editHarness({ badContacts: { phones: ['9045551234'], emails: [] } });
    const out = await service.flagContact('l1', '+1 904-555-1234', false);
    expect(out.phones).toEqual([]);
  });

  it('routes an address to the email list', async () => {
    const { service } = editHarness({ badContacts: { phones: ['9045551234'], emails: [] } });
    const out = await service.flagContact('l1', 'Owner@Example.com', true);
    expect(out.emails).toEqual(['Owner@Example.com']);
    expect(out.phones).toEqual(['9045551234']);
  });

  it('does not flag the same contact twice', async () => {
    const { service } = editHarness({ badContacts: { phones: ['9045551234'], emails: [] } });
    const out = await service.flagContact('l1', '9045551234', true);
    expect(out.phones).toEqual(['9045551234']);
  });
});

describe('listForLead marks a flagged number', () => {
  it('reports bad on the number that was flagged and no other', async () => {
    const { service } = editHarness({
      sellerPhone: '9045551234',
      surplusDetail: { phone2: '9045559999', phone1Type: 'Mobile' },
      badContacts: { phones: ['9045551234'], emails: [] },
    });
    const list = await service.listForLead('l1');
    expect(list.find((p) => p.number.endsWith('5551234'))?.bad).toBe(true);
    expect(list.find((p) => p.number.endsWith('5559999'))?.bad).toBe(false);
  });
});

describe('LeadPhonesService with heirs of a deceased claimant', () => {
  /**
   * On an estate lead the heirs' numbers are the only dialable ones, because
   * the claimant is dead. They have to appear here or the composer refuses to
   * text an heir: it rejects any recipient not on the lead's own list.
   */
  const estateLead = (heirs: any[]) => ({
    sellerPhone: '9045551111',
    foreclosureDetail: null,
    probateDetail: null,
    taxSaleDetail: null,
    badContacts: null,
    surplusDetail: { phone1Type: 'Landline', heirs },
  });

  it('offers a living heir\'s number, labelled with their name', async () => {
    const { service } = buildService(
      estateLead([
        { id: 'h1', name: 'Alfred J. Spencer', deceased: false, doNotCall: false, phone1: '9045552222', phone1Type: 'Mobile' },
      ]),
    );
    const list = await service.listForLead('lead-1');
    const heir = list.find((p) => p.number === '+19045552222');
    expect(heir).toBeTruthy();
    // Named, or the picker is a list of numbers with no way to tell whose.
    expect(heir!.label).toBe('Heir: Alfred J. Spencer');
    expect(heir!.type).toBe('Mobile');
  });

  it('never offers a DECEASED heir\'s number', async () => {
    // The Spencer filing lists a surviving spouse who died in 2022. Offering
    // her old line means telling whoever answers about money they are not owed.
    const { service } = buildService(
      estateLead([
        { id: 'h1', name: 'Leila Spencer', deceased: true, doNotCall: false, phone1: '9045553333' },
      ]),
    );
    const list = await service.listForLead('lead-1');
    expect(list.map((p) => p.number)).not.toContain('+19045553333');
  });

  it('never offers a do-not-call heir\'s number', async () => {
    const { service } = buildService(
      estateLead([
        { id: 'h1', name: 'Helen F. Sherman', deceased: false, doNotCall: true, phone1: '9045554444' },
      ]),
    );
    const list = await service.listForLead('lead-1');
    expect(list.map((p) => p.number)).not.toContain('+19045554444');
  });

  it('carries an heir number\'s DNC flag through', async () => {
    const { service } = buildService(
      estateLead([
        { id: 'h1', name: 'A B', deceased: false, doNotCall: false, phone1: '9045555555', phone1Dnc: 'litigator' },
      ]),
    );
    const list = await service.listForLead('lead-1');
    expect(list.find((p) => p.number === '+19045555555')!.dnc).toBe('litigator');
  });

  it('keeps the claimant\'s own number primary and lists heirs after it', async () => {
    const { service } = buildService(
      estateLead([{ id: 'h1', name: 'A B', deceased: false, doNotCall: false, phone1: '9045556666' }]),
    );
    const list = await service.listForLead('lead-1');
    expect(list[0].isPrimary).toBe(true);
    expect(list[0].number).toBe('+19045551111');
    expect(list.filter((p) => p.isPrimary)).toHaveLength(1);
  });
});

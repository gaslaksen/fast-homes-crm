import axios from 'axios';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { ForeclosureSkiptraceService, streetLineOf } from './foreclosure-skiptrace.service';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

function leadWith(overrides: any = {}) {
  return {
    id: 'lead-1',
    propertyAddress: '5125 Birchbark Ln',
    propertyCity: 'Charlotte',
    propertyZip: '28227',
    sellerFirstName: 'Patricia',
    sellerLastName: 'Campbell',
    sellerPhone: '',
    sellerEmail: null,
    foreclosureDetail: {
      phone2: null, phone3: null, phone4: null,
      priority: 'HIGH', equityPct: null, ownerOccupied: null,
      assessedValue: null, loanAmount: null, saleDate: null, loanDate: null,
      skipStatus: null, workStatus: 'NOT_CONTACTED',
    },
    ...overrides,
  };
}

function buildService(lead: any) {
  const update = jest.fn().mockResolvedValue({});
  const prisma = {
    lead: { findFirst: jest.fn().mockResolvedValue(lead), update },
  } as unknown as PrismaService;
  // No BATCHDATA_API_KEY, so only the free NC OneMap tier runs.
  const config = { get: () => undefined } as unknown as ConfigService;
  return { service: new ForeclosureSkiptraceService(prisma, config), update };
}

describe('ForeclosureSkiptraceService.enrichLead', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Parcel lookup unreachable: the run still completes and writes NO MATCH.
    mockedAxios.get.mockRejectedValue(new Error('network down'));
  });

  describe('with onlyIfMissingContact (the automatic ingestion callers)', () => {
    it('leaves a lead that already has a phone alone', async () => {
      const { service, update } = buildService(leadWith({ sellerPhone: '7042819871' }));

      const res = await service.enrichLead('lead-1', 'org-1', { onlyIfMissingContact: true });

      expect(res).toEqual({ updated: false, reason: 'already has contact' });
      expect(update).not.toHaveBeenCalled();
      expect(mockedAxios.get).not.toHaveBeenCalled();
    });

    it('counts a phone held on the detail, not just the lead', async () => {
      const lead = leadWith();
      lead.foreclosureDetail.phone3 = '7045372739';
      const { service, update } = buildService(lead);

      const res = await service.enrichLead('lead-1', 'org-1', { onlyIfMissingContact: true });

      expect(res.reason).toBe('already has contact');
      expect(update).not.toHaveBeenCalled();
    });

    it('runs when the lead has no phone anywhere', async () => {
      const { service, update } = buildService(leadWith());

      const res = await service.enrichLead('lead-1', 'org-1', { onlyIfMissingContact: true });

      expect(res.updated).toBe(true);
      expect(update).toHaveBeenCalledTimes(1);
    });
  });

  describe('without the flag (the manual and bulk buttons)', () => {
    it('re-runs even when the lead already has a phone', async () => {
      const { service, update } = buildService(leadWith({ sellerPhone: '7042819871' }));

      const res = await service.enrichLead('lead-1', 'org-1');

      expect(res.updated).toBe(true);
      expect(update).toHaveBeenCalledTimes(1);
    });
  });

  describe('the address sent to BatchData', () => {
    /** Parcel whose owner is absentee, mailing to Florida. */
    const FL_MAILER = {
      features: [
        {
          attributes: {
            ownname: 'CAMPBELL PATRICIA',
            // Verbatim from NC OneMap for this parcel. siteadd is a full
            // address, and the "Site Address Zip" is really the El Paso
            // mailing zip - the county put it in the wrong field.
            siteadd: '10990 PRINCETON VILLAGE DR CHARLOTTE NC',
            scity: 'CHARLOTTE',
            szip: '79924-1507',
            mailadd: '4400 OCEAN BLVD',
            mcity: 'NAPLES',
            mstate: 'FL',
            mzip: '34102',
            parval: 412000,
          },
        },
      ],
    };

    function serviceWithBatch(lead: any) {
      const update = jest.fn().mockResolvedValue({});
      const prisma = {
        lead: { findFirst: jest.fn().mockResolvedValue(lead), update },
      } as unknown as PrismaService;
      const config = {
        get: (k: string) => (k === 'BATCHDATA_API_KEY' ? 'test-key' : undefined),
      } as unknown as ConfigService;
      return new ForeclosureSkiptraceService(prisma, config);
    }

    it('sends the property state, never the owner mailing state', async () => {
      mockedAxios.get.mockResolvedValue({ data: FL_MAILER });
      mockedAxios.post.mockResolvedValue({
        data: { results: { persons: [{ meta: { matched: true }, phoneNumbers: [], emails: [] }] } },
      });
      const lead = leadWith({
        propertyAddress: '10990 Princeton Village Dr',
        propertyState: 'NC',
        propertyZip: '28277',
      });

      await serviceWithBatch(lead).enrichLead('lead-1', 'org-1');

      const body = mockedAxios.post.mock.calls[0][1] as any;
      const sent = body.requests[0].propertyAddress;
      // Street, city and zip are all the NC property. The state has to match
      // them, or BatchData is being asked about an address that exists nowhere.
      expect(sent.state).toBe('NC');
      expect(sent.city).toBe('CHARLOTTE');
      expect(sent.zip).toBe('28277');
      expect(sent.street).toBe('10990 PRINCETON VILLAGE DR');
    });

    it('falls back to NC when the lead has no state recorded', async () => {
      mockedAxios.get.mockResolvedValue({ data: FL_MAILER });
      mockedAxios.post.mockResolvedValue({
        data: { results: { persons: [{ meta: { matched: false } }] } },
      });

      await serviceWithBatch(leadWith({ propertyState: '' })).enrichLead('lead-1', 'org-1');

      expect((mockedAxios.post.mock.calls[0][1] as any).requests[0].propertyAddress.state).toBe('NC');
    });
  });

  describe('a suppressed equity spread', () => {
    const parcel = {
      features: [{ attributes: {
        ownname: 'CAMPBELL PATRICIA', siteadd: '5125 BIRCHBARK LN',
        scity: 'CHARLOTTE', szip: '28227', mailadd: '5125 BIRCHBARK LN',
        mcity: 'CHARLOTTE', mstate: 'NC', parval: 312500,
      } }],
    };

    it('is not written back over by a skip trace', async () => {
      // The rules engine blanked this because the recorded figure cannot
      // support the arithmetic. A freshly found assessed value must not undo it.
      mockedAxios.get.mockResolvedValue({ data: parcel });
      const lead = leadWith();
      lead.foreclosureDetail.loanAmount = 4100;
      lead.foreclosureDetail.debtFigureReliable = false;
      const { service, update } = buildService(lead);

      await service.enrichLead('lead-1', 'org-1');

      const written = update.mock.calls[0][0].data.foreclosureDetail.update;
      expect(written.equitySpread).toBeUndefined();
    });

    it('is still computed for a lead whose figure is trusted', async () => {
      mockedAxios.get.mockResolvedValue({ data: parcel });
      const lead = leadWith();
      lead.foreclosureDetail.loanAmount = 200000;
      lead.foreclosureDetail.debtFigureReliable = true;
      const { service, update } = buildService(lead);

      await service.enrichLead('lead-1', 'org-1');

      expect(update.mock.calls[0][0].data.foreclosureDetail.update.equitySpread).toBe(112500);
    });
  });

  it('reports a missing lead instead of failing silently', async () => {
    const prisma = {
      lead: { findFirst: jest.fn().mockResolvedValue(null), update: jest.fn() },
    } as unknown as PrismaService;
    const config = { get: () => undefined } as unknown as ConfigService;

    const res = await new ForeclosureSkiptraceService(prisma, config).enrichLead('nope');

    expect(res).toEqual({ updated: false, reason: 'not found' });
  });
});

describe('streetLineOf', () => {
  it('strips the city and state NC OneMap bakes into siteadd', () => {
    expect(streetLineOf('10990 PRINCETON VILLAGE DR CHARLOTTE NC', 'CHARLOTTE', 'NC'))
      .toBe('10990 PRINCETON VILLAGE DR');
  });

  it('leaves a street line that does not carry them', () => {
    expect(streetLineOf('5125 Birchbark Ln', 'Charlotte', 'NC')).toBe('5125 Birchbark Ln');
  });

  it('does not eat a street whose name contains the city', () => {
    expect(streetLineOf('120 CHARLOTTE ST CHARLOTTE NC', 'CHARLOTTE', 'NC')).toBe('120 CHARLOTTE ST');
  });

  it('copes with a missing city or state', () => {
    expect(streetLineOf('900 Main St', undefined, undefined)).toBe('900 Main St');
    expect(streetLineOf('', 'CHARLOTTE', 'NC')).toBe('');
  });
});

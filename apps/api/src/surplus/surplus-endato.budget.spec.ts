import axios from 'axios';
import { SurplusEndatoService } from './surplus-endato.service';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

/**
 * The Endato spend cap. Endato ran up $534.78 in four days with nothing in
 * the app counting it; these pin that an unset budget is a pause, that the
 * month's count stops calls at the budget, and that every call is counted.
 */
function service(env: Record<string, string>, calls = 0) {
  let count = calls;
  const prisma: any = {
    vendorUsage: {
      findUnique: jest.fn(async () => (count ? { calls: count } : null)),
      upsert: jest.fn(async () => { count += 1; return { calls: count }; }),
    },
  };
  const config: any = {
    get: (k: string) => ({ ENDATO_AP_NAME: 'ap', ENDATO_AP_PASSWORD: 'pw', ...env } as any)[k],
  };
  return { svc: new SurplusEndatoService(config, prisma), prisma, count: () => count };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockedAxios.post.mockResolvedValue({ data: { persons: [] } } as any);
});

describe('Endato spend cap', () => {
  it('an unset budget pauses Endato: not available, and a direct call is refused unsent', async () => {
    const { svc } = service({});
    expect(svc.available).toBe(false);
    await expect(svc.lookup('G1')).resolves.toBeNull();
    await expect((svc as any).request({})).rejects.toThrow(/paused: out of searches/);
    expect(mockedAxios.post).not.toHaveBeenCalled();
  });

  it('counts every call that goes out', async () => {
    const { svc, prisma, count } = service({ ENDATO_MONTHLY_BUDGET: '100' });
    expect(svc.available).toBe(true);
    await svc.search({ first: 'JULIET', last: 'ABE', city: 'YONKERS', state: 'NY' });
    await svc.lookup('G1');
    expect(mockedAxios.post).toHaveBeenCalledTimes(2);
    expect(prisma.vendorUsage.upsert).toHaveBeenCalledTimes(2);
    expect(count()).toBe(2);
  });

  it('stops at the budget with a message every Endato loop reads as "stop the run"', async () => {
    // 285 calls at $0.35 is $99.75; one more would pass $100.
    const { svc } = service({ ENDATO_MONTHLY_BUDGET: '100' }, 285);
    await expect(svc.search({ first: 'A', last: 'B' })).rejects.toThrow(/budget of \$100 reached \(\$99\.75 spent in \d{4}-\d{2}\): out of searches/);
    expect(mockedAxios.post).not.toHaveBeenCalled();
  });

  it('reports the month against the budget', async () => {
    const { svc } = service({ ENDATO_MONTHLY_BUDGET: '600' }, 1528);
    expect(await svc.usage()).toMatchObject({ calls: 1528, spent: 534.8, budget: 600, paused: false, left: 65.2 });
  });

  it('a failed request is not counted', async () => {
    mockedAxios.post.mockRejectedValue({ response: { status: 500, data: 'boom' } });
    const { svc, count } = service({ ENDATO_MONTHLY_BUDGET: '100' });
    await expect(svc.search({ first: 'A', last: 'B' })).rejects.toThrow(/Endato 500/);
    expect(count()).toBe(0);
  });
});

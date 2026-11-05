import { INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { createHmac } from 'crypto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { SurplusLobWebhookController } from './surplus-lob-webhook.controller';
import { SurplusPrintRunService } from './surplus-print-run.service';

/**
 * The Lob webhook over real HTTP, booted with rawBody the way main.ts boots,
 * behind the app's own guard. The signature is over the bytes Lob sent, so
 * this is the only test that proves the raw body reaches the check.
 */
describe('Lob webhook over HTTP', () => {
  let app: INestApplication;
  let base: string;
  const applyLobEvent = jest.fn(async () => ({ applied: true }));

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ ignoreEnvFile: true, load: [() => ({ JWT_SECRET: 'x', LOB_WEBHOOK_SECRET: 'test-secret, live-secret' })] })],
      controllers: [SurplusLobWebhookController],
      providers: [
        { provide: APP_GUARD, useClass: JwtAuthGuard },
        { provide: SurplusPrintRunService, useValue: { applyLobEvent } },
      ],
    }).compile();
    app = moduleRef.createNestApplication({ logger: false, rawBody: true });
    await app.listen(0);
    base = (await app.getUrl()).replace('[::1]', '127.0.0.1');
  });

  afterAll(async () => {
    await app.close();
  });

  const post = (body: string, secret: string | null, ts = '1730800000000') =>
    fetch(`${base}/webhooks/lob`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Lob-Signature-Timestamp': ts,
        ...(secret ? { 'Lob-Signature': createHmac('sha256', secret).update(`${ts}.${body}`).digest('hex') } : {}),
      },
      body,
    });

  // Lob's own spacing, which a re-serialised body would not match.
  const body = '{"id": "evt_1", "event_type": {"id": "letter.mailed"}, "reference_id": "ltr_1"}';

  it('takes a signed event with no login, with either secret', async () => {
    const res = await post(body, 'live-secret');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ received: true, applied: true });
    expect(applyLobEvent).toHaveBeenCalledWith(expect.objectContaining({ reference_id: 'ltr_1' }));
    expect((await post(body, 'test-secret')).status).toBe(200);
  });

  it('refuses an unsigned or wrongly signed event', async () => {
    applyLobEvent.mockClear();
    expect((await post(body, null)).status).toBe(401);
    expect((await post(body, 'someone-else')).status).toBe(401);
    expect(applyLobEvent).not.toHaveBeenCalled();
  });
});

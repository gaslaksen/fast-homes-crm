import { Controller, Get, INestApplication, Post, Req } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import * as jwt from 'jsonwebtoken';
import { JwtAuthGuard } from './jwt-auth.guard';
import { Public } from './public.decorator';

/**
 * The guard wired the way AppModule wires it, over real HTTP. Catches what a
 * unit test cannot: a provider Nest fails to inject at boot.
 */
@Controller('probe')
class ProbeController {
  @Public()
  @Post('webhook')
  webhook() {
    return { ok: true };
  }

  @Get('private')
  private(@Req() req: any) {
    return { userId: req.user?.userId };
  }
}

describe('JwtAuthGuard over HTTP', () => {
  let app: INestApplication;
  let base: string;
  const token = jwt.sign({ userId: 'u1', organizationId: 'org1' }, 'http-secret', { expiresIn: '1h' });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ ignoreEnvFile: true, load: [() => ({ JWT_SECRET: 'http-secret' })] })],
      controllers: [ProbeController],
      providers: [{ provide: APP_GUARD, useClass: JwtAuthGuard }],
    }).compile();
    app = moduleRef.createNestApplication({ logger: false });
    await app.listen(0);
    base = (await app.getUrl()).replace('[::1]', '127.0.0.1');
  });

  afterAll(async () => {
    await app.close();
  });

  it('serves a public webhook with no token', async () => {
    const res = await fetch(`${base}/probe/webhook`, { method: 'POST' });
    expect(res.status).toBe(201);
  });

  it('answers 401 on a private route with no token', async () => {
    const res = await fetch(`${base}/probe/private`);
    expect(res.status).toBe(401);
  });

  it('serves a private route with a valid header token', async () => {
    const res = await fetch(`${base}/probe/private`, { headers: { Authorization: `Bearer ${token}` } });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ userId: 'u1' });
  });

  it('serves a private GET with ?token=, as the recording player sends it', async () => {
    const res = await fetch(`${base}/probe/private?token=${token}`);
    expect(res.status).toBe(200);
  });
});

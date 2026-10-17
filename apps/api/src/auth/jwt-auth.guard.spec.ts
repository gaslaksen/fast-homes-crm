import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import * as jwt from 'jsonwebtoken';
import { JwtAuthGuard, tokenFromRequest } from './jwt-auth.guard';
import { IS_PUBLIC_KEY, ORG_OPTIONAL_KEY } from './public.decorator';

const SECRET = 'test-secret';

function sign(payload: object, opts: jwt.SignOptions = { expiresIn: '30d' }, secret = SECRET) {
  return jwt.sign(payload, secret, opts);
}

function contextFor(req: any, meta: Record<string, boolean> = {}) {
  const handler = () => undefined;
  class Ctl {}
  for (const [key, value] of Object.entries(meta)) Reflect.defineMetadata(key, value, handler);
  return {
    getHandler: () => handler,
    getClass: () => Ctl,
    switchToHttp: () => ({ getRequest: () => req }),
  } as any;
}

function guard() {
  const config: any = { get: (key: string) => (key === 'JWT_SECRET' ? SECRET : undefined) };
  return new JwtAuthGuard(new Reflector(), config);
}

const member = { userId: 'u1', email: 'geoff@example.com', role: 'ADMIN', organizationId: 'org1' };

describe('JwtAuthGuard', () => {
  it('lets a public route through with no token', () => {
    expect(guard().canActivate(contextFor({ headers: {} }, { [IS_PUBLIC_KEY]: true }))).toBe(true);
  });

  it('rejects a request with no token', () => {
    expect(() => guard().canActivate(contextFor({ headers: {} }))).toThrow(UnauthorizedException);
  });

  it('rejects "Bearer null", which the API used to run with no org filter', () => {
    const req = { headers: { authorization: 'Bearer null' } };
    expect(() => guard().canActivate(contextFor(req))).toThrow(UnauthorizedException);
  });

  it('rejects a token signed with another secret, the hand-made token case', () => {
    const req = { headers: { authorization: `Bearer ${sign(member, {}, 'someone-else')}` } };
    expect(() => guard().canActivate(contextFor(req))).toThrow(UnauthorizedException);
  });

  it('rejects an unsigned token', () => {
    const forged = jwt.sign(member, '', { algorithm: 'none' } as any);
    const req = { headers: { authorization: `Bearer ${forged}` } };
    expect(() => guard().canActivate(contextFor(req))).toThrow(UnauthorizedException);
  });

  it('rejects an expired token', () => {
    const req = { headers: { authorization: `Bearer ${sign(member, { expiresIn: -10 })}` } };
    expect(() => guard().canActivate(contextFor(req))).toThrow(UnauthorizedException);
  });

  it('accepts a valid token and puts the caller on req.user', () => {
    const req: any = { headers: { authorization: `Bearer ${sign(member)}` } };
    expect(guard().canActivate(contextFor(req))).toBe(true);
    expect(req.user).toMatchObject(member);
  });

  it('refuses a token with no organization, except where the route allows it', () => {
    const orgless = { userId: 'u2', email: 'x@example.com', role: 'AGENT', organizationId: null };
    const req = { headers: { authorization: `Bearer ${sign(orgless)}` } };
    expect(() => guard().canActivate(contextFor(req))).toThrow(ForbiddenException);
    expect(guard().canActivate(contextFor({ ...req }, { [ORG_OPTIONAL_KEY]: true }))).toBe(true);
  });
});

describe('tokenFromRequest', () => {
  it('reads the Authorization header', () => {
    expect(tokenFromRequest({ method: 'POST', headers: { authorization: 'Bearer abc' } })).toBe('abc');
  });

  it('reads ?token= on a GET, for the recording player and the curation stream', () => {
    expect(tokenFromRequest({ method: 'GET', headers: {}, query: { token: 'abc' } })).toBe('abc');
  });

  it('ignores ?token= on anything but a GET', () => {
    expect(tokenFromRequest({ method: 'POST', headers: {}, query: { token: 'abc' } })).toBeNull();
  });
});

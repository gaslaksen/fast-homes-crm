import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import * as jwt from 'jsonwebtoken';
import { IS_PUBLIC_KEY, ORG_OPTIONAL_KEY } from './public.decorator';

export interface AuthUser {
  userId: string;
  email?: string;
  role?: string;
  organizationId?: string | null;
}

/**
 * The token a request carries: the Authorization header, or for a GET only,
 * a `token` query parameter. The query form exists because an <audio> element,
 * expo-av and EventSource cannot set headers, and the call recording player
 * and the comp curation stream load that way.
 */
export function tokenFromRequest(req: any): string | null {
  const header = req?.headers?.authorization;
  if (typeof header === 'string' && header.startsWith('Bearer ')) {
    const token = header.slice('Bearer '.length).trim();
    if (token) return token;
  }
  const query = req?.query?.token;
  if (req?.method === 'GET' && typeof query === 'string' && query.trim()) return query.trim();
  return null;
}

/**
 * Every route needs a signed, unexpired token unless it is marked @Public().
 *
 * Before this, most controllers read the caller with jwt.decode, which never
 * checks the signature, and treated a missing token as "no org filter". A
 * request with no token, or a hand-made one, could read and change every lead.
 * Registered globally in AppModule, so a new controller is protected by
 * default and has to opt out on purpose.
 *
 * The verified payload is put on req.user. Controllers that still decode the
 * header themselves now decode a token this guard has already verified.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
    private config: ConfigService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets)) return true;

    const req = context.switchToHttp().getRequest();
    const token = tokenFromRequest(req);
    if (!token) throw new UnauthorizedException('Sign in required');

    let payload: any;
    try {
      payload = jwt.verify(token, this.config.get<string>('JWT_SECRET') || 'dev-secret-key');
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }
    if (!payload || typeof payload !== 'object' || !payload.userId) {
      throw new UnauthorizedException('Invalid token');
    }
    if (!payload.organizationId && !this.reflector.getAllAndOverride<boolean>(ORG_OPTIONAL_KEY, targets)) {
      throw new ForbiddenException('This account is not part of an organization');
    }

    req.user = payload as AuthUser;
    return true;
  }
}

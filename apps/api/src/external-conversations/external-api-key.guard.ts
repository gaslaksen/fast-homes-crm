import { CanActivate, ExecutionContext, Injectable, UnauthorizedException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Bearer-token guard for external-partner endpoints.
 *
 * Reads valid keys from EXTERNAL_API_KEYS (comma-separated "partnerKey:secret"
 * pairs, e.g. "closercontrol:abc123,otherpartner:def456"). The matched
 * partnerKey is stashed on the request so the controller knows which partner
 * is calling.
 *
 * If EXTERNAL_API_KEYS is unset, all requests are rejected. There is no
 * "dev mode bypass" - misconfiguration must fail closed.
 */
@Injectable()
export class ExternalApiKeyGuard implements CanActivate {
  private readonly logger = new Logger(ExternalApiKeyGuard.name);
  private keys: Map<string, string> | null = null;

  constructor(private config: ConfigService) {}

  private loadKeys(): Map<string, string> {
    if (this.keys) return this.keys;
    const raw = this.config.get<string>('EXTERNAL_API_KEYS') || '';
    const map = new Map<string, string>();
    for (const pair of raw.split(',').map((s) => s.trim()).filter(Boolean)) {
      const idx = pair.indexOf(':');
      if (idx < 1) continue;
      const partnerKey = pair.slice(0, idx).trim();
      const secret = pair.slice(idx + 1).trim();
      if (partnerKey && secret) map.set(secret, partnerKey);
    }
    this.keys = map;
    if (map.size === 0) {
      this.logger.warn('EXTERNAL_API_KEYS not configured - all external-partner requests will be rejected');
    }
    return map;
  }

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();
    const header = (req.headers['authorization'] || req.headers['Authorization'] || '') as string;
    const token = header.startsWith('Bearer ') ? header.slice('Bearer '.length).trim() : '';
    if (!token) throw new UnauthorizedException('Missing Bearer token');

    const keys = this.loadKeys();
    const partnerKey = keys.get(token);
    if (!partnerKey) throw new UnauthorizedException('Invalid API key');

    req.partnerKey = partnerKey;
    return true;
  }
}

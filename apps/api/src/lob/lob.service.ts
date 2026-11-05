import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LobAddress, LobMode, lobModeOf } from './lob.util';

const LOB_API = 'https://api.lob.com/v1';
const TIMEOUT_MS = 30_000;

export interface LobLetterRequest {
  to: LobAddress;
  from: LobAddress;
  html: string;
  description?: string;
  metadata?: Record<string, string>;
  idempotencyKey: string;
}

export interface LobLetter {
  id: string;
  url: string | null;
  expectedDeliveryDate: string | null;
  sendDate: string | null;
}

export class LobError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string | null,
  ) {
    super(message);
  }
}

/**
 * Lob's letters API. Dormant until LOB_API_KEY is set: every caller asks
 * configured() first, and a publishable key reads as not configured because
 * it cannot create letters.
 *
 * A test_ key renders a proof PDF and mails nothing. A live_ key mails.
 * Black and white, First Class, address printed on the first page.
 */
@Injectable()
export class LobService {
  private readonly logger = new Logger(LobService.name);

  constructor(private config: ConfigService) {}

  private key(): string {
    return String(this.config.get<string>('LOB_API_KEY') || '').trim();
  }

  mode(): LobMode | null {
    return lobModeOf(this.key());
  }

  configured(): boolean {
    return this.mode() !== null;
  }

  /** Letters Lob may take in a calendar month. The Developer edition stops at 500. */
  monthlyLimit(): number {
    const n = Number(this.config.get<string>('LOB_MONTHLY_LIMIT'));
    return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 500;
  }

  /** Dollars per letter, printing and First Class postage, logged on the claim. */
  letterCost(): number {
    const raw = this.config.get<string>('LOB_LETTER_COST');
    const n = Number(raw);
    return raw !== undefined && String(raw).trim() !== '' && Number.isFinite(n) && n >= 0 ? n : 1.07;
  }

  /** 'marketing' unless set: these letters offer a service to someone who did not ask. */
  useType(): 'marketing' | 'operational' {
    return String(this.config.get<string>('LOB_USE_TYPE') || '').trim() === 'operational' ? 'operational' : 'marketing';
  }

  async createLetter(req: LobLetterRequest): Promise<LobLetter> {
    const key = this.key();
    if (!this.configured()) throw new LobError('Lob is not set up: LOB_API_KEY is missing or is not a secret key.', 0, null);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(`${LOB_API}/letters`, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${Buffer.from(`${key}:`).toString('base64')}`,
          'Content-Type': 'application/json',
          'Idempotency-Key': req.idempotencyKey.slice(0, 256),
        },
        body: JSON.stringify({
          description: req.description,
          to: req.to,
          from: req.from,
          file: req.html,
          color: false,
          double_sided: true,
          address_placement: 'top_first_page',
          mail_type: 'usps_first_class',
          use_type: this.useType(),
          ...(req.metadata ? { metadata: req.metadata } : {}),
        }),
        signal: ctrl.signal,
      });
      const json: any = await res.json().catch(() => null);
      if (!res.ok) {
        const err = json?.error || {};
        throw new LobError(String(err.message || `Lob answered ${res.status}`), res.status, err.code ? String(err.code) : null);
      }
      return {
        id: String(json.id),
        url: json.url || null,
        expectedDeliveryDate: json.expected_delivery_date || null,
        sendDate: json.send_date || null,
      };
    } catch (err: any) {
      if (err instanceof LobError) throw err;
      const msg = err?.name === 'AbortError' ? 'Lob did not answer in time' : err?.message || String(err);
      this.logger.warn(`Lob letter create failed: ${msg}`);
      throw new LobError(msg, 0, null);
    } finally {
      clearTimeout(timer);
    }
  }
}

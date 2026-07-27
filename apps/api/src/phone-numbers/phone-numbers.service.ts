import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';

export interface SendingNumber {
  id: string;
  number: string;
  label: string;
  smsEnabled: boolean;
  voiceEnabled: boolean;
  isDefault: boolean;
  active: boolean;
  sortOrder: number;
}

/** Last 10 digits, so +17045299523 / 7045299523 / (704) 529-9523 all match. */
export function numberKey(raw: string): string {
  return (raw || '').replace(/\D/g, '').slice(-10);
}

/** "(704) 529-9523" from any 10 or 11 digit form. */
export function prettyNumber(raw: string): string {
  const digits = (raw || '').replace(/\D/g, '');
  const ten = digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
  if (ten.length !== 10) return raw;
  return `(${ten.slice(0, 3)}) ${ten.slice(3, 6)}-${ten.slice(6)}`;
}

/** Normalize user input to E.164. Only US/CA 10 and 11 digit forms are accepted. */
export function toE164(raw: string): string | null {
  const digits = (raw || '').replace(/\D/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  if (raw?.startsWith('+') && digits.length >= 8) return `+${digits}`;
  return null;
}

/**
 * The org's sending numbers, and the rules for picking one.
 *
 * Both the dialer's caller ID and the SMS "From" resolve through here so there
 * is one list and one set of rules. The central invariant: a number supplied by
 * a client is never used directly, only matched against this list. Anything the
 * browser sends becomes the caller ID / sender on a real carrier, so an
 * unchecked value would let the client send as any number on the account.
 */
@Injectable()
export class PhoneNumbersService {
  private readonly logger = new Logger(PhoneNumbersService.name);

  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
  ) {}

  /**
   * Never throws. A missing table or an unreachable database returns an empty
   * list, which makes every caller fall back to TWILIO_PHONE_NUMBER, i.e. the
   * single-number behaviour that existed before this table. Calling and texting
   * must not stop working because a lookup failed.
   */
  async list(opts?: { channel?: 'sms' | 'voice'; includeInactive?: boolean }): Promise<SendingNumber[]> {
    let rows: any[];
    try {
      rows = await this.prisma.phoneNumber.findMany({
        where: {
          ...(opts?.includeInactive ? {} : { active: true }),
          ...(opts?.channel === 'sms' ? { smsEnabled: true } : {}),
          ...(opts?.channel === 'voice' ? { voiceEnabled: true } : {}),
        },
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      });
    } catch (err: any) {
      this.logger.error(`Phone number lookup failed, falling back to env: ${err.message}`);
      return [];
    }
    return rows.map((r) => ({
      id: r.id,
      number: r.number,
      label: r.label,
      smsEnabled: r.smsEnabled,
      voiceEnabled: r.voiceEnabled,
      isDefault: r.isDefault,
      active: r.active,
      sortOrder: r.sortOrder,
    }));
  }

  /**
   * Fallback number for a channel: the one flagged default, else the first
   * listed, else TWILIO_PHONE_NUMBER so a misconfigured table cannot take
   * sending down entirely.
   */
  async defaultFor(channel: 'sms' | 'voice'): Promise<string> {
    const list = await this.list({ channel });
    return (
      list.find((n) => n.isDefault)?.number ||
      list[0]?.number ||
      this.config.get<string>('TWILIO_PHONE_NUMBER') ||
      ''
    );
  }

  /**
   * Match a requested number against the allowlist for a channel. Returns the
   * stored spelling on a hit, and the channel default on a miss. Never throws:
   * a bad request should still place the call or send the text, just from a
   * number we actually own.
   */
  async resolve(requested: string | undefined, channel: 'sms' | 'voice'): Promise<string> {
    const fallback = await this.defaultFor(channel);
    if (!requested) return fallback;

    const list = await this.list({ channel });
    const match = list.find((n) => numberKey(n.number) === numberKey(requested));
    if (!match) {
      this.logger.warn(
        `Rejected ${channel} from-number ${requested} (not an active ${channel} number), using ${fallback}`,
      );
      return fallback;
    }
    return match.number;
  }

  /**
   * Which number to text a given lead from.
   *
   * Threads are sticky: a seller who has been texting (888) keeps seeing (888),
   * because switching mid-conversation splits the thread on their phone and
   * reads like a different company. Order of preference:
   *   1. an explicit choice from the composer, if allowlisted
   *   2. the number we last texted this lead from
   *   3. the number this lead last texted us on (seller-initiated threads)
   *   4. the default sending number
   */
  async resolveForLead(leadId: string, requested?: string): Promise<string> {
    if (requested) return this.resolve(requested, 'sms');

    const sticky = await this.stickyNumberFor(leadId);
    if (sticky) return sticky;

    return this.defaultFor('sms');
  }

  /**
   * The number already associated with this lead's thread, if any, and only if
   * it is still an active SMS number. Returns null for a brand-new lead.
   */
  async stickyNumberFor(leadId: string): Promise<string | null> {
    const [lastOutbound, lastInbound] = await Promise.all([
      this.prisma.message.findFirst({
        where: { leadId, direction: 'OUTBOUND' },
        orderBy: { createdAt: 'desc' },
        select: { from: true },
      }),
      this.prisma.message.findFirst({
        where: { leadId, direction: 'INBOUND' },
        orderBy: { createdAt: 'desc' },
        select: { to: true },
      }),
    ]).catch(() => [null, null] as const);

    const candidate = lastOutbound?.from || lastInbound?.to;
    if (!candidate) return null;

    // A number that has since been deactivated must not keep being used.
    const list = await this.list({ channel: 'sms' });
    const match = list.find((n) => numberKey(n.number) === numberKey(candidate));
    return match?.number ?? null;
  }

  // ── CRUD, backing Settings > Phone Numbers ───────────────────────────────

  async create(input: {
    number: string;
    label?: string;
    smsEnabled?: boolean;
    voiceEnabled?: boolean;
    isDefault?: boolean;
  }): Promise<SendingNumber> {
    const e164 = toE164(input.number);
    if (!e164) throw new BadRequestException('Enter a valid US phone number');

    const existing = await this.prisma.phoneNumber.findUnique({ where: { number: e164 } });
    if (existing) throw new BadRequestException('That number is already in the list');

    const count = await this.prisma.phoneNumber.count();
    const row = await this.prisma.phoneNumber.create({
      data: {
        number: e164,
        label: (input.label || '').trim() || prettyNumber(e164),
        smsEnabled: input.smsEnabled ?? true,
        voiceEnabled: input.voiceEnabled ?? true,
        // First number added is the default by definition, otherwise honour the flag.
        isDefault: count === 0 ? true : !!input.isDefault,
        sortOrder: count,
      },
    });
    if (row.isDefault) await this.clearOtherDefaults(row.id);
    return (await this.list({ includeInactive: true })).find((n) => n.id === row.id)!;
  }

  async update(
    id: string,
    patch: Partial<{
      label: string;
      smsEnabled: boolean;
      voiceEnabled: boolean;
      isDefault: boolean;
      active: boolean;
      sortOrder: number;
    }>,
  ): Promise<SendingNumber> {
    const existing = await this.prisma.phoneNumber.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Number not found');

    const data: Record<string, any> = {};
    if (patch.label !== undefined) data.label = String(patch.label).trim().slice(0, 60) || existing.label;
    if (patch.smsEnabled !== undefined) data.smsEnabled = !!patch.smsEnabled;
    if (patch.voiceEnabled !== undefined) data.voiceEnabled = !!patch.voiceEnabled;
    if (patch.active !== undefined) data.active = !!patch.active;
    if (patch.sortOrder !== undefined) data.sortOrder = Number(patch.sortOrder) || 0;
    if (patch.isDefault !== undefined) data.isDefault = !!patch.isDefault;

    // Deactivating or un-defaulting the default would leave nothing to fall
    // back to, so refuse rather than silently sending from an arbitrary number.
    const losingDefault =
      existing.isDefault && (data.isDefault === false || data.active === false);
    if (losingDefault) {
      throw new BadRequestException(
        'Make another number the default first, then change this one',
      );
    }

    await this.prisma.phoneNumber.update({ where: { id }, data });
    if (data.isDefault) await this.clearOtherDefaults(id);
    return (await this.list({ includeInactive: true })).find((n) => n.id === id)!;
  }

  async remove(id: string): Promise<{ ok: true }> {
    const existing = await this.prisma.phoneNumber.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Number not found');
    if (existing.isDefault) {
      throw new BadRequestException('Make another number the default before removing this one');
    }
    await this.prisma.phoneNumber.delete({ where: { id } });
    return { ok: true };
  }

  private async clearOtherDefaults(keepId: string) {
    await this.prisma.phoneNumber.updateMany({
      where: { id: { not: keepId }, isDefault: true },
      data: { isDefault: false },
    });
  }
}

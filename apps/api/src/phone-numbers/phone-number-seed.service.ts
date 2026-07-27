import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { prettyNumber, toE164 } from './phone-numbers.service';

/**
 * Bootstraps the phone_numbers table from the env vars the dialer used before
 * numbers were managed in Settings.
 *
 * Only runs when the table is empty, so it is a one-time migration of config
 * into data. After that, Settings is the source of truth and editing
 * TWILIO_CALLER_IDS has no effect. That is deliberate: the alternative, syncing
 * from env on every boot, would silently undo any change made in the UI.
 */
@Injectable()
export class PhoneNumberSeedService implements OnModuleInit {
  private readonly logger = new Logger(PhoneNumberSeedService.name);

  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
  ) {}

  async onModuleInit() {
    try {
      const existing = await this.prisma.phoneNumber.count();
      if (existing > 0) return;

      const entries = this.parseEnv();
      if (entries.length === 0) {
        this.logger.warn(
          'No phone numbers configured. Add one in Settings > Phone Numbers, or set TWILIO_PHONE_NUMBER and restart.',
        );
        return;
      }

      await this.prisma.phoneNumber.createMany({
        data: entries.map((e, i) => ({
          number: e.number,
          label: e.label,
          smsEnabled: true,
          voiceEnabled: true,
          isDefault: i === 0,
          sortOrder: i,
        })),
        skipDuplicates: true,
      });

      this.logger.log(
        `🌱 Seeded ${entries.length} phone number(s) from env: ${entries.map((e) => e.number).join(', ')}`,
      );
    } catch (err: any) {
      // A failure here must not stop the API booting; Settings still works.
      this.logger.error(`Phone number seed failed: ${err.message}`);
    }
  }

  /** TWILIO_CALLER_IDS, else TWILIO_PHONE_NUMBER. */
  private parseEnv(): { number: string; label: string }[] {
    const raw = this.config.get<string>('TWILIO_CALLER_IDS') || '';
    const parsed = raw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .map((entry) => {
        const idx = entry.lastIndexOf(':');
        return idx > 0
          ? { label: entry.slice(0, idx).trim(), number: entry.slice(idx + 1).trim() }
          : { label: '', number: entry };
      });

    const source = parsed.length > 0
      ? parsed
      : [{ label: 'Main', number: this.config.get<string>('TWILIO_PHONE_NUMBER') || '' }];

    const seen = new Set<string>();
    const out: { number: string; label: string }[] = [];
    for (const e of source) {
      const e164 = toE164(e.number);
      if (!e164 || seen.has(e164)) continue;
      seen.add(e164);
      out.push({ number: e164, label: e.label || prettyNumber(e164) });
    }
    return out;
  }
}

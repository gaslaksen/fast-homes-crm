import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

const SINGLETON_ID = 'default';

export interface ComplianceSettings {
  optOutEnabled: boolean;
  optOutText: string;
  senderIdEnabled: boolean;
  senderIdText: string;
  periodicEnabled: boolean;
  periodicDays: number;
}

/**
 * Settings > Messaging Compliance.
 *
 * The previous SMS provider prepended the sender name and appended opt-out
 * language to every outbound message. Twilio does neither, so we assemble the
 * footer ourselves and attach it to the first message we send a lead (and, if
 * periodic re-send is on, every `periodicDays` after that).
 *
 * Keeping this out of the AI prompt is deliberate: the model was inconsistent
 * about including it, and compliance text should not be something the model can
 * paraphrase away.
 */
@Injectable()
export class ComplianceService {
  private readonly logger = new Logger(ComplianceService.name);

  constructor(private prisma: PrismaService) {}

  async get(): Promise<ComplianceSettings> {
    const row = await this.prisma.messagingCompliance.upsert({
      where: { id: SINGLETON_ID },
      update: {},
      create: { id: SINGLETON_ID },
    });
    return {
      optOutEnabled: row.optOutEnabled,
      optOutText: row.optOutText,
      senderIdEnabled: row.senderIdEnabled,
      senderIdText: row.senderIdText,
      periodicEnabled: row.periodicEnabled,
      periodicDays: row.periodicDays,
    };
  }

  async update(patch: Partial<ComplianceSettings>): Promise<ComplianceSettings> {
    const data: Record<string, any> = {};
    if (patch.optOutEnabled !== undefined) data.optOutEnabled = !!patch.optOutEnabled;
    if (patch.senderIdEnabled !== undefined) data.senderIdEnabled = !!patch.senderIdEnabled;
    if (patch.periodicEnabled !== undefined) data.periodicEnabled = !!patch.periodicEnabled;
    if (patch.optOutText !== undefined) data.optOutText = String(patch.optOutText).trim().slice(0, 160);
    if (patch.senderIdText !== undefined) data.senderIdText = String(patch.senderIdText).trim().slice(0, 160);
    if (patch.periodicDays !== undefined) {
      const n = Number(patch.periodicDays);
      // 1 to 365 days. Anything outside that is a typo, not an intent.
      data.periodicDays = Number.isFinite(n) ? Math.min(365, Math.max(1, Math.round(n))) : 30;
    }

    await this.prisma.messagingCompliance.upsert({
      where: { id: SINGLETON_ID },
      update: data,
      create: { id: SINGLETON_ID, ...data },
    });
    return this.get();
  }

  /**
   * The footer as it would appear, or '' when both parts are disabled.
   * Sender ID first, then opt-out, each on its own line.
   */
  buildFooter(settings: ComplianceSettings): string {
    const parts: string[] = [];
    if (settings.senderIdEnabled && settings.senderIdText) parts.push(settings.senderIdText);
    if (settings.optOutEnabled && settings.optOutText) parts.push(settings.optOutText);
    return parts.join('\n');
  }

  /**
   * Decide whether this outbound message to `leadId` should carry the footer.
   *
   * First message to a lead: always. After that, only when periodic re-send is
   * enabled and the interval has elapsed.
   */
  async shouldAttachFooter(
    settings: ComplianceSettings,
    lastSentAt: Date | null | undefined,
  ): Promise<boolean> {
    if (!this.buildFooter(settings)) return false;
    if (!lastSentAt) return true;
    if (!settings.periodicEnabled) return false;

    const elapsedDays = (Date.now() - lastSentAt.getTime()) / 86_400_000;
    return elapsedDays >= settings.periodicDays;
  }

  /**
   * Append the footer to a message body, separated by a blank line. Returns the
   * body unchanged when there is nothing left to append.
   *
   * Lines the AI already wrote are dropped rather than duplicated. This is
   * checked per line, not all-or-nothing: the model routinely signs off with
   * the company name on its own, and appending it a second time reads badly.
   */
  applyFooter(body: string, footer: string): string {
    if (!footer) return body;

    const normalized = body.toLowerCase();
    const missing = footer
      .split('\n')
      .filter((line) => line && !normalized.includes(line.toLowerCase()));

    if (missing.length === 0) return body;
    return `${body.trimEnd()}\n\n${missing.join('\n')}`;
  }
}

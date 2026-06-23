import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { RegisterDeviceDto } from './dto/register-device.dto';

export interface PushPayload {
  title: string;
  body: string;
  /** Custom keys delivered to the app for deep-linking (e.g. { leadId, type }). */
  data?: Record<string, any>;
  badge?: number;
  /** APNs thread-id: groups related notifications (e.g. one lead's messages). */
  threadId?: string;
}

/**
 * Mobile push notifications over APNs.
 *
 * Multi-tenant: every device is stored with the owner's organizationId, and lead
 * events fan out only to recipients within the lead's tenant (assigned user if set,
 * otherwise every user in that organization). This keeps one tenant's notifications
 * from ever reaching another.
 *
 * Entirely dormant until APNs credentials are configured (APNS_AUTH_KEY_P8 /
 * APNS_KEY_ID / APNS_TEAM_ID / APNS_BUNDLE_ID), mirroring the Twilio Voice service.
 * Sends are best-effort and never throw to callers.
 */
@Injectable()
export class PushService {
  private readonly logger = new Logger(PushService.name);
  // Lazily-loaded @parse/node-apn module + provider so the dep stays optional.
  private apn: any;
  private provider: any;

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  isConfigured(): boolean {
    return !!(
      this.config.get<string>('APNS_AUTH_KEY_P8') &&
      this.config.get<string>('APNS_KEY_ID') &&
      this.config.get<string>('APNS_TEAM_ID') &&
      this.config.get<string>('APNS_BUNDLE_ID')
    );
  }

  // ─── Device registration ──────────────────────────────────────────────────

  async registerDevice(
    userId: string,
    organizationId: string | null | undefined,
    dto: RegisterDeviceDto,
  ) {
    const platform = dto.platform || 'ios';
    const { apnsToken, voipToken, appVersion, deviceName } = dto;
    if (!apnsToken && !voipToken) {
      throw new BadRequestException('apnsToken or voipToken is required');
    }

    // Keyed on (userId, apnsToken) when we have an alert token; that is the
    // stable per-device identity. A device usually registers both tokens at once.
    if (apnsToken) {
      return this.prisma.pushDevice.upsert({
        where: { userId_apnsToken: { userId, apnsToken } },
        create: {
          userId,
          organizationId: organizationId ?? null,
          platform,
          apnsToken,
          voipToken: voipToken ?? null,
          appVersion,
          deviceName,
        },
        update: {
          organizationId: organizationId ?? null,
          ...(voipToken ? { voipToken } : {}),
          appVersion,
          deviceName,
          lastSeenAt: new Date(),
        },
      });
    }

    // VoIP-only registration (e.g. the call SDK reports its token before the
    // alert token is available). Match an existing row by voipToken.
    const existing = await this.prisma.pushDevice.findFirst({
      where: { userId, voipToken },
    });
    if (existing) {
      return this.prisma.pushDevice.update({
        where: { id: existing.id },
        data: { organizationId: organizationId ?? null, lastSeenAt: new Date() },
      });
    }
    return this.prisma.pushDevice.create({
      data: {
        userId,
        organizationId: organizationId ?? null,
        platform,
        voipToken,
        appVersion,
        deviceName,
      },
    });
  }

  /** Unregister on logout. Matches either token so the client can pass whichever it holds. */
  async removeDevice(userId: string, token: string) {
    const result = await this.prisma.pushDevice.deleteMany({
      where: { userId, OR: [{ apnsToken: token }, { voipToken: token }] },
    });
    return { removed: result.count };
  }

  // ─── Tenant-aware recipient resolution ────────────────────────────────────

  /**
   * Who should hear about a lead event. If the lead is assigned, just that user;
   * otherwise everyone in the lead's organization. Strictly tenant-scoped: a lead
   * with organizationId X never notifies users outside X. Legacy leads with no org
   * fall back to the no-org user bucket.
   */
  async resolveLeadRecipients(lead: {
    organizationId?: string | null;
    assignedToUserId?: string | null;
  }): Promise<string[]> {
    if (lead.assignedToUserId) return [lead.assignedToUserId];
    const users = await this.prisma.user.findMany({
      where: { organizationId: lead.organizationId ?? null },
      select: { id: true },
      take: 100,
    });
    return users.map((u) => u.id);
  }

  /** How many registered (APNs-capable) devices a user has. For diagnostics. */
  async countDevices(userId: string): Promise<number> {
    return this.prisma.pushDevice.count({
      where: { userId, apnsToken: { not: null } },
    });
  }

  // ─── Sending ──────────────────────────────────────────────────────────────

  /** Low-level fan-out to a set of users' registered devices. Best-effort. */
  async notifyUsers(userIds: string[], payload: PushPayload): Promise<void> {
    if (!userIds.length) return;
    const provider = await this.getProvider();
    if (!provider) {
      this.logger.warn(
        `Push skipped: APNs not configured (set APNS_AUTH_KEY_P8/KEY_ID/TEAM_ID/BUNDLE_ID) — "${payload.title}" for ${userIds.length} user(s)`,
      );
      return;
    }

    const devices = await this.prisma.pushDevice.findMany({
      where: { userId: { in: userIds }, apnsToken: { not: null } },
      select: { apnsToken: true },
    });
    const tokens = [...new Set(devices.map((d) => d.apnsToken).filter(Boolean) as string[])];
    if (!tokens.length) {
      this.logger.warn(
        `Push skipped: no registered device tokens for user(s) ${userIds.join(', ')}`,
      );
      return;
    }

    try {
      const note = new this.apn.Notification();
      note.topic = this.config.get<string>('APNS_BUNDLE_ID');
      note.alert = { title: payload.title, body: payload.body };
      note.sound = 'default';
      note.pushType = 'alert';
      note.payload = payload.data || {};
      if (payload.badge != null) note.badge = payload.badge;
      if (payload.threadId) note.threadId = payload.threadId;

      const result = await provider.send(note, tokens);
      if (result.failed?.length) {
        await this.pruneDeadTokens(result.failed);
        this.logger.warn(
          `APNs: ${result.sent?.length || 0} sent, ${result.failed.length} failed for "${payload.title}"`,
        );
      } else {
        this.logger.log(`APNs: sent "${payload.title}" to ${tokens.length} device(s)`);
      }
    } catch (err: any) {
      this.logger.error(`APNs send failed: ${err.message}`);
    }
  }

  /** New-lead alert. Resolved recipients are tenant-scoped to the lead's org. */
  async notifyNewLead(lead: {
    id: string;
    organizationId?: string | null;
    assignedToUserId?: string | null;
    propertyAddress?: string;
    sellerFirstName?: string;
    sellerLastName?: string;
    source?: string;
  }): Promise<void> {
    try {
      const recipients = await this.resolveLeadRecipients(lead);
      if (!recipients.length) return;
      const who = `${lead.sellerFirstName || ''} ${lead.sellerLastName || ''}`.trim();
      const body = [who, lead.propertyAddress].filter(Boolean).join(' — ') || 'Tap to view';
      await this.notifyUsers(recipients, {
        title: 'New lead',
        body,
        data: { type: 'lead', leadId: lead.id },
      });
    } catch (err: any) {
      this.logger.error(`notifyNewLead failed for ${lead.id}: ${err.message}`);
    }
  }

  /** New inbound-message alert, scoped to the lead's tenant. */
  async notifyNewMessage(
    lead: {
      id: string;
      organizationId?: string | null;
      assignedToUserId?: string | null;
      sellerFirstName?: string;
      sellerLastName?: string;
    },
    preview: string,
  ): Promise<void> {
    try {
      const recipients = await this.resolveLeadRecipients(lead);
      if (!recipients.length) return;
      const who =
        `${lead.sellerFirstName || ''} ${lead.sellerLastName || ''}`.trim() || 'New message';
      await this.notifyUsers(recipients, {
        title: who,
        body: preview.length > 140 ? `${preview.slice(0, 139)}…` : preview,
        data: { type: 'message', leadId: lead.id },
        threadId: lead.id,
      });
    } catch (err: any) {
      this.logger.error(`notifyNewMessage failed for ${lead.id}: ${err.message}`);
    }
  }

  // ─── Internals ────────────────────────────────────────────────────────────

  private async getProvider(): Promise<any | null> {
    if (!this.isConfigured()) return null;
    if (this.provider) return this.provider;
    try {
      // Optional dependency — loaded lazily so the API builds/runs without it.
      this.apn = await import('@parse/node-apn');
      const keyB64 = this.config.get<string>('APNS_AUTH_KEY_P8') || '';
      const key = Buffer.from(keyB64, 'base64').toString('utf8');
      this.provider = new this.apn.Provider({
        token: {
          key,
          keyId: this.config.get<string>('APNS_KEY_ID'),
          teamId: this.config.get<string>('APNS_TEAM_ID'),
        },
        production:
          (this.config.get<string>('APNS_PRODUCTION') || 'false').toLowerCase() === 'true',
      });
      this.logger.log('APNs provider initialized');
      return this.provider;
    } catch (err: any) {
      this.logger.error(
        `Could not initialize APNs provider (is @parse/node-apn installed?): ${err.message}`,
      );
      return null;
    }
  }

  /** Drop tokens APNs reports as gone so we stop sending to dead devices. */
  private async pruneDeadTokens(failed: any[]): Promise<void> {
    // BadDeviceToken usually signals an environment mismatch (APNS_PRODUCTION vs
    // the token's sandbox/production origin), not a truly dead device — log it
    // rather than deleting a token that becomes valid once the env is corrected.
    const mismatched = failed.filter((f) => f.response?.reason === 'BadDeviceToken');
    if (mismatched.length) {
      this.logger.warn(
        `APNs BadDeviceToken x${mismatched.length} — likely APNS_PRODUCTION mismatch (sandbox vs production); not pruning`,
      );
    }
    // Only 410 / Unregistered means the app was uninstalled — safe to delete.
    const dead = failed
      .filter((f) => f.status === '410' || f.response?.reason === 'Unregistered')
      .map((f) => f.device)
      .filter(Boolean);
    if (!dead.length) return;
    try {
      await this.prisma.pushDevice.deleteMany({ where: { apnsToken: { in: dead } } });
      this.logger.log(`Pruned ${dead.length} dead device token(s)`);
    } catch (err: any) {
      this.logger.warn(`Failed to prune dead tokens: ${err.message}`);
    }
  }
}

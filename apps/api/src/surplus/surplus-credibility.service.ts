/**
 * The Instant Credibility packet: what a claimant is sent, while still on
 * the phone, so they can check the company for themselves.
 *
 * The course's Big Four (who are you, are you real, what does it cost, can I
 * trust you) are answered by things a person can verify on their own screen:
 * the website, the state's own filing record on Sunbiz, a one-page overview,
 * and a number they can ring back. This sends those as one action, as Dig
 * Deeper, and records what went out so the next call does not repeat it.
 *
 * A packet with a blank where a link should be is worse than no packet, so
 * the send refuses until every link is configured and every merge field in
 * the template is filled.
 */

import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { MessagesService } from '../messages/messages.service';
import { SurplusTemplatesService } from './surplus-templates.service';
import { LeadSource } from '@fast-homes/shared';

export type CredibilityChannel = 'sms' | 'email';

@Injectable()
export class SurplusCredibilityService {
  private readonly logger = new Logger(SurplusCredibilityService.name);

  constructor(
    private prisma: PrismaService,
    private messages: MessagesService,
    private templates: SurplusTemplatesService,
  ) {}

  /**
   * Send the packet by the chosen channels. Each channel is attempted on its
   * own, so a bounced email does not stop the text, and the result says
   * exactly which went.
   */
  async send(
    leadId: string,
    input: { channels: CredibilityChannel[]; phone?: string | null; email?: string | null },
    organizationId?: string | null,
    userId?: string | null,
  ) {
    const channels = (input.channels || []).filter((c): c is CredibilityChannel => c === 'sms' || c === 'email');
    if (!channels.length) throw new BadRequestException('Pick text, email, or both.');
    if (!userId) throw new BadRequestException('Not authenticated');

    const lead = await this.prisma.lead.findFirst({
      where: {
        id: leadId,
        source: LeadSource.SURPLUS,
        ...(organizationId ? { organizationId } : {}),
      },
      select: {
        id: true,
        sellerPhone: true,
        sellerEmail: true,
        doNotContact: true,
        sellerFirstName: true,
        sellerLastName: true,
        surplusDetail: { select: { id: true, doNotCall: true, credibilityChannels: true } },
      },
    });
    if (!lead?.surplusDetail) throw new BadRequestException('Surplus lead not found');
    if (lead.doNotContact || lead.surplusDetail.doNotCall) {
      throw new BadRequestException('This claimant is marked do not contact.');
    }

    const packet = await this.templates.credibilityFor(leadId, organizationId, userId);
    if (!packet.ready) {
      throw new BadRequestException(
        `The credibility packet is not set up yet. Missing: ${packet.missing.join(', ')}.`,
      );
    }

    const sent: CredibilityChannel[] = [];
    const errors: string[] = [];

    if (channels.includes('sms')) {
      const to = (input.phone || lead.sellerPhone || '').trim();
      if (!to) errors.push('No phone number to text.');
      else if (packet.sms.unfilled.length) errors.push(`Text template still has ${packet.sms.unfilled.join(', ')} unfilled.`);
      else {
        try {
          await this.messages.sendMessage(leadId, packet.sms.body, userId, undefined, to);
          sent.push('sms');
        } catch (err: any) {
          errors.push(`Text failed: ${err?.message || 'unknown error'}`);
        }
      }
    }

    if (channels.includes('email')) {
      const to = (input.email || lead.sellerEmail || '').trim();
      if (!to) errors.push('No email address on file.');
      else if (packet.email.unfilled.length) errors.push(`Email template still has ${packet.email.unfilled.join(', ')} unfilled.`);
      else {
        try {
          await this.messages.sendEmailReply(leadId, userId, {
            subject: packet.email.subject,
            body: packet.email.body,
            to,
          });
          sent.push('email');
        } catch (err: any) {
          errors.push(`Email failed: ${err?.message || 'unknown error'}`);
        }
      }
    }

    if (sent.length) {
      const before = String(lead.surplusDetail.credibilityChannels || '')
        .split(',')
        .filter(Boolean);
      const all = Array.from(new Set([...before, ...sent]));
      await this.prisma.surplusDetail.update({
        where: { id: lead.surplusDetail.id },
        data: { credibilitySentAt: new Date(), credibilityChannels: all.join(',') },
      });
      const name = `${lead.sellerFirstName || ''} ${lead.sellerLastName || ''}`.trim() || 'the claimant';
      await this.prisma.activity.create({
        data: {
          leadId,
          userId,
          type: 'CREDIBILITY_SENT',
          description: `Credibility packet sent to ${name} by ${sent.map((c) => (c === 'sms' ? 'text' : 'email')).join(' and ')}: ${packet.items.join(', ')}`,
          metadata: {
            channels: sent,
            items: packet.items,
            smsVersion: packet.sms.versionLabel,
            emailVersion: packet.email.versionLabel,
          },
        },
      });
    }

    if (!sent.length) {
      throw new BadRequestException(errors.join(' ') || 'Nothing was sent.');
    }
    return { sent, errors };
  }
}

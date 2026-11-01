/**
 * The Instant Credibility packet: what a person is sent, while still on the
 * phone, so they can check the company for themselves.
 *
 * The course's Big Four (who are you, are you real, what does it cost, can I
 * trust you) are answered by things a person can verify on their own screen:
 * the website, the state's own filing record on Sunbiz, a one-page overview,
 * and a number they can ring back. This sends those as one action, as Dig
 * Deeper, and records what went out so the next call does not repeat it.
 *
 * It goes to whoever is on the line. The claimant by default; a relative,
 * neighbor or associate on the case when they are named, or when the number
 * being texted is theirs. The packet names no amount and no source, so it
 * is the one thing on a case that anyone may receive.
 *
 * A packet with a blank where a link should be is worse than no packet, so
 * the send refuses until every link is configured and every merge field in
 * the template is filled.
 */

import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { MessagesService } from '../messages/messages.service';
import { SurplusTemplatesService } from './surplus-templates.service';
import { LeadSource, SurplusContactStatus } from '@fast-homes/shared';

export type CredibilityChannel = 'sms' | 'email';

export interface CredibilitySendInput {
  channels: CredibilityChannel[];
  phone?: string | null;
  email?: string | null;
  /** The person on the case to address. Null or absent is the claimant, unless the number says otherwise. */
  heirId?: string | null;
}

/** The last ten digits, so "(610) 812-1266" and "+16108121266" are one number. */
function tenDigits(value: string | null | undefined): string {
  const digits = String(value || '').replace(/\D/g, '');
  return digits.length > 10 ? digits.slice(-10) : digits;
}

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
    input: CredibilitySendInput,
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

    // Who it goes to. Named outright, or found from the number: the dialer
    // only knows the number it rang, and a number on a son's row means the
    // son is the one asking who we are.
    const heirId = input.heirId || (await this.heirIdForNumber(lead.surplusDetail.id, input.phone));
    const heir = heirId
      ? await this.prisma.surplusHeir.findFirst({
          where: { id: heirId, surplusDetailId: lead.surplusDetail.id },
          select: {
            id: true,
            name: true,
            role: true,
            relationship: true,
            deceased: true,
            doNotCall: true,
            contactStatus: true,
            phone1: true,
            phone2: true,
            phone3: true,
            phone4: true,
            phone1Dnc: true,
            phone2Dnc: true,
            phone3Dnc: true,
            phone4Dnc: true,
            email1: true,
          },
        })
      : null;
    if (heirId && !heir) throw new BadRequestException('That person is not on this claim.');

    if (heir) {
      if (heir.deceased) throw new BadRequestException(`${heir.name} is marked deceased.`);
      if (heir.doNotCall) throw new BadRequestException(`${heir.name} is marked do not call.`);
    } else if (lead.doNotContact || lead.surplusDetail.doNotCall) {
      throw new BadRequestException('This claimant is marked do not contact.');
    }

    const packet = await this.templates.credibilityFor(leadId, organizationId, userId, heir?.id || null);
    if (!packet.ready) {
      throw new BadRequestException(
        `The credibility packet is not set up yet. Missing: ${packet.missing.join(', ')}.`,
      );
    }

    const sent: CredibilityChannel[] = [];
    const errors: string[] = [];

    if (channels.includes('sms')) {
      // A relative's own number, never the claimant's, and never one flagged.
      const heirPhone = heir
        ? [1, 2, 3, 4].map((i) => ({ number: (heir as any)[`phone${i}`], dnc: (heir as any)[`phone${i}Dnc`] })).find((p) => p.number && !p.dnc)?.number
        : null;
      const to = (input.phone || (heir ? heirPhone : lead.sellerPhone) || '').trim();
      if (!to) errors.push(heir ? `No number on file for ${heir.name}.` : 'No phone number to text.');
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
      const to = (input.email || (heir ? heir.email1 : lead.sellerEmail) || '').trim();
      if (!to) errors.push(heir ? `No email on file for ${heir.name}.` : 'No email address on file.');
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
      const how = sent.map((c) => (c === 'sms' ? 'text' : 'email')).join(' and ');
      if (heir) {
        // The person's own record moves, not the case's: the claimant has
        // not seen the packet because their son has.
        await this.prisma.surplusHeir.update({
          where: { id: heir.id },
          data: {
            lastContactedAt: new Date(),
            ...(heir.contactStatus === SurplusContactStatus.NOT_CONTACTED ? { contactStatus: SurplusContactStatus.CONTACTED } : {}),
          },
        });
      } else {
        const before = String(lead.surplusDetail.credibilityChannels || '')
          .split(',')
          .filter(Boolean);
        const all = Array.from(new Set([...before, ...sent]));
        await this.prisma.surplusDetail.update({
          where: { id: lead.surplusDetail.id },
          data: { credibilitySentAt: new Date(), credibilityChannels: all.join(',') },
        });
      }
      const name = heir
        ? `${heir.name}${heir.relationship ? ` (${heir.relationship})` : ''}`
        : `${lead.sellerFirstName || ''} ${lead.sellerLastName || ''}`.trim() || 'the claimant';
      await this.prisma.activity.create({
        data: {
          leadId,
          userId,
          type: 'CREDIBILITY_SENT',
          description: `Credibility packet sent to ${name} by ${how}: ${packet.items.join(', ')}`,
          metadata: {
            channels: sent,
            items: packet.items,
            heirId: heir?.id || null,
            smsVersion: packet.sms.versionLabel,
            emailVersion: packet.email.versionLabel,
          },
        },
      });
    }

    if (!sent.length) {
      throw new BadRequestException(errors.join(' ') || 'Nothing was sent.');
    }
    return { sent, errors, recipient: { heirId: heir?.id || null, name: packet.recipient.name } };
  }

  /** The person on this case whose row holds the number, or null for the claimant's own numbers. */
  private async heirIdForNumber(surplusDetailId: string, phone?: string | null): Promise<string | null> {
    const ten = tenDigits(phone);
    if (ten.length !== 10) return null;
    const rows = await this.prisma.surplusHeir.findMany({
      where: { surplusDetailId },
      select: { id: true, phone1: true, phone2: true, phone3: true, phone4: true },
    });
    const match = rows.find((h) => [h.phone1, h.phone2, h.phone3, h.phone4].some((n) => tenDigits(n) === ten));
    return match?.id || null;
  }
}

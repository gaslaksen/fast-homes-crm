import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { ScoringService } from '../scoring/scoring.service';
import Twilio from 'twilio';
import { formatPhoneNumber, isOptOutMessage } from '@fast-homes/shared';

@Injectable()
export class MessagesService {
  private twilio: Twilio.Twilio | null = null;
  private twilioNumber: string;

  constructor(
    private prisma: PrismaService,
    private scoringService: ScoringService,
    private config: ConfigService,
  ) {
    const accountSid = this.config.get<string>('TWILIO_ACCOUNT_SID');
    const authToken = this.config.get<string>('TWILIO_AUTH_TOKEN');
    this.twilioNumber = this.config.get<string>('TWILIO_PHONE_NUMBER') || '';

    if (accountSid && authToken) {
      this.twilio = Twilio(accountSid, authToken);
      console.log('✅ Twilio initialized');
    } else {
      console.warn('⚠️  Twilio not configured - messages will be simulated');
    }
  }

  /**
   * Generate AI message drafts
   */
  async generateDrafts(leadId: string, context?: string) {
    const lead = await this.prisma.lead.findUnique({
      where: { id: leadId },
      include: {
        messages: {
          orderBy: { createdAt: 'desc' },
          take: 10,
        },
      },
    });

    if (!lead) {
      throw new Error('Lead not found');
    }

    const conversationHistory = lead.messages.map(
      (m) => `${m.direction}: ${m.body}`,
    );

    const drafts = await this.scoringService.generateMessageDrafts({
      sellerName: lead.sellerFirstName,
      propertyAddress: lead.propertyAddress,
      conversationHistory,
      purpose: context,
    });

    return drafts;
  }

  /**
   * Send outbound message via Twilio
   */
  async sendMessage(leadId: string, body: string, userId?: string) {
    const lead = await this.prisma.lead.findUnique({
      where: { id: leadId },
    });

    if (!lead) {
      throw new Error('Lead not found');
    }

    if (lead.doNotContact) {
      throw new Error('Lead is marked as Do Not Contact');
    }

    const to = formatPhoneNumber(lead.sellerPhone);
    const from = this.twilioNumber;

    // Create message record
    const message = await this.prisma.message.create({
      data: {
        leadId,
        direction: 'OUTBOUND',
        status: 'PENDING',
        body,
        from,
        to,
      },
    });

    try {
      if (this.twilio) {
        // Send via Twilio
        const twilioMessage = await this.twilio.messages.create({
          body,
          from,
          to,
        });

        // Update message with Twilio SID and status
        await this.prisma.message.update({
          where: { id: message.id },
          data: {
            twilioSid: twilioMessage.sid,
            status: 'SENT',
            sentAt: new Date(),
          },
        });

        console.log(`✅ Message sent: ${twilioMessage.sid}`);
      } else {
        // Simulate sending (for development without Twilio)
        await this.prisma.message.update({
          where: { id: message.id },
          data: {
            status: 'SENT',
            sentAt: new Date(),
          },
        });

        console.log(`✅ Message simulated (Twilio not configured): ${body.substring(0, 50)}...`);
      }

      // Log activity
      await this.prisma.activity.create({
        data: {
          leadId,
          userId,
          type: 'MESSAGE_SENT',
          description: `Message sent to ${to}`,
          metadata: { body: body.substring(0, 100) },
        },
      });

      // Update lead status if needed
      if (lead.status === 'NEW') {
        await this.prisma.lead.update({
          where: { id: leadId },
          data: { status: 'ATTEMPTING_CONTACT' },
        });
      }

      return message;
    } catch (error) {
      // Mark as failed
      await this.prisma.message.update({
        where: { id: message.id },
        data: { status: 'FAILED' },
      });

      throw new Error(`Failed to send message: ${error.message}`);
    }
  }

  /**
   * Handle inbound message from Twilio webhook
   */
  async handleInboundMessage(data: {
    MessageSid: string;
    From: string;
    To: string;
    Body: string;
  }) {
    const from = formatPhoneNumber(data.From);
    const body = data.Body.trim();

    // Find lead by phone number
    const lead = await this.prisma.lead.findFirst({
      where: { sellerPhone: from },
      include: {
        messages: {
          orderBy: { createdAt: 'desc' },
          take: 20,
        },
      },
    });

    if (!lead) {
      console.warn(`No lead found for phone: ${from}`);
      return { success: false, reason: 'Lead not found' };
    }

    // Check for opt-out
    if (isOptOutMessage(body)) {
      await this.prisma.lead.update({
        where: { id: lead.id },
        data: {
          doNotContact: true,
          unsubscribedAt: new Date(),
        },
      });

      console.log(`✅ Lead ${lead.id} opted out`);

      // Send confirmation if Twilio is configured
      if (this.twilio) {
        await this.twilio.messages.create({
          body: 'You have been unsubscribed from Fast Homes for Cash. You will not receive further messages.',
          from: data.To,
          to: data.From,
        });
      }

      return { success: true, optOut: true };
    }

    // Save message
    const message = await this.prisma.message.create({
      data: {
        leadId: lead.id,
        direction: 'INBOUND',
        status: 'RECEIVED',
        body,
        from,
        to: data.To,
        twilioSid: data.MessageSid,
        sentAt: new Date(),
      },
    });

    // Log activity
    await this.prisma.activity.create({
      data: {
        leadId: lead.id,
        type: 'MESSAGE_RECEIVED',
        description: `Message received from ${from}`,
        metadata: { body: body.substring(0, 100) },
      },
    });

    // Extract signals from message using AI
    const allMessages = [
      ...lead.messages.map((m) => m.body),
      body,
    ];

    try {
      const extracted = await this.scoringService.extractFromMessages(allMessages);

      // Update lead with extracted info
      const updateData: any = {};
      if (extracted.timeline_days) updateData.timeline = extracted.timeline_days;
      if (extracted.asking_price) updateData.askingPrice = extracted.asking_price;
      if (extracted.condition_level) updateData.conditionLevel = extracted.condition_level;
      if (extracted.distress_signals) updateData.distressSignals = extracted.distress_signals;
      if (extracted.ownership_status) updateData.ownershipStatus = extracted.ownership_status;

      if (Object.keys(updateData).length > 0) {
        await this.prisma.lead.update({
          where: { id: lead.id },
          data: updateData,
        });

        console.log(`✅ Updated lead ${lead.id} with extracted data:`, updateData);

        // Trigger rescore
        await this.rescoreLead(lead.id);
      }
    } catch (error) {
      console.error('Failed to extract from messages:', error);
    }

    return { success: true, messageId: message.id };
  }

  /**
   * Rescore a lead (called after message updates or manual trigger)
   */
  async rescoreLead(leadId: string, userId?: string) {
    const lead = await this.prisma.lead.findUnique({
      where: { id: leadId },
    });

    if (!lead) {
      throw new Error('Lead not found');
    }

    const oldScore = lead.totalScore;
    const oldBand = lead.scoreBand;

    // Calculate new score
    const scoringResult = await this.scoringService.scoreLead({
      timeline: lead.timeline,
      askingPrice: lead.askingPrice,
      arv: lead.arv,
      conditionLevel: lead.conditionLevel,
      distressSignals: lead.distressSignals as string[] | undefined,
      ownershipStatus: lead.ownershipStatus,
    });

    // Update lead
    await this.prisma.lead.update({
      where: { id: leadId },
      data: {
        challengeScore: scoringResult.challengeScore,
        authorityScore: scoringResult.authorityScore,
        moneyScore: scoringResult.moneyScore,
        priorityScore: scoringResult.priorityScore,
        totalScore: scoringResult.totalScore,
        scoreBand: scoringResult.scoreBand,
        abcdFit: scoringResult.abcdFit,
        scoringRationale: scoringResult.rationale,
        lastScoredAt: new Date(),
      },
    });

    // Log activity if score changed
    if (oldScore !== scoringResult.totalScore) {
      await this.prisma.activity.create({
        data: {
          leadId,
          userId,
          type: 'SCORE_UPDATED',
          description: `Score updated: ${oldScore} → ${scoringResult.totalScore} (${scoringResult.scoreBand})`,
          metadata: {
            oldScore,
            newScore: scoringResult.totalScore,
            oldBand,
            newBand: scoringResult.scoreBand,
          },
        },
      });
    }

    return scoringResult;
  }

  /**
   * Get messages for a lead
   */
  async getMessages(leadId: string) {
    return this.prisma.message.findMany({
      where: { leadId },
      orderBy: { createdAt: 'asc' },
    });
  }
}

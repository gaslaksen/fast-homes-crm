import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { VapiService } from '../vapi/vapi.service';
import { formatPhoneNumber } from '@fast-homes/shared';

@Injectable()
export class CallsService {
  private readonly logger = new Logger(CallsService.name);

  constructor(
    private prisma: PrismaService,
    private vapiService: VapiService,
  ) {}

  async initiateAiCall(leadId: string) {
    const lead = await this.prisma.lead.findUnique({ where: { id: leadId } });
    if (!lead) {
      throw new NotFoundException(`Lead ${leadId} not found`);
    }

    const customerPhone = formatPhoneNumber(lead.sellerPhone);
    const customerName = `${lead.sellerFirstName} ${lead.sellerLastName}`.trim();

    const call = await this.vapiService.createOutboundCall(customerPhone, customerName);

    const callLog = await this.prisma.callLog.create({
      data: {
        leadId,
        vapiCallId: call.id,
        status: call.status ?? 'queued',
        type: 'ai_outbound',
      },
    });

    // Log activity
    await this.prisma.activity.create({
      data: {
        leadId,
        type: 'AI_CALL_INITIATED',
        description: `AI outbound call initiated to ${customerPhone}`,
        metadata: { vapiCallId: call.id },
      },
    });

    this.logger.log(`AI call initiated for lead ${leadId}: ${callLog.id}`);
    return { callId: callLog.id, status: callLog.status };
  }

  async handleWebhookEvent(event: any) {
    const vapiCallId = event?.call?.id;
    const eventType = event?.message?.type || event?.type;

    this.logger.log(`Vapi webhook: ${eventType} for call ${vapiCallId}`);

    if (!vapiCallId) {
      this.logger.warn('Webhook event missing call ID');
      return { received: true };
    }

    const callLog = await this.prisma.callLog.findUnique({
      where: { vapiCallId },
    });

    if (!callLog) {
      this.logger.warn(`No CallLog found for vapiCallId ${vapiCallId}`);
      return { received: true };
    }

    const updateData: any = {};

    switch (eventType) {
      case 'call-started':
        updateData.status = 'in-progress';
        break;
      case 'call-ended':
        updateData.status = 'ended';
        if (event?.call?.duration) {
          updateData.duration = Math.round(event.call.duration);
        }
        break;
      case 'transcript':
        if (event?.transcript) {
          updateData.transcript = event.transcript;
        }
        break;
      case 'end-of-call-report':
        updateData.status = 'completed';
        if (event?.call?.duration) {
          updateData.duration = Math.round(event.call.duration);
        }
        if (event?.transcript) {
          updateData.transcript = event.transcript;
        }
        break;
      default:
        this.logger.debug(`Unhandled webhook event type: ${eventType}`);
    }

    if (Object.keys(updateData).length > 0) {
      await this.prisma.callLog.update({
        where: { id: callLog.id },
        data: updateData,
      });
    }

    // Log activity for call completion
    if (eventType === 'end-of-call-report' && callLog.leadId) {
      await this.prisma.activity.create({
        data: {
          leadId: callLog.leadId,
          type: 'AI_CALL_COMPLETED',
          description: `AI call completed (${updateData.duration ? `${updateData.duration}s` : 'unknown duration'})`,
          metadata: { vapiCallId },
        },
      });
    }

    return { received: true };
  }
}

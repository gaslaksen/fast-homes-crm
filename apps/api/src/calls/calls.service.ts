import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { VapiService } from '../vapi/vapi.service';
import { formatPhoneNumber } from '@fast-homes/shared';

const DEFAULT_CALL_DELAY_MS = 120_000; // 2 minutes

@Injectable()
export class CallsService {
  private readonly logger = new Logger(CallsService.name);

  constructor(
    private prisma: PrismaService,
    private vapiService: VapiService,
  ) {}

  /**
   * Schedule an AI outbound call after a configurable delay.
   * Checks aiCallEnabled at execution time so a mid-flight toggle is respected.
   * Safe to call on every lead creation — it no-ops if the toggle is off.
   */
  async scheduleOutboundCall(leadId: string, delayMs = DEFAULT_CALL_DELAY_MS) {
    this.logger.log(`📅 AI call scheduled for lead ${leadId} in ${delayMs / 1000}s`);

    setTimeout(async () => {
      try {
        // Re-check toggle at fire time (may have changed since scheduling)
        const settings = await this.prisma.dripSettings.findUnique({
          where: { id: 'default' },
        });

        if (!settings?.aiCallEnabled) {
          this.logger.log(`⏸️  AI calls disabled — skipping scheduled call for lead ${leadId}`);
          return;
        }

        // Verify lead still exists and hasn't opted out
        const lead = await this.prisma.lead.findUnique({ where: { id: leadId } });
        if (!lead) {
          this.logger.warn(`Lead ${leadId} not found at call time — skipping`);
          return;
        }
        if (lead.doNotContact) {
          this.logger.log(`🚫 Lead ${leadId} is DNC — skipping scheduled call`);
          return;
        }

        await this.initiateAiCall(leadId);
      } catch (err) {
        this.logger.error(`Scheduled call failed for lead ${leadId}: ${err.message}`);
      }
    }, delayMs);
  }

  async initiateAiCall(leadId: string) {
    const lead = await this.prisma.lead.findUnique({ where: { id: leadId } });
    if (!lead) {
      throw new NotFoundException(`Lead ${leadId} not found`);
    }

    const customerPhone = formatPhoneNumber(lead.sellerPhone);

    // Pass full lead context so the AI can have an informed conversation
    const call = await this.vapiService.createOutboundCall(customerPhone, {
      sellerFirstName: lead.sellerFirstName ?? undefined,
      sellerLastName: lead.sellerLastName ?? undefined,
      propertyAddress: lead.propertyAddress ?? undefined,
      propertyCity: lead.propertyCity ?? undefined,
      propertyState: lead.propertyState ?? undefined,
      propertyZip: lead.propertyZip ?? undefined,
      propertyType: lead.propertyType ?? undefined,
      bedrooms: lead.bedrooms ?? undefined,
      bathrooms: lead.bathrooms ?? undefined,
      sqft: lead.sqft ?? undefined,
      askingPrice: lead.askingPrice ?? undefined,
      timeline: lead.timeline ?? undefined,
      conditionLevel: lead.conditionLevel ?? undefined,
    });

    const callLog = await this.prisma.callLog.create({
      data: {
        leadId,
        vapiCallId: call.id,
        status: call.status ?? 'queued',
        type: 'ai_outbound',
      },
    });

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

      case 'end-of-call-report': {
        updateData.status = 'completed';
        if (event?.call?.duration) {
          updateData.duration = Math.round(event.call.duration);
        }
        if (event?.transcript) {
          updateData.transcript = event.transcript;
        }

        // Save AI-generated summary and structured analysis
        const summary = event?.analysis?.summary;
        const structuredData = event?.analysis?.structuredData;
        const successEval = event?.analysis?.successEvaluation;

        if (summary || structuredData) {
          updateData.transcript = [
            updateData.transcript || '',
            summary ? `\n\n--- AI SUMMARY ---\n${summary}` : '',
            successEval !== undefined ? `\n\nCall successful: ${successEval}` : '',
          ]
            .join('')
            .trim();
        }

        // If the AI extracted useful CAMP data, update the lead
        if (structuredData && callLog.leadId) {
          await this.syncStructuredDataToLead(callLog.leadId, structuredData, summary);
        }
        break;
      }

      default:
        this.logger.debug(`Unhandled webhook event type: ${eventType}`);
    }

    if (Object.keys(updateData).length > 0) {
      await this.prisma.callLog.update({
        where: { id: callLog.id },
        data: updateData,
      });
    }

    if (eventType === 'end-of-call-report' && callLog.leadId) {
      const duration = updateData.duration;
      await this.prisma.activity.create({
        data: {
          leadId: callLog.leadId,
          type: 'AI_CALL_COMPLETED',
          description: `AI call completed${duration ? ` (${duration}s)` : ''}`,
          metadata: { vapiCallId },
        },
      });
    }

    return { received: true };
  }

  /**
   * Syncs structured data extracted by Vapi's analysis back onto the lead record.
   * Only overwrites fields that are currently blank, so manual edits are preserved.
   */
  private async syncStructuredDataToLead(
    leadId: string,
    data: Record<string, any>,
    summary?: string,
  ) {
    const lead = await this.prisma.lead.findUnique({ where: { id: leadId } });
    if (!lead) return;

    const updates: Record<string, any> = {};

    if (data.askingPriceMentioned && !lead.askingPrice) {
      updates.askingPrice = data.askingPriceMentioned;
    }
    if (data.timelineDays && !lead.timeline) {
      updates.timeline = data.timelineDays;
    }
    if (data.conditionDescription && !lead.conditionLevel) {
      // Map free text to enum if possible, otherwise leave it for manual review
      const lower = data.conditionDescription.toLowerCase();
      if (lower.includes('excel') || lower.includes('great') || lower.includes('perfect')) {
        updates.conditionLevel = 'EXCELLENT';
      } else if (lower.includes('good') || lower.includes('nice')) {
        updates.conditionLevel = 'GOOD';
      } else if (lower.includes('fair') || lower.includes('average') || lower.includes('okay')) {
        updates.conditionLevel = 'FAIR';
      } else if (lower.includes('poor') || lower.includes('bad') || lower.includes('rough') || lower.includes('needs work') || lower.includes('fixer')) {
        updates.conditionLevel = 'POOR';
      }
    }

    if (Object.keys(updates).length > 0) {
      await this.prisma.lead.update({ where: { id: leadId }, data: updates });
      this.logger.log(`Lead ${leadId} updated from AI call analysis: ${Object.keys(updates).join(', ')}`);
    }
  }
}

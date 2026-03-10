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
    // Vapi wraps all event data under event.message
    const msg = event?.message ?? event;
    const eventType: string = msg?.type ?? '';

    // Call ID lives at message.call.id
    const vapiCallId: string | undefined = msg?.call?.id;

    this.logger.log(`Vapi webhook [${eventType}] call=${vapiCallId ?? 'unknown'}`);

    if (!vapiCallId) {
      // Non-call events (e.g. server-message pings) — safe to ignore
      return { received: true };
    }

    const callLog = await this.prisma.callLog.findUnique({ where: { vapiCallId } });

    if (!callLog) {
      this.logger.warn(`No CallLog for vapiCallId=${vapiCallId} — may be an untracked call`);
      return { received: true };
    }

    const updateData: Record<string, any> = {};

    switch (eventType) {
      // ── Call went live ───────────────────────────────────────────────────
      case 'call-started':
      case 'status-update':
        if (msg?.call?.status) updateData.status = msg.call.status;
        break;

      // ── Real-time transcript chunk (skip — end-of-call has the full one) ─
      case 'transcript':
      case 'conversation-update':
      case 'speech-update':
        break;

      // ── Final report — everything we care about ──────────────────────────
      case 'end-of-call-report': {
        updateData.status = 'completed';
        updateData.endedReason = msg?.endedReason ?? msg?.call?.endedReason ?? null;

        // Duration (seconds)
        const dur = msg?.call?.duration ?? msg?.durationSeconds;
        if (dur != null) updateData.duration = Math.round(dur);

        // Full transcript — check both common locations Vapi uses
        const transcript =
          msg?.transcript ??
          msg?.artifact?.transcript ??
          msg?.call?.artifact?.transcript ??
          null;
        if (transcript) updateData.transcript = transcript;

        // Recording URL
        const recordingUrl =
          msg?.recordingUrl ??
          msg?.artifact?.recordingUrl ??
          msg?.call?.artifact?.recordingUrl ??
          msg?.stereoRecordingUrl ??
          msg?.call?.artifact?.stereoRecordingUrl ??
          null;
        if (recordingUrl) updateData.recordingUrl = recordingUrl;

        // AI analysis — summary + structured data
        const analysis = msg?.analysis ?? msg?.call?.analysis ?? {};
        const summary: string | undefined = analysis?.summary;
        const structuredData: Record<string, any> | undefined = analysis?.structuredData;
        const successEval: string | undefined = analysis?.successEvaluation;

        if (summary) {
          const suffix = successEval != null ? `\n\nCall successful: ${successEval}` : '';
          updateData.summary = summary + suffix;
        }

        this.logger.log(
          `end-of-call-report — duration=${updateData.duration}s | ` +
          `transcript=${transcript ? 'yes' : 'no'} | summary=${summary ? 'yes' : 'no'} | ` +
          `structuredData=${structuredData ? JSON.stringify(structuredData) : 'none'}`,
        );

        // Push extracted CAMP data back to the lead
        if (structuredData && callLog.leadId) {
          await this.syncStructuredDataToLead(callLog.leadId, structuredData, summary);
        }
        break;
      }

      default:
        this.logger.debug(`Unhandled Vapi event: ${eventType}`);
    }

    if (Object.keys(updateData).length > 0) {
      await this.prisma.callLog.update({ where: { id: callLog.id }, data: updateData });
    }

    if (eventType === 'end-of-call-report' && callLog.leadId) {
      const dur = updateData.duration;
      await this.prisma.activity.create({
        data: {
          leadId: callLog.leadId,
          type: 'AI_CALL_COMPLETED',
          description: `AI call completed${dur ? ` (${dur}s)` : ''}${updateData.endedReason ? ` — ${updateData.endedReason}` : ''}`,
          metadata: { vapiCallId, recordingUrl: updateData.recordingUrl ?? null },
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

    // Asking price — only backfill if blank
    if (data.askingPriceMentioned && !lead.askingPrice) {
      updates.askingPrice = data.askingPriceMentioned;
    }

    // Timeline in days — only backfill if blank
    if (data.timelineDays && !lead.timeline) {
      updates.timeline = data.timelineDays;
    }

    // Condition — map free-text description to enum values (lowercase to match DB)
    if (data.conditionDescription && !lead.conditionLevel) {
      const lower = data.conditionDescription.toLowerCase();
      if (lower.includes('excel') || lower.includes('great') || lower.includes('perfect') || lower.includes('pristine')) {
        updates.conditionLevel = 'excellent';
      } else if (lower.includes('good') || lower.includes('nice') || lower.includes('well-maintain')) {
        updates.conditionLevel = 'good';
      } else if (lower.includes('fair') || lower.includes('average') || lower.includes('okay') || lower.includes('ok')) {
        updates.conditionLevel = 'fair';
      } else if (lower.includes('poor') || lower.includes('bad') || lower.includes('rough') || lower.includes('needs work') || lower.includes('fixer') || lower.includes('dated')) {
        updates.conditionLevel = 'poor';
      } else if (lower.includes('distress') || lower.includes('abandon') || lower.includes('uninhabit') || lower.includes('condemned')) {
        updates.conditionLevel = 'distressed';
      }
    }

    // Seller motivation from AI summary
    if (data.motivationSummary && !lead.sellerMotivation) {
      updates.sellerMotivation = data.motivationSummary;
    }

    // Ownership status
    if (data.isDecisionMaker === true && !lead.ownershipStatus) {
      updates.ownershipStatus = 'sole_owner';
    }

    // Update lead status based on interest level from call
    if (data.interestLevel && lead.status === 'ATTEMPTING_CONTACT') {
      if (data.reachedSeller) {
        updates.status = 'CONTACT_MADE';
      }
    }
    if (data.interestLevel === 'not_interested') {
      updates.status = 'LOST';
    }

    if (Object.keys(updates).length > 0) {
      await this.prisma.lead.update({ where: { id: leadId }, data: updates });
      this.logger.log(`Lead ${leadId} updated from AI call: ${Object.keys(updates).join(', ')}`);

      await this.prisma.activity.create({
        data: {
          leadId,
          type: 'FIELD_UPDATED',
          description: `AI call updated lead fields: ${Object.keys(updates).join(', ')}`,
          metadata: { source: 'vapi-call', interestLevel: data.interestLevel, ...updates },
        },
      });
    }
  }
}

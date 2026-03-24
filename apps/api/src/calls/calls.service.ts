import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { VapiService } from '../vapi/vapi.service';
import { ScoringService } from '../scoring/scoring.service';
import { formatPhoneNumber } from '@fast-homes/shared';
import Anthropic from '@anthropic-ai/sdk';

const DEFAULT_CALL_DELAY_MS = 120_000; // 2 minutes

@Injectable()
export class CallsService {
  private readonly logger = new Logger(CallsService.name);

  private anthropic: Anthropic | null;

  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
    private vapiService: VapiService,
    private scoringService: ScoringService,
  ) {
    const apiKey = this.config.get<string>('ANTHROPIC_API_KEY');
    this.anthropic = apiKey ? new Anthropic({ apiKey }) : null;
  }

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
  async syncStructuredDataToLead(
    leadId: string,
    data: Record<string, any>,
    summary?: string,
  ) {
    const lead = await this.prisma.lead.findUnique({ where: { id: leadId } });
    if (!lead) return;

    const updates: Record<string, any> = {};

    // ── Money: asking price ──────────────────────────────────────────────
    if (data.askingPriceMentioned && !lead.askingPrice) {
      updates.askingPrice = data.askingPriceMentioned;
    }

    // ── Priority: timeline + motivation ─────────────────────────────────
    if (data.timelineDays && !lead.timeline) {
      updates.timeline = data.timelineDays;
    }
    if (data.motivationSummary && !lead.sellerMotivation) {
      updates.sellerMotivation = data.motivationSummary;
    }

    // ── Challenge: condition — now a direct enum from the AI ─────────────
    const validConditions = ['excellent', 'good', 'fair', 'poor', 'distressed'];
    if (data.conditionLevel && validConditions.includes(data.conditionLevel) && !lead.conditionLevel) {
      updates.conditionLevel = data.conditionLevel;
    }
    // Append condition notes to distressSignals if present
    if (data.conditionNotes) {
      const existing = (lead.distressSignals as string[]) ?? [];
      const notes = data.conditionNotes.split(/[,;]+/).map((s: string) => s.trim()).filter(Boolean);
      const merged = [...new Set([...existing, ...notes])];
      if (merged.length > existing.length) updates.distressSignals = merged;
    }

    // ── Authority: ownership / decision-maker ────────────────────────────
    if (!lead.ownershipStatus) {
      if (data.isDecisionMaker === true) {
        updates.ownershipStatus = 'sole_owner';
      } else if (data.isDecisionMaker === false) {
        // Co-decision-maker situation (spouse, partner, co-owner, estate, etc.)
        updates.ownershipStatus = 'co_owner';
      }
    }

    // ── Lead status: advance pipeline based on call outcome ──────────────
    if (data.reachedSeller && lead.status === 'ATTEMPTING_CONTACT') {
      updates.status = 'QUALIFYING';
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

      // Refresh CAMP completion flags so the UI reflects the new data immediately
      await this.scoringService.refreshCampFlags(leadId);
      this.logger.log(`CAMP flags refreshed for lead ${leadId}`);
    }
  }

  /**
   * Process a SmrtPhone call transcript using Claude to extract CAMP data
   * and update the lead, same as Vapi's structured analysis does.
   */
  async processSmrtPhoneTranscript(leadId: string, transcript: string, summary?: string) {
    if (!this.anthropic || !transcript) return;

    this.logger.log(`Extracting CAMP data from SmrtPhone transcript for lead ${leadId}`);

    try {
      const response = await this.anthropic.messages.create({
        model: 'claude-haiku-4-5',
        max_tokens: 500,
        system: 'You extract structured data from real estate seller call transcripts. Respond with valid JSON only. No markdown, no explanation.',
        messages: [
          {
            role: 'user',
            content: `Extract the following fields from this phone call transcript between a real estate investor and a property seller. Return a JSON object with ONLY the fields where information was mentioned. Omit any field where the data was not discussed.

Fields to extract:
- askingPriceMentioned: number (dollar amount if seller mentioned a price)
- timelineDays: number (estimated days until they want to sell; "ASAP"=7, "this month"=30, "few months"=90, "no rush"=180)
- motivationSummary: string (brief reason for selling: divorce, foreclosure, inherited, downsizing, relocating, etc.)
- conditionLevel: "excellent" | "good" | "fair" | "poor" | "distressed"
- conditionNotes: string (specific issues mentioned: roof, foundation, water damage, etc.)
- isDecisionMaker: boolean (true if caller is the owner/decision-maker)
- reachedSeller: boolean (true if actually spoke with the seller, false if voicemail/no answer)
- interestLevel: "interested" | "not_interested" | "undecided"

Transcript:
${transcript}`,
          },
        ],
      });

      const text = response.content[0]?.type === 'text' ? response.content[0].text : '';
      const cleaned = text.replace(/```json\n?|\n?```/g, '').trim();
      const extracted = JSON.parse(cleaned);

      this.logger.log(`SmrtPhone transcript extraction: ${JSON.stringify(extracted)}`);

      await this.syncStructuredDataToLead(leadId, extracted, summary);
    } catch (error) {
      this.logger.error(`SmrtPhone transcript extraction failed: ${error.message}`);
    }
  }
}

import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ScoringService } from '../scoring/scoring.service';
import { isOptOutMessage } from '@fast-homes/shared';

type IncomingMessage = {
  direction: 'INBOUND' | 'OUTBOUND';
  body: string;
  sentAt?: string;
};

export type DraftReplyInput = {
  partnerKey: string;
  externalId: string;
  sellerFirstName?: string;
  sellerPhone?: string;
  conversationHistory: IncomingMessage[];
  // Optional client-side cache so the partner can skip re-sending derived
  // values. If absent, we use whatever Dealcore has extracted previously plus
  // anything we extract from the new inbound messages.
  knownFields?: {
    timeline?: number | null;
    askingPrice?: number | null;
    conditionLevel?: string | null;
    ownershipStatus?: string | null;
  };
};

export type DraftReplyResult = {
  message: string | null;
  extractedFields: {
    timeline?: number;
    askingPrice?: number;
    askingPriceHigh?: number;
    askingPriceRaw?: string;
    conditionLevel?: string;
    ownershipStatus?: string;
    distressSignals?: string[];
    sellerMotivation?: string;
  };
  campScore: { total: number | null; band: string | null };
  signals: {
    campComplete: boolean;
    shouldHandoff: boolean;
    optOutDetected: boolean;
    missingFields: string[];
  };
};

@Injectable()
export class ExternalConversationsService {
  private readonly logger = new Logger(ExternalConversationsService.name);

  constructor(
    private prisma: PrismaService,
    private scoringService: ScoringService,
  ) {}

  async draftReply(input: DraftReplyInput): Promise<DraftReplyResult> {
    const { partnerKey, externalId, sellerFirstName, sellerPhone, conversationHistory } = input;

    if (!externalId) throw new BadRequestException('externalId is required');
    if (!Array.isArray(conversationHistory)) {
      throw new BadRequestException('conversationHistory must be an array');
    }

    // ── Upsert the conversation record (purely for state caching + analytics) ─
    const conversation = await this.prisma.externalConversation.upsert({
      where: { partnerKey_externalId: { partnerKey, externalId } },
      create: {
        partnerKey,
        externalId,
        sellerFirstName: sellerFirstName ?? null,
        sellerPhone: sellerPhone ?? null,
      },
      update: {
        sellerFirstName: sellerFirstName ?? undefined,
        sellerPhone: sellerPhone ?? undefined,
      },
    });

    // ── Sync incoming messages into our store, idempotently ───────────────
    // Closercontrol always re-sends the full conversation, so we use a
    // (direction, body, sentAt) tuple as the natural dedupe key. We only
    // insert messages that aren't already there.
    const existing = await this.prisma.externalConversationMessage.findMany({
      where: { conversationId: conversation.id },
      orderBy: { sentAt: 'asc' },
    });
    const existingKeys = new Set(existing.map((m) => this.messageKey(m.direction, m.body, m.sentAt)));

    const newMessageRows: { direction: string; body: string; sentAt: Date }[] = [];
    for (const m of conversationHistory) {
      if (m.direction !== 'INBOUND' && m.direction !== 'OUTBOUND') continue;
      if (typeof m.body !== 'string' || !m.body.trim()) continue;
      const sentAt = m.sentAt ? new Date(m.sentAt) : new Date();
      const key = this.messageKey(m.direction, m.body, sentAt);
      if (existingKeys.has(key)) continue;
      newMessageRows.push({ direction: m.direction, body: m.body, sentAt });
    }
    if (newMessageRows.length > 0) {
      await this.prisma.externalConversationMessage.createMany({
        data: newMessageRows.map((r) => ({
          conversationId: conversation.id,
          direction: r.direction,
          body: r.body,
          sentAt: r.sentAt,
        })),
      });
    }

    // ── Opt-out short-circuit ─────────────────────────────────────────────
    // Find the most recent inbound message and check for opt-out keywords.
    // We do NOT send anything ourselves; the partner does. We just tell them.
    const lastInbound = [...conversationHistory]
      .reverse()
      .find((m) => m.direction === 'INBOUND' && typeof m.body === 'string');

    if (lastInbound && isOptOutMessage(lastInbound.body)) {
      this.logger.log(`🚫 Opt-out detected for ${partnerKey}/${externalId}`);
      return {
        message: null,
        extractedFields: {},
        campScore: { total: conversation.campScore, band: conversation.campBand },
        signals: {
          campComplete: false,
          shouldHandoff: false,
          optOutDetected: true,
          missingFields: [],
        },
      };
    }

    // ── Extract CAMP fields from the full conversation ────────────────────
    // The extractor caps at the last 10 messages internally and is stateless,
    // so re-running on the full history is fine.
    const extracted = await this.scoringService.extractFromMessages(
      conversationHistory.map((m) => ({ direction: m.direction, body: m.body })),
    );

    // Merge into stored extracted fields (Dealcore-cached + new extraction +
    // any knownFields the partner overrides). Partner overrides win because
    // they are the source of truth.
    const prevStored: Record<string, any> = (conversation.extractedFields as any) || {};
    const merged: Record<string, any> = { ...prevStored };

    if (extracted.confidence == null || extracted.confidence >= 50) {
      if (extracted.timeline_days != null)   merged.timeline = extracted.timeline_days;
      if (extracted.asking_price != null)    merged.askingPrice = extracted.asking_price;
      if (extracted.asking_price_high != null) merged.askingPriceHigh = extracted.asking_price_high;
      if (extracted.asking_price_raw != null) merged.askingPriceRaw = extracted.asking_price_raw;
      if (extracted.condition_level)         merged.conditionLevel = extracted.condition_level;
      if (extracted.ownership_status)        merged.ownershipStatus = extracted.ownership_status;
      if (extracted.distress_signals?.length) merged.distressSignals = extracted.distress_signals;
      if (extracted.seller_motivation)       merged.sellerMotivation = extracted.seller_motivation;
    }

    // Partner-provided knownFields override anything we have
    const knownFields = {
      timeline:        input.knownFields?.timeline        ?? merged.timeline        ?? null,
      askingPrice:     input.knownFields?.askingPrice     ?? merged.askingPrice     ?? null,
      conditionLevel:  input.knownFields?.conditionLevel  ?? merged.conditionLevel  ?? null,
      ownershipStatus: input.knownFields?.ownershipStatus ?? merged.ownershipStatus ?? null,
    };

    // ── Compute CAMP score (pure math) ────────────────────────────────────
    // No ARV available, so money score will be the unknown-default (1).
    const scoring = await this.scoringService.scoreLead({
      timeline: knownFields.timeline ?? undefined,
      askingPrice: knownFields.askingPrice ?? undefined,
      arv: undefined,
      conditionLevel: knownFields.conditionLevel ?? undefined,
      distressSignals: merged.distressSignals,
      ownershipStatus: knownFields.ownershipStatus ?? undefined,
    });

    // ── Generate the reply (same persona, same examples, no property facts) ─
    const result = await this.scoringService.generateExternalResponse({
      sellerFirstName: sellerFirstName || conversation.sellerFirstName || 'there',
      conversationHistory: conversationHistory
        .filter((m) => (m.direction === 'INBOUND' || m.direction === 'OUTBOUND') && typeof m.body === 'string')
        .map((m) => ({ direction: m.direction, body: m.body })),
      knownFields,
      justExtracted: this.didExtractAnything(extracted) ? extracted : undefined,
    });

    // ── Persist the outbound draft (so future calls can dedupe via messageKey) ─
    const draftSentAt = new Date();
    await this.prisma.externalConversationMessage.create({
      data: {
        conversationId: conversation.id,
        direction: 'OUTBOUND',
        body: result.message,
        sentAt: draftSentAt,
      },
    });

    // ── Update the conversation roll-up ───────────────────────────────────
    const newInboundCount  = newMessageRows.filter((r) => r.direction === 'INBOUND').length;
    const newOutboundCount = newMessageRows.filter((r) => r.direction === 'OUTBOUND').length;
    const lastInboundFromInput = newMessageRows
      .filter((r) => r.direction === 'INBOUND')
      .reduce<Date | null>((acc, r) => (!acc || r.sentAt > acc ? r.sentAt : acc), null);

    await this.prisma.externalConversation.update({
      where: { id: conversation.id },
      data: {
        extractedFields: merged,
        campScore: scoring.totalScore,
        campBand: scoring.scoreBand,
        messageCount: { increment: newInboundCount + newOutboundCount + 1 },
        lastInboundAt: lastInboundFromInput ?? undefined,
        lastOutboundAt: draftSentAt,
      },
    });

    return {
      message: result.message,
      extractedFields: {
        timeline:        merged.timeline,
        askingPrice:     merged.askingPrice,
        askingPriceHigh: merged.askingPriceHigh,
        askingPriceRaw:  merged.askingPriceRaw,
        conditionLevel:  merged.conditionLevel,
        ownershipStatus: merged.ownershipStatus,
        distressSignals: merged.distressSignals,
        sellerMotivation: merged.sellerMotivation,
      },
      campScore: { total: scoring.totalScore, band: scoring.scoreBand },
      signals: {
        campComplete: result.campComplete,
        shouldHandoff: result.campComplete,
        optOutDetected: false,
        missingFields: result.missingFields,
      },
    };
  }

  private messageKey(direction: string, body: string, sentAt: Date): string {
    return `${direction}|${body}|${sentAt.getTime()}`;
  }

  private didExtractAnything(e: Record<string, any>): boolean {
    return !!(
      e.timeline_days != null ||
      e.asking_price != null ||
      e.asking_price_raw ||
      e.condition_level ||
      e.ownership_status ||
      e.distress_signals?.length ||
      e.seller_motivation
    );
  }
}

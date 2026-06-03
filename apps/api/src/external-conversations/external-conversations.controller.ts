import { Body, Controller, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { ExternalApiKeyGuard } from './external-api-key.guard';
import { ExternalConversationsService, DraftReplyInput } from './external-conversations.service';

type PartnerRequest = Request & { partnerKey?: string };

@Controller('external/conversations')
@UseGuards(ExternalApiKeyGuard)
export class ExternalConversationsController {
  constructor(private service: ExternalConversationsService) {}

  /**
   * Generate an SMS reply for a partner-driven conversation.
   *
   * Auth: Bearer token. The matched partner key is injected by the guard.
   * The partner is responsible for sending the returned message; Dealcore
   * only generates it.
   */
  @Post('draft-reply')
  async draftReply(
    @Req() req: PartnerRequest,
    @Body() body: Omit<DraftReplyInput, 'partnerKey'>,
  ) {
    return this.service.draftReply({ ...body, partnerKey: req.partnerKey! });
  }
}

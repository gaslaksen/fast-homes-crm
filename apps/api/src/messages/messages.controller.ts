import { Controller, Get, Post, Body, Param } from '@nestjs/common';
import { MessagesService } from './messages.service';

@Controller('leads/:leadId/messages')
export class MessagesController {
  constructor(private messagesService: MessagesService) {}

  @Get()
  async getMessages(@Param('leadId') leadId: string) {
    return this.messagesService.getMessages(leadId);
  }

  @Post('draft')
  async draftMessage(
    @Param('leadId') leadId: string,
    @Body() body: { context?: string },
  ) {
    return this.messagesService.generateDrafts(leadId, body.context);
  }

  @Post('send')
  async sendMessage(
    @Param('leadId') leadId: string,
    @Body() body: { message: string; userId?: string },
  ) {
    return this.messagesService.sendMessage(leadId, body.message, body.userId);
  }

  @Post('rescore')
  async rescoreLead(
    @Param('leadId') leadId: string,
    @Body() body: { userId?: string },
  ) {
    return this.messagesService.rescoreLead(leadId, body.userId);
  }

  @Post('simulate-reply')
  async simulateReply(
    @Param('leadId') leadId: string,
    @Body() body: { message: string },
  ) {
    return this.messagesService.simulateReply(leadId, body.message);
  }
}

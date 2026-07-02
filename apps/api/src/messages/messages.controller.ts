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

  @Get('emails')
  async getEmails(@Param('leadId') leadId: string) {
    return this.messagesService.getEmails(leadId);
  }

  @Post('emails/send')
  async sendEmailReply(
    @Param('leadId') leadId: string,
    @Body()
    body: {
      userId: string;
      subject?: string;
      body?: string;
      bodyHtml?: string;
      to?: string;
      inReplyToEmailId?: string;
    },
  ) {
    return this.messagesService.sendEmailReply(leadId, body.userId, {
      subject: body.subject,
      body: body.body,
      bodyHtml: body.bodyHtml,
      to: body.to,
      inReplyToEmailId: body.inReplyToEmailId,
    });
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

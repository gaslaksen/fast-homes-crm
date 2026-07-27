import { Controller, Get, Post, Body, Param } from '@nestjs/common';
import { MessagesService } from './messages.service';
import { PhoneNumbersService, numberKey } from '../phone-numbers/phone-numbers.service';

@Controller('leads/:leadId/messages')
export class MessagesController {
  constructor(
    private messagesService: MessagesService,
    private phoneNumbers: PhoneNumbersService,
  ) {}

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
    @Body() body: { message: string; userId?: string; from?: string },
  ) {
    return this.messagesService.sendMessage(leadId, body.message, body.userId, body.from);
  }

  /**
   * Numbers the composer may send this lead from, plus which one is preselected.
   * `lastUsed` marks the number already on this thread, `isDefault` the org
   * fallback, mirroring the badges in the picker.
   */
  @Get('from-options')
  async getFromOptions(@Param('leadId') leadId: string) {
    const [numbers, sticky, selected] = await Promise.all([
      this.phoneNumbers.list({ channel: 'sms' }),
      this.phoneNumbers.stickyNumberFor(leadId),
      this.phoneNumbers.resolveForLead(leadId),
    ]);
    return {
      selected,
      numbers: numbers.map((n) => ({
        number: n.number,
        label: n.label,
        isDefault: n.isDefault,
        lastUsed: !!sticky && numberKey(sticky) === numberKey(n.number),
      })),
    };
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

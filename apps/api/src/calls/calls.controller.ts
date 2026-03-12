import { Controller, Post, Body, Logger } from '@nestjs/common';
import { CallsService } from './calls.service';
import { InitiateCallDto } from './dto/initiate-call.dto';

@Controller('calls')
export class CallsController {
  private readonly logger = new Logger(CallsController.name);

  constructor(private callsService: CallsService) {}

  @Post('ai-initiate')
  async initiateAiCall(@Body() dto: InitiateCallDto) {
    return this.callsService.initiateAiCall(dto.leadId);
  }

  @Post('vapi-webhook')
  async vapiWebhook(@Body() body: any) {
    return this.callsService.handleWebhookEvent(body);
  }
}

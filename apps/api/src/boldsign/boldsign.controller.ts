import { Controller, Get, Post, Param, Body } from '@nestjs/common';
import { BoldSignService } from './boldsign.service';

@Controller('leads/:leadId/boldsign')
export class BoldSignController {
  constructor(private boldSignService: BoldSignService) {}

  @Post('send')
  async sendDocument(
    @Param('leadId') leadId: string,
    @Body() body: { templateType: 'purchase' | 'aif' },
  ) {
    return this.boldSignService.sendDocument(
      leadId,
      body.templateType || 'purchase',
    );
  }

  @Get('status')
  async getStatus(@Param('leadId') leadId: string) {
    return this.boldSignService.syncContractStatus(leadId);
  }
}

@Controller('boldsign')
export class BoldSignGlobalController {
  constructor(private boldSignService: BoldSignService) {}

  @Get('templates')
  async listTemplates() {
    return this.boldSignService.listTemplates();
  }
}

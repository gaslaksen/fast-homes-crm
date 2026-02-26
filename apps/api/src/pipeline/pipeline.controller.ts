import { Controller, Get, Patch, Post, Param, Body } from '@nestjs/common';
import { PipelineService } from './pipeline.service';

@Controller('pipeline')
export class PipelineController {
  constructor(private pipelineService: PipelineService) {}

  @Get()
  async getPipeline() {
    const leadsByStage = await this.pipelineService.getLeadsByStage();
    return { leadsByStage };
  }

  @Patch('leads/:id/stage')
  async updateStage(
    @Param('id') id: string,
    @Body() body: { stage: string },
  ) {
    return this.pipelineService.updateLeadStage(id, body.stage);
  }

  @Post('insights')
  async getInsights() {
    const leadsByStage = await this.pipelineService.getLeadsByStage();
    return this.pipelineService.generateAiInsights(leadsByStage);
  }

  @Get('leads/:id/analysis')
  async getLeadAnalysis(@Param('id') id: string) {
    return this.pipelineService.getCachedOrGenerateAnalysis(id);
  }

  @Post('leads/:id/analysis/refresh')
  async refreshLeadAnalysis(@Param('id') id: string) {
    return this.pipelineService.generateLeadAnalysis(id);
  }
}

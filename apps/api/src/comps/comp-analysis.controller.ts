import { Controller, Get, Post, Patch, Delete, Body, Param, UseInterceptors, UploadedFiles } from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { CompAnalysisService } from './comp-analysis.service';

@Controller('leads/:leadId/comp-analysis')
export class CompAnalysisController {
  constructor(private compAnalysisService: CompAnalysisService) {}

  @Post()
  async createAnalysis(
    @Param('leadId') leadId: string,
    @Body() body: {
      mode?: string;
      maxDistance?: number;
      timeFrameMonths?: number;
      propertyStatus?: string[];
      propertyType?: string;
      selectedCompIds?: string[];
      sourceFilter?: string;
    },
  ) {
    return this.compAnalysisService.createAnalysis(leadId, body);
  }

  @Get()
  async listAnalyses(@Param('leadId') leadId: string) {
    return this.compAnalysisService.getAnalysesForLead(leadId);
  }

  @Get(':analysisId')
  async getAnalysis(@Param('analysisId') analysisId: string) {
    return this.compAnalysisService.getAnalysis(analysisId);
  }

  @Patch(':analysisId')
  async updateAnalysis(
    @Param('analysisId') analysisId: string,
    @Body() body: any,
  ) {
    return this.compAnalysisService.updateAnalysis(analysisId, body);
  }

  @Post(':analysisId/comps')
  async addComp(
    @Param('leadId') leadId: string,
    @Param('analysisId') analysisId: string,
    @Body() body: any,
  ) {
    return this.compAnalysisService.addComp(analysisId, leadId, body);
  }

  @Patch(':analysisId/comps/:compId')
  async updateComp(
    @Param('compId') compId: string,
    @Body() body: any,
  ) {
    return this.compAnalysisService.updateComp(compId, body);
  }

  @Delete(':analysisId/comps/:compId')
  async deleteComp(@Param('compId') compId: string) {
    return this.compAnalysisService.deleteComp(compId);
  }

  @Post(':analysisId/comps/:compId/toggle')
  async toggleCompSelection(@Param('compId') compId: string) {
    return this.compAnalysisService.toggleCompSelection(compId);
  }

  @Post(':analysisId/comps/select-all')
  async selectAll(
    @Param('analysisId') analysisId: string,
    @Body() body: { selected: boolean; source?: string },
  ) {
    return this.compAnalysisService.setAllSelected(analysisId, body.selected, body.source);
  }

  @Post(':analysisId/calculate-adjustments')
  async calculateAdjustments(
    @Param('analysisId') analysisId: string,
    @Body() body: any,
  ) {
    return this.compAnalysisService.calculateAdjustments(analysisId, body.config);
  }

  @Post(':analysisId/ai-adjust-comps')
  async aiAdjustComps(@Param('analysisId') analysisId: string) {
    return this.compAnalysisService.aiAdjustComps(analysisId);
  }

  @Post(':analysisId/calculate-arv')
  async calculateArv(
    @Param('analysisId') analysisId: string,
    @Body() body: { method?: string; preserveAiArv?: boolean },
  ) {
    return this.compAnalysisService.calculateArv(analysisId, body.method, body.preserveAiArv);
  }

  @Post(':analysisId/ai-summary')
  async generateAiSummary(@Param('analysisId') analysisId: string) {
    const summary = await this.compAnalysisService.generateAiSummary(analysisId);
    return { summary };
  }

  @Post(':analysisId/estimate-repairs')
  async estimateRepairs(
    @Param('analysisId') analysisId: string,
    @Body() body: {
      finishLevel: string;
      description?: string;
      repairItems?: string[];
      sqft?: number;
    },
  ) {
    return this.compAnalysisService.estimateRepairCosts(analysisId, body);
  }

  @Post(':analysisId/calculate-deal')
  async calculateDeal(
    @Param('analysisId') analysisId: string,
    @Body() body: {
      arv?: number;
      repairCosts?: number;
      assignmentFee?: number;
      maoPercent?: number;
      dealType?: string;
    },
  ) {
    return this.compAnalysisService.calculateDeal(analysisId, body);
  }

  @Post(':analysisId/save-to-lead')
  async saveToLead(@Param('analysisId') analysisId: string) {
    return this.compAnalysisService.saveToLead(analysisId);
  }

  @Post(':analysisId/assessment')
  async generateAssessment(@Param('analysisId') analysisId: string) {
    const assessment = await this.compAnalysisService.generateAssessment(analysisId);
    return { assessment };
  }

  @Post(':analysisId/analyze-photos')
  @UseInterceptors(FilesInterceptor('photos', 30, { storage: memoryStorage() }))
  async analyzePhotos(
    @Param('analysisId') analysisId: string,
    @UploadedFiles() photos: Express.Multer.File[],
  ) {
    return this.compAnalysisService.analyzePhotos(analysisId, photos);
  }

  @Post(':analysisId/risk-flags')
  async assessRiskFlags(
    @Param('analysisId') analysisId: string,
    @Body() body: { functionalObsolescenceAdj?: number; buyerPoolReduction?: number; landUtilityReduction?: number },
  ) {
    return this.compAnalysisService.assessRiskFlags(analysisId, body);
  }

  @Post(':analysisId/cost-approach')
  async calculateCostApproach(@Param('analysisId') analysisId: string) {
    return this.compAnalysisService.calculateCostApproach(analysisId);
  }

  @Post(':analysisId/income-approach')
  async calculateIncomeApproach(
    @Param('analysisId') analysisId: string,
    @Body() body: { marketRent?: number; grmOverride?: number },
  ) {
    return this.compAnalysisService.calculateIncomeApproach(
      analysisId,
      body.marketRent,
      body.grmOverride,
    );
  }

  @Post(':analysisId/triangulate')
  async triangulateArv(@Param('analysisId') analysisId: string) {
    return this.compAnalysisService.triangulateArv(analysisId);
  }
}

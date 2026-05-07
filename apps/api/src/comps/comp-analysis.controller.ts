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

  // Legacy ARV endpoints removed in Build 016 (Valuation tab consolidation).
  // ARV is now produced by AiArvCalculationService at POST /leads/:id/arv-calculation.

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

  // save-to-lead and assessment endpoints removed in Build 016.
  // ARV persists implicitly on each calculation; "Wholesaler Take" relocates
  // to the Strategy tab in a later phase.

  @Post(':analysisId/analyze-photos')
  @UseInterceptors(FilesInterceptor('photos', 30, { storage: memoryStorage() }))
  async analyzePhotos(
    @Param('analysisId') analysisId: string,
    @UploadedFiles() photos: Express.Multer.File[],
  ) {
    return this.compAnalysisService.analyzePhotos(analysisId, photos);
  }

  @Post(':analysisId/analyze-lead-photos')
  async analyzeLeadPhotos(
    @Param('leadId') leadId: string,
    @Param('analysisId') analysisId: string,
    @Body() body: { photoIds?: string[] },
  ) {
    return this.compAnalysisService.analyzePhotosFromLead(analysisId, leadId, {
      photoIds: body.photoIds,
    });
  }

  // Risk-flags and cost-approach endpoints removed — those pipelines were
  // unused from the UI and produced confusing secondary ARV numbers that
  // the user didn't trust. The ARV tab now shows only the AI-adjusted value
  // with raw Comparable Sales as a reference.

  @Post(':analysisId/deal-intelligence')
  async generateDealIntelligence(@Param('analysisId') analysisId: string) {
    const intelligence = await this.compAnalysisService.generateDealIntelligence(analysisId);
    return { intelligence };
  }

  // PropGPT endpoint removed — REAPI's PropGPT is a property-search frontend
  // (natural language → PropertySearch), not an analysis chatbot. AI ARV
  // now lives in AiArvCalculationModule at POST /leads/:id/arv-calculation.

  @Post(':analysisId/apply-filters')
  async applyFilters(
    @Param('analysisId') analysisId: string,
    @Body() body: { maxDistance?: number; timeFrameMonths?: number },
  ) {
    return this.compAnalysisService.applyFilters(analysisId, body);
  }
}

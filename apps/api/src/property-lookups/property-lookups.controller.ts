import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseInterceptors,
  UploadedFiles,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { PropertyLookupsService, PropertyLookupInput } from './property-lookups.service';
import { CompAnalysisService } from '../comps/comp-analysis.service';
import { CompsService } from '../comps/comps.service';

@Controller('property-lookups')
export class PropertyLookupsController {
  constructor(
    private propertyLookups: PropertyLookupsService,
    private compAnalysisService: CompAnalysisService,
    private compsService: CompsService,
  ) {}

  // ── CRUD ──────────────────────────────────────────────────────────────────

  @Get()
  async list(
    @Query('archived') archived?: string,
    @Query('q') search?: string,
  ) {
    return this.propertyLookups.list({
      archived: archived === 'true' ? true : archived === 'false' ? false : undefined,
      search,
    });
  }

  @Post()
  async create(@Body() body: PropertyLookupInput) {
    return this.propertyLookups.create(body);
  }

  @Get(':id')
  async get(@Param('id') id: string) {
    return this.propertyLookups.getById(id);
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Body() body: Partial<PropertyLookupInput>) {
    return this.propertyLookups.update(id, body);
  }

  @Delete(':id')
  async remove(@Param('id') id: string) {
    return this.propertyLookups.remove(id);
  }

  @Post(':id/archive')
  async archive(@Param('id') id: string) {
    return this.propertyLookups.archive(id);
  }

  @Post(':id/unarchive')
  async unarchive(@Param('id') id: string) {
    return this.propertyLookups.unarchive(id);
  }

  // ── Analyze (create CompAnalysis + run provider fetch in one call) ────────
  @Post(':id/analyze')
  async analyze(
    @Param('id') id: string,
    @Body() body: {
      preferSource?: 'reapi' | 'batchdata';
      forceRefresh?: boolean;
      mode?: string;
      maxDistance?: number;
      timeFrameMonths?: number;
      propertyType?: string;
    },
  ) {
    return this.propertyLookups.runAnalysis(id, body);
  }

  @Post(':id/fetch-comps')
  async fetchComps(
    @Param('id') id: string,
    @Body() body: { preferSource?: 'reapi' | 'batchdata'; forceRefresh?: boolean },
  ) {
    return this.compsService.fetchCompsForLookup(id, body);
  }

  // ── Mirrored comp-analysis routes ─────────────────────────────────────────
  // These mirror /leads/:leadId/comp-analysis/... so the existing UI
  // components can drive ad-hoc analyses with the same payload contracts.

  @Get(':id/comp-analysis')
  async listAnalyses(@Param('id') id: string) {
    return this.compAnalysisService.getAnalysesForLookup(id);
  }

  @Post(':id/comp-analysis')
  async createAnalysis(
    @Param('id') id: string,
    @Body() body: {
      mode?: string;
      maxDistance?: number;
      timeFrameMonths?: number;
      propertyStatus?: string[];
      propertyType?: string;
    },
  ) {
    return this.compAnalysisService.createAnalysisForParent(
      { kind: 'lookup', lookupId: id },
      { ...body, importExistingComps: false },
    );
  }

  @Get(':id/comp-analysis/:analysisId')
  async getAnalysis(@Param('analysisId') analysisId: string) {
    return this.compAnalysisService.getAnalysis(analysisId);
  }

  @Patch(':id/comp-analysis/:analysisId')
  async updateAnalysis(@Param('analysisId') analysisId: string, @Body() body: any) {
    return this.compAnalysisService.updateAnalysis(analysisId, body);
  }

  @Post(':id/comp-analysis/:analysisId/comps')
  async addComp(
    @Param('id') id: string,
    @Param('analysisId') analysisId: string,
    @Body() body: any,
  ) {
    return this.compAnalysisService.addCompForParent(
      analysisId,
      { kind: 'lookup', lookupId: id },
      body,
    );
  }

  @Patch(':id/comp-analysis/:analysisId/comps/:compId')
  async updateComp(@Param('compId') compId: string, @Body() body: any) {
    return this.compAnalysisService.updateComp(compId, body);
  }

  @Delete(':id/comp-analysis/:analysisId/comps/:compId')
  async deleteComp(@Param('compId') compId: string) {
    return this.compAnalysisService.deleteComp(compId);
  }

  @Post(':id/comp-analysis/:analysisId/comps/:compId/toggle')
  async toggleCompSelection(@Param('compId') compId: string) {
    return this.compAnalysisService.toggleCompSelection(compId);
  }

  @Post(':id/comp-analysis/:analysisId/comps/select-all')
  async selectAll(
    @Param('analysisId') analysisId: string,
    @Body() body: { selected: boolean; source?: string },
  ) {
    return this.compAnalysisService.setAllSelected(analysisId, body.selected, body.source);
  }

  @Post(':id/comp-analysis/:analysisId/calculate-adjustments')
  async calculateAdjustments(
    @Param('analysisId') analysisId: string,
    @Body() body: any,
  ) {
    return this.compAnalysisService.calculateAdjustments(analysisId, body.config);
  }

  @Post(':id/comp-analysis/:analysisId/ai-summary')
  async generateAiSummary(@Param('analysisId') analysisId: string) {
    const summary = await this.compAnalysisService.generateAiSummary(analysisId);
    return { summary };
  }

  @Post(':id/comp-analysis/:analysisId/estimate-repairs')
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

  @Post(':id/comp-analysis/:analysisId/calculate-deal')
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

  @Post(':id/comp-analysis/:analysisId/analyze-photos')
  @UseInterceptors(FilesInterceptor('photos', 30, { storage: memoryStorage() }))
  async analyzePhotos(
    @Param('analysisId') analysisId: string,
    @UploadedFiles() photos: Express.Multer.File[],
  ) {
    return this.compAnalysisService.analyzePhotos(analysisId, photos);
  }

  @Post(':id/comp-analysis/:analysisId/deal-intelligence')
  async generateDealIntelligence(@Param('analysisId') analysisId: string) {
    const intelligence = await this.compAnalysisService.generateDealIntelligence(analysisId);
    return { intelligence };
  }

  @Post(':id/comp-analysis/:analysisId/apply-filters')
  async applyFilters(
    @Param('analysisId') analysisId: string,
    @Body() body: { maxDistance?: number; timeFrameMonths?: number },
  ) {
    return this.compAnalysisService.applyFilters(analysisId, body);
  }
}

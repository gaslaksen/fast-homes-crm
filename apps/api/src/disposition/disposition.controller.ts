import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import {
  CreateDispositionCostDto,
  DispositionService,
  UpdateDispositionCostDto,
  UpsertDispositionPlanDto,
  UpsertFinalSaleDto,
} from './disposition.service';

// All endpoints scoped under /leads/:id/... so they live alongside the
// existing lead detail surface area. Auth is the same Bearer JWT pattern as
// the rest of the app — controllers don't enforce it directly today; we
// rely on route-level checks in middleware (matches existing services).
@Controller('leads')
export class DispositionController {
  constructor(private readonly disposition: DispositionService) {}

  // ── Disposition Plan ──────────────────────────────────────────────────────

  @Get(':id/disposition-plan')
  async getPlan(@Param('id') leadId: string) {
    return this.disposition.getPlan(leadId);
  }

  @Post(':id/disposition-plan')
  async createOrUpdatePlan(
    @Param('id') leadId: string,
    @Body() body: UpsertDispositionPlanDto,
  ) {
    return this.disposition.upsertPlan(leadId, body);
  }

  @Patch(':id/disposition-plan')
  async patchPlan(
    @Param('id') leadId: string,
    @Body() body: UpsertDispositionPlanDto,
  ) {
    return this.disposition.upsertPlan(leadId, body);
  }

  // ── Disposition Costs ─────────────────────────────────────────────────────

  @Get(':id/disposition-costs')
  async listCosts(@Param('id') leadId: string) {
    return this.disposition.listCosts(leadId);
  }

  @Post(':id/disposition-costs')
  async createCost(
    @Param('id') leadId: string,
    @Body() body: CreateDispositionCostDto,
  ) {
    return this.disposition.createCost(leadId, body);
  }

  @Patch(':id/disposition-costs/:costId')
  async updateCost(
    @Param('id') leadId: string,
    @Param('costId') costId: string,
    @Body() body: UpdateDispositionCostDto,
  ) {
    return this.disposition.updateCost(leadId, costId, body);
  }

  @Delete(':id/disposition-costs/:costId')
  async deleteCost(
    @Param('id') leadId: string,
    @Param('costId') costId: string,
  ) {
    return this.disposition.deleteCost(leadId, costId);
  }

  // ── Final Sale ────────────────────────────────────────────────────────────

  @Get(':id/final-sale')
  async getFinalSale(@Param('id') leadId: string) {
    return this.disposition.getFinalSale(leadId);
  }

  @Post(':id/final-sale')
  async createOrUpdateFinalSale(
    @Param('id') leadId: string,
    @Body() body: UpsertFinalSaleDto,
  ) {
    return this.disposition.upsertFinalSale(leadId, body);
  }

  @Patch(':id/final-sale')
  async patchFinalSale(
    @Param('id') leadId: string,
    @Body() body: UpsertFinalSaleDto,
  ) {
    return this.disposition.upsertFinalSale(leadId, body);
  }

  // ── Stage transitions ─────────────────────────────────────────────────────

  @Post(':id/mark-acquired')
  async markAcquired(@Param('id') leadId: string) {
    return this.disposition.markAcquired(leadId);
  }

  @Post(':id/mark-sold')
  async markSold(@Param('id') leadId: string) {
    return this.disposition.markSold(leadId);
  }
}

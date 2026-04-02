import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  Query,
  Headers,
  Res,
  UnauthorizedException,
  BadRequestException,
} from '@nestjs/common';
import { Response } from 'express';
import * as jwt from 'jsonwebtoken';
import { DealSearchService } from './deal-search.service';
import { DealSearchFilters, AddToPipelineRequest } from './deal-search.types';

@Controller('deal-search')
export class DealSearchController {
  constructor(private readonly dealSearchService: DealSearchService) {}

  // ─── Decode JWT token ────────────────────────────────────────────────────

  private decodeToken(authHeader?: string): {
    userId?: string;
    organizationId?: string;
    role?: string;
  } {
    try {
      const token = authHeader?.replace('Bearer ', '');
      if (!token) return {};
      return (jwt.decode(token) as any) || {};
    } catch {
      return {};
    }
  }

  private requireAuth(authHeader?: string) {
    const decoded = this.decodeToken(authHeader);
    if (!decoded.userId || !decoded.organizationId) {
      throw new UnauthorizedException('Authentication required');
    }
    return decoded as { userId: string; organizationId: string; role?: string };
  }

  // ─── Search ──────────────────────────────────────────────────────────────

  @Post('search')
  async search(
    @Headers('authorization') authHeader: string,
    @Body() body: { filters: DealSearchFilters; page?: number; pageSize?: number },
  ) {
    const { organizationId } = this.requireAuth(authHeader);

    if (!body.filters) {
      throw new BadRequestException('Filters are required');
    }

    return this.dealSearchService.search(
      body.filters,
      organizationId,
      body.page || 1,
      body.pageSize || 50,
    );
  }

  // ─── Property detail ─────────────────────────────────────────────────────

  @Get('property/:attomId')
  async getPropertyDetail(
    @Headers('authorization') authHeader: string,
    @Param('attomId') attomId: string,
    @Query('street') street?: string,
    @Query('city') city?: string,
    @Query('state') state?: string,
    @Query('zip') zip?: string,
  ) {
    this.requireAuth(authHeader);

    if (!street || !city || !state || !zip) {
      throw new BadRequestException('Address params (street, city, state, zip) are required');
    }

    return this.dealSearchService.getPropertyDetail({ street, city, state, zip });
  }

  // ─── Add to pipeline ─────────────────────────────────────────────────────

  @Post('add-to-pipeline')
  async addToPipeline(
    @Headers('authorization') authHeader: string,
    @Body() body: AddToPipelineRequest,
  ) {
    const { userId, organizationId } = this.requireAuth(authHeader);

    if (!body.propertyAddress || !body.propertyCity || !body.propertyState || !body.propertyZip) {
      throw new BadRequestException('Property address is required');
    }

    return this.dealSearchService.addToPipeline(body, organizationId, userId);
  }

  // ─── Saved searches ─────────────────────────────────────────────────────

  @Post('saved-searches')
  async saveSearch(
    @Headers('authorization') authHeader: string,
    @Body() body: { name: string; filters: DealSearchFilters },
  ) {
    const { userId, organizationId } = this.requireAuth(authHeader);

    if (!body.name || !body.filters) {
      throw new BadRequestException('Name and filters are required');
    }

    return this.dealSearchService.saveSearch(userId, organizationId, body.name, body.filters);
  }

  @Get('saved-searches')
  async listSavedSearches(
    @Headers('authorization') authHeader: string,
  ) {
    const { userId, organizationId } = this.requireAuth(authHeader);
    return this.dealSearchService.listSavedSearches(userId, organizationId);
  }

  @Delete('saved-searches/:id')
  async deleteSavedSearch(
    @Headers('authorization') authHeader: string,
    @Param('id') id: string,
  ) {
    const { organizationId } = this.requireAuth(authHeader);
    return this.dealSearchService.deleteSavedSearch(id, organizationId);
  }

  // ─── Export CSV ──────────────────────────────────────────────────────────

  @Post('export-csv')
  async exportCsv(
    @Headers('authorization') authHeader: string,
    @Body() body: { filters: DealSearchFilters },
    @Res() res: Response,
  ) {
    const { organizationId } = this.requireAuth(authHeader);

    const csv = await this.dealSearchService.exportCsv(body.filters, organizationId);

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="deal-search-${Date.now()}.csv"`);
    res.send(csv);
  }

  // ─── Skip trace (stub) ──────────────────────────────────────────────────

  @Post('skip-trace')
  async skipTrace(
    @Headers('authorization') authHeader: string,
    @Body() body: { attomId: string },
  ) {
    this.requireAuth(authHeader);
    return this.dealSearchService.skipTrace(body.attomId);
  }
}

import { Body, Controller, Get, Param, Patch } from '@nestjs/common';
import { DealMathService, RepairEstimatePayload } from './deal-math.service';
import { DealMathStrategyKey } from './strategy-config';

@Controller('leads/:leadId/deal-math')
export class DealMathController {
  constructor(private readonly dealMath: DealMathService) {}

  @Get()
  async get(@Param('leadId') leadId: string) {
    return this.dealMath.get(leadId);
  }

  @Patch('strategy')
  async setStrategy(
    @Param('leadId') leadId: string,
    @Body() body: { strategy: DealMathStrategyKey | null },
  ) {
    return this.dealMath.setStrategy(leadId, body.strategy ?? null);
  }

  @Patch('inputs')
  async setInputs(
    @Param('leadId') leadId: string,
    @Body() body: { strategy: DealMathStrategyKey; patch: Record<string, unknown> },
  ) {
    return this.dealMath.setStrategyInputs(leadId, body.strategy, body.patch);
  }

  @Patch('repair-estimate')
  async setRepairEstimate(
    @Param('leadId') leadId: string,
    @Body() body: RepairEstimatePayload,
  ) {
    return this.dealMath.setRepairEstimate(leadId, body);
  }
}

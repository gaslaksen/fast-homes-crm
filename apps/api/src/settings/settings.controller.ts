import {
  Controller,
  Get,
  Patch,
  Post,
  Delete,
  Body,
  Param,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { DripService } from '../drip/drip.service';
import { ScoringService } from '../scoring/scoring.service';
import { UpdateDripDto } from './update-drip.dto';
import { CreateAiPromptDto, UpdateAiPromptDto } from './ai-prompt.dto';

@Controller('settings')
export class SettingsController {
  constructor(
    private prisma: PrismaService,
    private dripService: DripService,
    private scoringService: ScoringService,
  ) {}

  // ─── Drip Settings ──────────────────────────────────

  @Get('drip')
  async getDrip() {
    return this.prisma.dripSettings.upsert({
      where: { id: 'default' },
      create: {},
      update: {},
    });
  }

  @Patch('drip')
  async updateDrip(@Body() body: UpdateDripDto) {
    return this.prisma.dripSettings.upsert({
      where: { id: 'default' },
      create: { ...body },
      update: { ...body },
    });
  }

  @Post('drip/demo-lead')
  async createDemoLead() {
    const lead = await this.prisma.lead.create({
      data: {
        source: 'DEMO',
        status: 'NEW',
        propertyAddress: '742 Evergreen Terrace',
        propertyCity: 'Springfield',
        propertyState: 'IL',
        propertyZip: '62704',
        propertyType: 'Single Family',
        bedrooms: 3,
        bathrooms: 2,
        sqft: 1800,
        sellerFirstName: 'Homer',
        sellerLastName: 'Simpson',
        sellerPhone: '+15551234567',
        sellerEmail: 'demo@fasthomes.test',
      },
    });

    const sequence = await this.dripService.startSequence(lead.id);

    return { leadId: lead.id, sequenceId: sequence?.id };
  }

  // ─── AI Prompt Templates ────────────────────────────

  @Get('prompts')
  async listPrompts() {
    return this.prisma.aiPrompt.findMany({
      orderBy: { priority: 'desc' },
    });
  }

  @Get('prompts/:id')
  async getPrompt(@Param('id') id: string) {
    const prompt = await this.prisma.aiPrompt.findUnique({ where: { id } });
    if (!prompt) throw new NotFoundException('Prompt not found');
    return prompt;
  }

  @Post('prompts')
  async createPrompt(@Body() body: CreateAiPromptDto) {
    return this.prisma.aiPrompt.create({ data: body });
  }

  @Patch('prompts/:id')
  async updatePrompt(@Param('id') id: string, @Body() body: UpdateAiPromptDto) {
    const existing = await this.prisma.aiPrompt.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Prompt not found');
    return this.prisma.aiPrompt.update({ where: { id }, data: body });
  }

  @Delete('prompts/:id')
  async deletePrompt(@Param('id') id: string) {
    const existing = await this.prisma.aiPrompt.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Prompt not found');
    await this.prisma.aiPrompt.delete({ where: { id } });
    return { success: true };
  }

  @Post('prompts/:id/test')
  async testPrompt(@Param('id') id: string) {
    const prompt = await this.prisma.aiPrompt.findUnique({ where: { id } });
    if (!prompt) throw new NotFoundException('Prompt not found');

    // Generate sample drafts using this prompt's systemPrompt with mock data
    const drafts = await this.scoringService.generateMessageDrafts(
      {
        sellerName: 'Jane',
        propertyAddress: '100 Demo Street',
        conversationHistory: ['OUTBOUND: Hi Jane, are you interested in selling?', 'INBOUND: Yes, I might be.'],
        purpose: 'Test prompt generation',
      },
      {
        systemPrompt: prompt.systemPrompt,
        exampleMessages: prompt.exampleMessages as any[] | undefined,
      },
    );

    return { drafts, promptName: prompt.name, scenario: prompt.scenario };
  }
}

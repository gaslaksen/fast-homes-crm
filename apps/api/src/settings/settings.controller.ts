import {
  Controller,
  Get,
  Patch,
  Post,
  Delete,
  Body,
  Param,
  Headers,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { DripService } from '../drip/drip.service';
import { ScoringService } from '../scoring/scoring.service';
import { ConfigService } from '@nestjs/config';
import { UpdateDripDto } from './update-drip.dto';
import { CreateAiPromptDto, UpdateAiPromptDto } from './ai-prompt.dto';
import * as jwt from 'jsonwebtoken';

@Controller('settings')
export class SettingsController {
  constructor(
    private prisma: PrismaService,
    private dripService: DripService,
    private scoringService: ScoringService,
    private config: ConfigService,
  ) {}

  private getUser(authHeader: string) {
    const token = authHeader?.replace('Bearer ', '');
    if (!token) throw new UnauthorizedException('No token');
    try {
      return jwt.verify(token, this.config.get('JWT_SECRET') || 'dev-secret-key') as any;
    } catch {
      throw new UnauthorizedException('Invalid token');
    }
  }

  // ─── Profile ──────────────────────────────────────────

  @Get('profile')
  async getProfile(@Headers('authorization') authHeader: string) {
    const decoded = this.getUser(authHeader);
    const user = await this.prisma.user.findUnique({
      where: { id: decoded.userId },
      select: {
        id: true, email: true, firstName: true, lastName: true,
        role: true, phone: true, title: true, avatarUrl: true,
      },
    });
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  @Patch('profile')
  async updateProfile(
    @Headers('authorization') authHeader: string,
    @Body() body: { firstName?: string; lastName?: string; avatarUrl?: string },
  ) {
    const decoded = this.getUser(authHeader);
    const data: any = {};
    if (body.firstName !== undefined) data.firstName = body.firstName;
    if (body.lastName !== undefined) data.lastName = body.lastName;
    if (body.avatarUrl !== undefined) data.avatarUrl = body.avatarUrl || null;
    return this.prisma.user.update({
      where: { id: decoded.userId },
      data,
      select: {
        id: true, email: true, firstName: true, lastName: true,
        role: true, phone: true, title: true, avatarUrl: true,
      },
    });
  }

  @Post('profile/avatar')
  async uploadAvatar(
    @Headers('authorization') authHeader: string,
    @Body() body: { base64: string },
  ) {
    const decoded = this.getUser(authHeader);
    if (!body.base64) throw new UnauthorizedException('No image data');
    // Store as data URL directly
    const avatarUrl = body.base64.startsWith('data:') ? body.base64 : `data:image/png;base64,${body.base64}`;
    return this.prisma.user.update({
      where: { id: decoded.userId },
      data: { avatarUrl },
      select: { id: true, avatarUrl: true },
    });
  }

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

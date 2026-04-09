import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  CONVERSATIONAL_SYSTEM_PROMPT,
} from '../scoring/prompt-constants';

/**
 * Seeds the default AI Prompt Templates on startup if none exist.
 * Safe to run repeatedly — uses upsert by scenario so it never duplicates.
 * When prompts ARE present it only fills in ones that are missing
 * (e.g. after a new scenario is added to the seed list).
 */
@Injectable()
export class PromptSeedService implements OnModuleInit {
  private readonly logger = new Logger(PromptSeedService.name);

  constructor(private prisma: PrismaService) {}

  async onModuleInit() {
    await this.seedPrompts();
  }

  async seedPrompts() {
    const prompts = this.getDefaultPrompts();
    const activeScenarios = prompts.map(p => p.scenario);

    let seeded = 0;
    let updated = 0;
    for (const p of prompts) {
      const existing = await this.prisma.aiPrompt.findUnique({
        where: { scenario: p.scenario },
      });
      if (!existing) {
        await this.prisma.aiPrompt.create({ data: p });
        seeded++;
        this.logger.log(`🌱 Seeded AI prompt: ${p.name}`);
      } else {
        // Always sync systemPrompt and exampleMessages from code — keeps prod in step with deploys.
        // isActive, priority, and contextRules are also synced so code is the source of truth.
        await this.prisma.aiPrompt.update({
          where: { scenario: p.scenario },
          data: {
            systemPrompt: p.systemPrompt,
            exampleMessages: p.exampleMessages,
            priority: p.priority,
            contextRules: p.contextRules,
          },
        });
        updated++;
      }
    }

    // Clean up old prompt scenarios that are no longer in the seed list
    const deleted = await this.prisma.aiPrompt.deleteMany({
      where: { scenario: { notIn: activeScenarios } },
    });
    if (deleted.count > 0) {
      this.logger.log(`🧹 Removed ${deleted.count} old AI prompt template(s)`);
    }

    if (seeded > 0 || updated > 0) {
      this.logger.log(`✅ AI prompts: ${seeded} created, ${updated} updated`);
    } else {
      this.logger.log(`✅ AI prompts: all ${prompts.length} templates up to date`);
    }
  }

  private getDefaultPrompts() {
    return [
      {
        name: 'Conversational (Primary)',
        scenario: 'conversational',
        priority: 20,
        isActive: true,
        contextRules: {
          leadStatuses: ['NEW', 'ATTEMPTING_CONTACT', 'QUALIFIED'],
          minMessages: 1,
        },
        systemPrompt: CONVERSATIONAL_SYSTEM_PROMPT,
        exampleMessages: [],
      },
      {
        name: 'Initial Contact',
        scenario: 'initial_contact',
        priority: 10,
        isActive: false, // Initial outreach is now a fixed template, not AI-generated
        contextRules: {
          leadStatuses: ['NEW'],
          maxMessages: 0,
        },
        systemPrompt: `Initial contact is handled by a fixed message template. This prompt is not used.`,
        exampleMessages: [],
      },
    ];
  }
}

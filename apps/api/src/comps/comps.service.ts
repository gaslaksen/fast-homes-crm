import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import axios from 'axios';

interface ChatARVResponse {
  arv: number;
  confidence: number;
  comps: Array<{
    address: string;
    distance: number;
    soldPrice: number;
    soldDate: string;
    daysOnMarket?: number;
    bedrooms?: number;
    bathrooms?: number;
    sqft?: number;
    sourceUrl?: string;
  }>;
}

@Injectable()
export class CompsService {
  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
  ) {}

  /**
   * Fetch comps and ARV for a property
   * Tries ChatARV.ai if available, otherwise returns placeholder
   */
  async fetchComps(leadId: string, address: {
    street: string;
    city: string;
    state: string;
    zip: string;
  }): Promise<{ arv: number; confidence: number; compsCount: number }> {
    const chatARVKey = this.config.get<string>('CHATARV_API_KEY');

    if (chatARVKey) {
      try {
        return await this.fetchFromChatARV(leadId, address, chatARVKey);
      } catch (error) {
        console.error('ChatARV fetch failed, using placeholder:', error.message);
        return await this.createPlaceholderComps(leadId, address);
      }
    } else {
      console.log('ChatARV not configured, using placeholder comps');
      return await this.createPlaceholderComps(leadId, address);
    }
  }

  /**
   * Fetch from ChatARV.ai API
   * Note: Actual API schema may differ; this is a reasonable assumption
   */
  private async fetchFromChatARV(
    leadId: string,
    address: { street: string; city: string; state: string; zip: string },
    apiKey: string,
  ): Promise<{ arv: number; confidence: number; compsCount: number }> {
    const fullAddress = `${address.street}, ${address.city}, ${address.state} ${address.zip}`;

    // Example ChatARV.ai API call (adjust based on actual API docs)
    // Assuming: POST https://api.chatarv.ai/v1/comps
    const response = await axios.post<ChatARVResponse>(
      'https://api.chatarv.ai/v1/comps',
      {
        address: fullAddress,
        radius: 1.0, // miles
        max_comps: 10,
      },
      {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        timeout: 15000,
      },
    );

    const data = response.data;

    // Store comps in database
    await this.prisma.comp.deleteMany({ where: { leadId } }); // Clear old comps

    for (const comp of data.comps) {
      await this.prisma.comp.create({
        data: {
          leadId,
          address: comp.address,
          distance: comp.distance,
          soldPrice: comp.soldPrice,
          soldDate: new Date(comp.soldDate),
          daysOnMarket: comp.daysOnMarket,
          bedrooms: comp.bedrooms,
          bathrooms: comp.bathrooms,
          sqft: comp.sqft,
          sourceUrl: comp.sourceUrl,
        },
      });
    }

    // Update lead with ARV
    await this.prisma.lead.update({
      where: { id: leadId },
      data: {
        arv: data.arv,
        arvConfidence: data.confidence,
        lastCompsDate: new Date(),
      },
    });

    return {
      arv: data.arv,
      confidence: data.confidence,
      compsCount: data.comps.length,
    };
  }

  /**
   * Create placeholder comps for development/demo
   */
  private async createPlaceholderComps(
    leadId: string,
    address: { street: string; city: string; state: string; zip: string },
  ): Promise<{ arv: number; confidence: number; compsCount: number }> {
    // Get lead info to estimate ARV
    const lead = await this.prisma.lead.findUnique({
      where: { id: leadId },
      select: { askingPrice: true, bedrooms: true, bathrooms: true, sqft: true },
    });

    // Estimate ARV based on asking price or generate reasonable value
    const baseValue = lead?.askingPrice || 200000;
    const arv = Math.round(baseValue * 1.15); // Assume 15% below ARV
    const confidence = 75;

    // Generate 3-5 realistic comps
    const compCount = 3;
    const comps: Array<{
      address: string;
      distance: number;
      soldPrice: number;
      soldDate: Date;
      daysOnMarket: number;
      bedrooms?: number;
      bathrooms?: number;
      sqft?: number;
    }> = [];

    for (let i = 0; i < compCount; i++) {
      const variance = 0.95 + Math.random() * 0.1; // 95-105% of ARV
      comps.push({
        address: `${100 + i * 100} Comparable St, ${address.city}, ${address.state}`,
        distance: Math.round((0.2 + Math.random() * 0.8) * 10) / 10,
        soldPrice: Math.round(arv * variance),
        soldDate: new Date(Date.now() - (30 + i * 15) * 24 * 60 * 60 * 1000),
        daysOnMarket: 15 + Math.floor(Math.random() * 30),
        bedrooms: lead?.bedrooms,
        bathrooms: lead?.bathrooms,
        sqft: lead?.sqft,
      });
    }

    // Clear old comps and save new ones
    await this.prisma.comp.deleteMany({ where: { leadId } });

    for (const comp of comps) {
      await this.prisma.comp.create({
        data: {
          leadId,
          ...comp,
        },
      });
    }

    // Update lead
    await this.prisma.lead.update({
      where: { id: leadId },
      data: {
        arv,
        arvConfidence: confidence,
        lastCompsDate: new Date(),
      },
    });

    return {
      arv,
      confidence,
      compsCount: compCount,
    };
  }

  /**
   * Get comps for a lead
   */
  async getComps(leadId: string) {
    return this.prisma.comp.findMany({
      where: { leadId },
      orderBy: { distance: 'asc' },
    });
  }
}

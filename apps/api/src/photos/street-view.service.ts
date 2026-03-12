import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import axios from 'axios';
import { randomUUID } from 'crypto';

/**
 * Fetches Google Street View photos and stores the direct Google URL —
 * no local file download, no disk dependency, survives redeployments.
 */
@Injectable()
export class StreetViewService {
  private readonly logger = new Logger(StreetViewService.name);
  private readonly apiKey: string | undefined;

  constructor(
    private config: ConfigService,
    private prisma: PrismaService,
  ) {
    this.apiKey = this.config.get<string>('GOOGLE_STREET_VIEW_API_KEY');
    if (this.apiKey) {
      console.log(`🌍 StreetViewService initialized with API key: ${this.apiKey.substring(0, 10)}...`);
    } else {
      console.log('⚠️ StreetViewService: No GOOGLE_STREET_VIEW_API_KEY found in env');
    }
  }

  async fetchStreetView(leadId: string): Promise<any | null> {
    if (!this.apiKey) {
      console.log('❌ Street View: No API key configured, skipping');
      return null;
    }

    const lead = await this.prisma.lead.findUnique({ where: { id: leadId } });
    if (!lead) throw new Error('Lead not found');

    const address = `${lead.propertyAddress}, ${lead.propertyCity}, ${lead.propertyState} ${lead.propertyZip}`;
    console.log(`🌍 Fetching Street View for: ${address}`);

    // Check metadata first (free — confirms coverage before using a paid call)
    const metadataUrl = `https://maps.googleapis.com/maps/api/streetview/metadata?location=${encodeURIComponent(address)}&key=${this.apiKey}`;
    console.log(`📡 Checking metadata...`);

    try {
      const metadataRes = await axios.get(metadataUrl);
      console.log(`📡 Metadata response: ${JSON.stringify(metadataRes.data)}`);

      if (metadataRes.data.status !== 'OK') {
        console.log(`⚠️ No Street View available for ${address}: ${metadataRes.data.status}`);
        return null;
      }
    } catch (err) {
      console.log(`❌ Street View metadata check failed: ${err.message}`);
      return null;
    }

    // Store the direct Google URL — no download, no disk, survives redeployments
    const encodedAddress = encodeURIComponent(address);
    const photoUrl = `https://maps.googleapis.com/maps/api/streetview?size=800x600&location=${encodedAddress}&key=${this.apiKey}`;
    const thumbUrl = `https://maps.googleapis.com/maps/api/streetview?size=200x150&location=${encodedAddress}&key=${this.apiKey}`;

    const photo = {
      id: randomUUID(),
      url: photoUrl,
      thumbnailUrl: thumbUrl,
      source: 'streetview',
      uploadedAt: new Date().toISOString(),
    };

    // Update lead photos — dedupe any existing streetview entry
    const currentPhotos = (lead.photos as any[]) || [];
    const withoutOldSv = currentPhotos.filter((p: any) => p.source !== 'streetview');
    const updatedPhotos = [...withoutOldSv, photo];

    await this.prisma.lead.update({
      where: { id: leadId },
      data: {
        photos: updatedPhotos,
        primaryPhoto: lead.primaryPhoto || photo.url,
      },
    });

    // Log activity
    await this.prisma.activity.create({
      data: {
        leadId,
        type: 'PHOTO_ADDED',
        description: 'Street View photo fetched',
        metadata: { source: 'streetview', photoId: photo.id },
      },
    });

    console.log(`✅ Street View URL saved for lead ${leadId}`);
    return photo;
  }

  /**
   * Get a Street View URL for direct display
   */
  getStreetViewUrl(address: string): string | null {
    if (!this.apiKey) return null;
    return `https://maps.googleapis.com/maps/api/streetview?size=640x480&location=${encodeURIComponent(address)}&key=${this.apiKey}`;
  }
}

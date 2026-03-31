import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import axios from 'axios';
import sharp from 'sharp';
import { randomUUID } from 'crypto';

/**
 * Fetches Google Street View photos, downloads the image server-side,
 * and stores as base64 data URIs — no API key exposed to the client,
 * no referrer restrictions, survives redeployments.
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

    // Download the image server-side (avoids API key exposure + referrer issues)
    const encodedAddress = encodeURIComponent(address);
    const imageUrl = `https://maps.googleapis.com/maps/api/streetview?size=800x600&location=${encodedAddress}&key=${this.apiKey}`;

    let imageBuffer: Buffer;
    try {
      const imageRes = await axios.get(imageUrl, {
        responseType: 'arraybuffer',
        timeout: 15000,
      });
      imageBuffer = Buffer.from(imageRes.data);
      console.log(`📸 Street View image downloaded: ${Math.round(imageBuffer.length / 1024)}KB`);
    } catch (err) {
      console.log(`❌ Street View image download failed: ${err.message}`);
      return null;
    }

    // Convert to optimized base64 data URIs
    const mainBuffer = await sharp(imageBuffer)
      .resize(800, null, { withoutEnlargement: true })
      .jpeg({ quality: 80 })
      .toBuffer();

    const thumbBuffer = await sharp(imageBuffer)
      .resize(400, null, { withoutEnlargement: true })
      .jpeg({ quality: 70 })
      .toBuffer();

    const photo = {
      id: randomUUID(),
      url: `data:image/jpeg;base64,${mainBuffer.toString('base64')}`,
      thumbnailUrl: `data:image/jpeg;base64,${thumbBuffer.toString('base64')}`,
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

    console.log(`✅ Street View photo saved for lead ${leadId} (${Math.round(mainBuffer.length / 1024)}KB)`);
    return photo;
  }

  /**
   * Get a Street View URL for direct display (server-side use only)
   */
  getStreetViewUrl(address: string): string | null {
    if (!this.apiKey) return null;
    return `https://maps.googleapis.com/maps/api/streetview?size=640x480&location=${encodeURIComponent(address)}&key=${this.apiKey}`;
  }
}

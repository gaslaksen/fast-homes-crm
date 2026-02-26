import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { getJson } from 'serpapi';

/**
 * ZillowService — two-step photo fetch:
 * 1. Web search to find the Zillow listing URL and extract ZPID
 * 2. Image search using the ZPID — returns ONLY photos for that specific listing
 *
 * Direct scraping of zillow.com returns 403 (Cloudflare blocked).
 * Searching by address in Google Images returns neighborhood photos (wrong property).
 * Searching by ZPID returns 100% correct listing photos.
 */
@Injectable()
export class ZillowService {
  private readonly logger = new Logger(ZillowService.name);
  private readonly serpApiKey: string | undefined;

  constructor(private config: ConfigService) {
    this.serpApiKey = this.config.get<string>('SERPAPI_KEY');
  }

  async fetchPhotos(address: string, city: string, state: string, zip?: string): Promise<string[]> {
    if (!this.serpApiKey) {
      this.logger.warn('Zillow photos: SERPAPI_KEY not configured');
      return [];
    }

    // Step 1: Find the ZPID via web search
    const zpid = await this.findZpid(address, city, state);
    if (!zpid) {
      this.logger.log(`Zillow: no listing found for ${address}, ${city}, ${state}`);
      return [];
    }

    this.logger.log(`Zillow: found ZPID ${zpid} for ${address}`);

    // Step 2: Fetch photos using ZPID — scopes results to exactly this listing
    return await this.fetchPhotosByZpid(zpid);
  }

  private async findZpid(address: string, city: string, state: string): Promise<string | null> {
    const query = `site:zillow.com "${address}" ${city} ${state}`;

    try {
      const results = await getJson({
        engine: 'google',
        q: query,
        api_key: this.serpApiKey,
        num: 5,
      });

      for (const result of (results.organic_results || [])) {
        const link: string = result.link || '';
        // Extract ZPID from URL patterns like /homedetails/.../118585234_zpid/ or _zpid at end
        const zpidMatch = link.match(/\/(\d{7,9})_zpid/);
        if (zpidMatch) return zpidMatch[1];
      }

      return null;
    } catch (err: any) {
      this.logger.warn(`Zillow ZPID lookup failed: ${err.message}`);
      return null;
    }
  }

  private async fetchPhotosByZpid(zpid: string): Promise<string[]> {
    try {
      const results = await getJson({
        engine: 'google_images',
        q: `zillow ${zpid}_zpid`,
        api_key: this.serpApiKey,
        num: 30,
        safe: 'active',
      });

      const images: any[] = results.images_results || [];
      const photos: string[] = [];

      for (const img of images) {
        const url: string = img.original || img.thumbnail || '';
        // All results should be Zillow CDN but double-check
        if (url.includes('zillowstatic.com') && !photos.includes(url)) {
          photos.push(url);
        }
        if (photos.length >= 20) break;
      }

      this.logger.log(`Zillow: found ${photos.length} listing photos for ZPID ${zpid}`);
      return photos;
    } catch (err: any) {
      this.logger.warn(`Zillow image fetch failed for ZPID ${zpid}: ${err.message}`);
      return [];
    }
  }
}

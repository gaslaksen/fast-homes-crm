import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { getJson } from 'serpapi';

interface GoogleImageResult {
  original?: string;
  thumbnail?: string;
  title?: string;
  source?: string;
}

@Injectable()
export class SerpApiService {
  private readonly logger = new Logger(SerpApiService.name);
  private readonly apiKey: string | undefined;

  constructor(private config: ConfigService) {
    this.apiKey = this.config.get<string>('SERPAPI_KEY');
    if (this.apiKey) {
      console.log(`🔍 SerpAPI configured (key: ${this.apiKey.substring(0, 10)}...)`);
    } else {
      console.log('⚠️ SerpAPI key not configured — Google Images search disabled');
    }
  }

  get isConfigured(): boolean {
    return !!this.apiKey;
  }

  /**
   * Search Google Images for property photos via SerpAPI.
   * Returns an array of image URLs (originals preferred, thumbnail fallback).
   */
  async searchPropertyImages(address: string, maxResults = 8): Promise<string[]> {
    if (!this.apiKey) return [];

    const searchQuery = `"${address}" house property`;
    console.log(`🔍 SerpAPI searching Google Images: ${searchQuery}`);

    try {
      const results = await getJson({
        engine: 'google_images',
        q: searchQuery,
        api_key: this.apiKey,
        num: maxResults + 2, // fetch a few extra in case some fail
        ijn: '0',
        safe: 'active',
      });

      const images: GoogleImageResult[] = results.images_results || [];
      if (images.length === 0) {
        console.log(`⚠️ SerpAPI: no images found for "${address}"`);
        return [];
      }

      console.log(`🔍 SerpAPI found ${images.length} images`);

      // Extract URLs — prefer original, fall back to thumbnail
      const urls: string[] = [];
      for (const img of images) {
        const url = img.original || img.thumbnail;
        if (url && url.startsWith('http')) {
          urls.push(url);
          if (urls.length >= maxResults) break;
        }
      }

      return urls;
    } catch (error: any) {
      if (error.message?.includes('quota') || error.message?.includes('limit') || error.message?.includes('exceeded')) {
        this.logger.warn('SerpAPI monthly quota exceeded (100/month free tier)');
      } else {
        this.logger.error(`SerpAPI search failed: ${error.message}`);
      }
      return [];
    }
  }
}
